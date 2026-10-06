'use strict';
// SessionStart hook: always emits the connection-check context, reports a
// saved helper sign-in only from file names, never fails, never reads secrets.
//   node --test scripts/session-start.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const hook = path.resolve(__dirname, '../runtime/session-start.cjs');
const run = env => JSON.parse(execFileSync(process.execPath, [hook], { env: { PATH: process.env.PATH, ...env } }).toString());

test('hooks.json wires the script to SessionStart', () => {
  const config = JSON.parse(readFileSync(path.resolve(__dirname, '../hooks/hooks.json'), 'utf8'));
  const [entry] = config.hooks.SessionStart;
  assert.match(entry.matcher, /startup/);
  assert.equal(entry.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/runtime/session-start.cjs"');
});

test('no plugin data: instructs the connection check and the prompt to connect', () => {
  const out = run({});
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  const text = out.hookSpecificOutput.additionalContext;
  assert.match(text, /mcp__plugin_mosofin_mosofin__list_workspaces/);
  assert.match(text, /mcp__plugin_mosofin_local__list_workspaces/);
  assert.match(text, /prompting the user to connect/);
  assert.match(text, /\/mosofin:connect/);
  assert.match(text, /do not mention connecting/);
  assert.match(text, /No saved plugin-helper sign-in/);
});

test('saved helper sign-in is detected from file names only', () => {
  for (const [dir, file] of [['mcp-remote-v1', 'abc_tokens.json'], ['conversation', `${'a'.repeat(64)}.json`]]) {
    const data = mkdtempSync(path.join(tmpdir(), 'mosofin-hook-'));
    mkdirSync(path.join(data, 'auth', dir), { recursive: true });
    writeFileSync(path.join(data, 'auth', dir, file), '{"access_token":"synthetic-secret"}');
    const out = JSON.stringify(run({ CLAUDE_PLUGIN_DATA: data }));
    assert.match(out, /has a saved MosoFin sign-in/);
    assert.doesNotMatch(out, /synthetic-secret/);
  }
});

test('unreadable or odd data never fails the session', () => {
  const data = mkdtempSync(path.join(tmpdir(), 'mosofin-hook-'));
  writeFileSync(path.join(data, 'auth'), 'not a directory');
  assert.match(JSON.stringify(run({ CLAUDE_PLUGIN_DATA: data })), /No saved plugin-helper sign-in/);
});
