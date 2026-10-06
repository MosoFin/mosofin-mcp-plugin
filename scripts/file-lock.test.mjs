// runtime/file-lock.mjs: mutual exclusion, including the stale-lock reclaim
// race that let two holders in with proper-lockfile 4.1.2.
//   node --test scripts/file-lock.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, utimesSync, existsSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireLock } from '../runtime/file-lock.mjs';

const target = () => path.join(mkdtempSync(path.join(tmpdir(), 'mosofin-lock-')), 'cache.json');
const leaveStaleLock = file => {
  mkdirSync(`${file}.lock`);
  const old = new Date(Date.now() - 20_000);
  utimesSync(`${file}.lock`, old, old);
};

async function contend(file, workers) {
  let holders = 0, max = 0, entered = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    const lock = await acquireLock(file, { stale: 10_000, retryMs: 5, waitMs: 20_000 });
    holders++; entered++; max = Math.max(max, holders);
    await delay(10);
    assert.ok(await lock.held());
    holders--;
    await lock.release();
  }));
  return { max, entered };
}

test('one holder at a time under contention', async () => {
  const { max, entered } = await contend(target(), 8);
  assert.equal(max, 1);
  assert.equal(entered, 8);
});

test('a stale lock left by a crash is reclaimed by exactly one waiter', async () => {
  for (let trial = 0; trial < 60; trial++) {
    const file = target();
    leaveStaleLock(file);
    const { max, entered } = await contend(file, 4);
    assert.equal(max, 1, `trial ${trial}: two holders after reclaiming a stale lock`);
    assert.equal(entered, 4);
    assert.ok(!existsSync(`${file}.lock`) && !existsSync(`${file}.lock.reclaim`), 'locks are cleaned up');
  }
});

test('a fresh lock is never reclaimed and times out as ELOCKED', async () => {
  const file = target();
  const first = await acquireLock(file);
  await assert.rejects(acquireLock(file, { waitMs: 200, retryMs: 20 }), { code: 'ELOCKED' });
  assert.ok(await first.held());
  await first.release();
  const second = await acquireLock(file, { waitMs: 200 });
  await second.release();
});

test('a holder whose lock was taken over notices, and its release leaves the new lock alone', async () => {
  const file = target();
  const first = await acquireLock(file, { stale: 50, heartbeat: 60_000 });
  await delay(120); // stalled past `stale` without a heartbeat
  const second = await acquireLock(file, { stale: 50, waitMs: 2000 });
  assert.equal(await first.held(), false);
  await first.release();
  assert.ok(await second.held(), "the stalled holder's release must not delete the new lock");
  await second.release();
});

test('separate processes reclaiming the same stale lock never overlap', async () => {
  const lockModule = pathToFileURL(fileURLToPath(new URL('../runtime/file-lock.mjs', import.meta.url))).href;
  for (let trial = 0; trial < 10; trial++) {
    const file = target();
    const log = `${file}.log`;
    leaveStaleLock(file);
    const worker = `import { acquireLock } from ${JSON.stringify(lockModule)};
      import { appendFileSync } from 'node:fs';
      const lock = await acquireLock(${JSON.stringify(file)}, { retryMs: 5, waitMs: 20000 });
      appendFileSync(${JSON.stringify(log)}, 'in\\n');
      await new Promise(r => setTimeout(r, 15));
      appendFileSync(${JSON.stringify(log)}, 'out\\n');
      await lock.release();`;
    await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', worker], { stdio: 'inherit' });
      child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`worker exited ${code}`))));
    })));
    const events = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(events.length, 8);
    for (let i = 0; i < events.length; i += 2) assert.deepEqual(events.slice(i, i + 2), ['in', 'out'], `trial ${trial}: overlapping holders`);
  }
});
