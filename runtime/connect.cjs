'use strict';

// Entry point for the plugin's local `local` MCP server (see .mcp.json).
//
// `.mcp.json` runs this file through `npx --package=...`, which puts each
// pinned package's node_modules/.bin on PATH. Resolve the pinned packages from
// there so nothing is vendored, installed globally, or patched in the npm cache.
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PINNED = {
  sdk: ['@modelcontextprotocol/sdk', '1.30.0'],
  mcpRemote: ['mcp-remote', '0.14.2'],
};

function findPackage(name, version) {
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (path.basename(directory) !== '.bin') continue;
    const root = path.resolve(directory, '..', name);
    const manifest = path.join(root, 'package.json');
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    if (pkg.name === name && pkg.version === version) return root;
  }
  throw new Error(`The pinned ${name}@${version} package was not found. Start MosoFin with Node.js 22.12+ and npm available.`);
}

async function main() {
  const sdkRoot = findPackage(...PINNED.sdk);
  const server = pathToFileURL(path.join(__dirname, 'connection-server.mjs')).href;
  const { startConnectionServer } = await import(server);
  await startConnectionServer({ sdkRoot, args: process.argv.slice(2) });
}

module.exports = { findPackage, PINNED };

if (require.main === module) {
  main().catch(() => {
    // Keep stderr free of URLs and tokens; the cause is almost always the runtime.
    console.error('[MosoFin] Could not start the local connection. Check Node.js 22.12+, npm, and the plugin installation.');
    process.exitCode = 1;
  });
}
