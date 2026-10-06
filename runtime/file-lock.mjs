// Cross-process lock for the conversation sign-in cache.
//
// A lock is the directory `<file>.lock`, created atomically with mkdir and
// tagged with a random owner token. The holder refreshes its mtime on a
// heartbeat; a lock whose mtime is older than `stale` was left by a crashed
// helper and may be reclaimed.
//
// Reclaiming is itself serialised by a second atomic mkdir
// (`<file>.lock.reclaim`). Without that, two helpers that both see the same
// stale lock can each delete it and recreate it — the second deleting the
// first's fresh lock — and both believe they hold it (the race in
// proper-lockfile 4.1.2 this module replaces).
import { mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const OWNER = 'owner';

async function create(dir, owner) {
  try {
    await mkdir(dir);
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  await writeFile(path.join(dir, OWNER), owner, { mode: 0o600 });
  return true;
}

async function olderThan(target, ms) {
  try {
    return (await stat(target)).mtimeMs < Date.now() - ms;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

async function ownedBy(dir, owner) {
  try {
    return (await readFile(path.join(dir, OWNER), 'utf8')) === owner;
  } catch {
    return false;
  }
}

// Replace a stale lock with ours, but only while holding the reclaim mutex,
// and only if the lock is still stale once we hold it.
async function reclaim(dir, owner, stale) {
  const mutex = `${dir}.reclaim`;
  try {
    await mkdir(mutex);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // A reclaimer that crashed mid-reclaim; the window is microseconds wide.
    if (await olderThan(mutex, stale)) await rm(mutex, { recursive: true, force: true });
    return false;
  }
  try {
    let mtimeMs;
    try {
      ({ mtimeMs } = await stat(dir));
    } catch (error) {
      // Released meanwhile: compete for it normally, never delete blindly.
      if (error.code === 'ENOENT') return await create(dir, owner);
      throw error;
    }
    if (mtimeMs >= Date.now() - stale) return false;
    await rm(dir, { recursive: true, force: true });
    return await create(dir, owner);
  } finally {
    await rm(mutex, { recursive: true, force: true });
  }
}

export async function acquireLock(file, { stale = 10_000, heartbeat = 2000, waitMs = 310_000, retryMs = 150, signal } = {}) {
  const dir = `${file}.lock`;
  const owner = randomBytes(16).toString('hex');
  const giveUpAt = Date.now() + waitMs;
  for (;;) {
    signal?.throwIfAborted();
    if (await create(dir, owner)) break;
    if (await olderThan(dir, stale) && await reclaim(dir, owner, stale)) break;
    if (Date.now() > giveUpAt) {
      throw Object.assign(new Error('Lock is held by another process'), { code: 'ELOCKED' });
    }
    await delay(retryMs, undefined, { signal });
  }

  let lost = false;
  const timer = setInterval(async () => {
    if (lost) return;
    if (!(await ownedBy(dir, owner))) { lost = true; return; }
    const now = new Date();
    await utimes(dir, now, now).catch(() => { lost = true; });
  }, heartbeat);
  timer.unref();

  return {
    // False once another process has taken the lock (e.g. after a long stall).
    held: async () => !lost && await ownedBy(dir, owner),
    release: async () => {
      clearInterval(timer);
      if (await ownedBy(dir, owner)) await rm(dir, { recursive: true, force: true });
    },
  };
}
