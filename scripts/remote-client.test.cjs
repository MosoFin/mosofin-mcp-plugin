'use strict';
// Test client only — in the shipped plugin the host owns OAuth for the
// `mosofin` HTTP entry. Reads that entry (url rewritten to a loopback fixture)
// on stdin and checks DCR, PKCE, workspace calls, saved-login reuse and refresh.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { findPackage, PINNED } = require('../runtime/connect.cjs');

async function main() {
  const config = JSON.parse(readFileSync(0, 'utf8'));
  const endpoint = new URL(config.url);
  assert.equal(config.type, 'http');
  assert.equal(endpoint.hostname, '127.0.0.1', 'only loopback fixtures are allowed');
  const sdk = findPackage(...PINNED.sdk);
  const load = file => import(pathToFileURL(path.join(sdk, 'dist/esm/client', file)).href);
  const { Client } = await load('index.js');
  const { StreamableHTTPClientTransport } = await load('streamableHttp.js');
  const { UnauthorizedError } = await load('auth.js');

  const state = randomBytes(24).toString('hex');
  const redirect = 'http://127.0.0.1:1/synthetic-callback';
  let clientInformation, tokens, verifier, authorizationUrl;
  let redirects = 0;
  const provider = {
    redirectUrl: redirect,
    clientMetadata: { client_name: 'MosoFin synthetic remote test', redirect_uris: [redirect],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
    state: () => state,
    clientInformation: () => clientInformation,
    saveClientInformation: value => { clientInformation = value; },
    tokens: () => tokens,
    saveTokens: value => { tokens = value; },
    saveCodeVerifier: value => { verifier = value; },
    codeVerifier: () => verifier,
    redirectToAuthorization: value => { authorizationUrl = value; redirects++; },
  };

  const first = new Client({ name: 'mosofin-remote-test', version: '1' });
  const transport = new StreamableHTTPClientTransport(endpoint, { authProvider: provider });
  try {
    await assert.rejects(first.connect(transport), UnauthorizedError);
    assert.equal(authorizationUrl.origin, endpoint.origin);
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorizationUrl.searchParams.get('state'), state);
    assert.equal(tokens, undefined, 'no data without sign-in');
    const consent = await fetch(authorizationUrl, { redirect: 'manual' });
    assert.equal(consent.status, 302);
    const callback = new URL(consent.headers.get('location'));
    assert.equal(callback.origin + callback.pathname, redirect);
    await transport.finishAuth(callback.searchParams.get('code'));
  } finally {
    await first.close();
  }

  for (const label of ['initial', 'resumed', 'refreshed']) {
    if (label === 'refreshed') tokens = { ...tokens, access_token: 'synthetic-expired' };
    const client = new Client({ name: 'mosofin-remote-test', version: '1' });
    try {
      await client.connect(new StreamableHTTPClientTransport(endpoint, { authProvider: provider }));
      assert.ok((await client.listTools()).tools.some(tool => tool.name === 'list_workspaces'));
      const result = await client.callTool({ name: 'list_workspaces', arguments: {} });
      assert.ok(!result.isError);
      assert.equal(JSON.parse(result.content[0].text).workspaces[0].name, 'Fixture Books');
      assert.equal(redirects, 1, 'a saved sign-in must not prompt again');
      console.log(`${label}: workspace call passed`);
    } finally {
      await client.close();
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
