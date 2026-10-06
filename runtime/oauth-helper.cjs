'use strict';

// Child process for `mosofin_connect`: the pinned mcp-remote proxy performs the
// whole local OAuth flow (DCR, PKCE, localhost callback, token refresh) and
// stores credentials under MCP_REMOTE_CONFIG_DIR. MosoFin only restyles its
// callback page and makes every file it writes owner-only.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { findPackage, PINNED } = require('./connect.cjs');
const { installCallbackPage } = require('./callback-page.cjs');

process.umask(0o077);
installCallbackPage();

const proxy = path.join(findPackage(...PINNED.mcpRemote), 'dist/proxy.js');
import(pathToFileURL(proxy).href).catch(() => {
  console.error('[MosoFin] The sign-in helper could not start.');
  process.exitCode = 1;
});
