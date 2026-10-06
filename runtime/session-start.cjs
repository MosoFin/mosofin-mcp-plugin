'use strict';

// SessionStart hook (hooks/hooks.json). Gives Claude one standing instruction:
// check for a working MosoFin connection before anything else, and if there
// is none, prompt the user to connect. The hook cannot see the host's own
// OAuth state, so the model decides from the tools it actually has; the hook
// only adds whether this machine holds a saved plugin-helper sign-in.
//
// Never fails a session and never prints secrets: it only checks that
// credential files exist, without reading their contents.
const { readdirSync } = require('node:fs');
const path = require('node:path');

function savedHelperSignIn(dataDir) {
  if (!dataDir) return false;
  const auth = path.join(dataDir, 'auth');
  const has = (dir, test) => {
    try { return readdirSync(dir).some(test); } catch { return false; }
  };
  return has(path.join(auth, 'mcp-remote-v1'), name => name.endsWith('_tokens.json'))
    || has(path.join(auth, 'conversation'), name => /^[0-9a-f]{64}\.json$/.test(name));
}

function context(saved) {
  return [
    'The MosoFin plugin is installed. MosoFin connection check — do this before anything else in your first reply:',
    '1. Look for a working MosoFin `list_workspaces` tool: `mcp__plugin_mosofin_mosofin__list_workspaces`, `mcp__plugin_mosofin_local__list_workspaces`, or a MosoFin connector (e.g. `mcp__MosoFin__list_workspaces`).',
    '2. If none is available, MosoFin is NOT connected. Start your reply with one short line prompting the user to connect, e.g. "MosoFin isn’t connected yet — want me to sign you in now?", then answer their message. When they agree, or ask anything about their books, follow the `/mosofin:connect` skill (skills/connect/SKILL.md): keep their request, give the one sign-in step for this host, and continue when they say done. Never answer financial questions from memory while signed out.',
    '3. If a MosoFin tool is available, it is connected: do not mention connecting.',
    saved
      ? 'This machine has a saved MosoFin sign-in from the plugin helper: `mosofin_connect` (local Claude Code) or `mosofin_connection_status` reuses it without a browser.'
      : 'No saved plugin-helper sign-in exists on this machine yet.',
    'Signing in to MosoFin is different from reconnecting a company file (`reconnect_url`); never say "refresh/reconnect the integration".',
  ].join('\n');
}

function main() {
  let saved = false;
  try { saved = savedHelperSignIn(process.env.CLAUDE_PLUGIN_DATA); } catch {}
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context(saved) },
  }));
}

module.exports = { savedHelperSignIn, context };
if (require.main === module) {
  try { main(); } catch {}
  process.exitCode = 0;
}
