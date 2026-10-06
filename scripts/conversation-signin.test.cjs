'use strict';
// Conversation sign-in (mosofin_sign_in) against a loopback MosoFin fixture:
// OAuth DCR + S256 PKCE, the hosted /plugin-auth mailbox, restart and crash
// recovery, concurrent helpers, denial, expiry, revoked tokens, a server
// without the feature, and no credential leakage. All values are synthetic.
//
// Run through npx so the pinned packages are on PATH:
//   npx --yes --ignore-scripts --package=mcp-remote@0.14.2 --package=@modelcontextprotocol/sdk@1.30.0 \
//     --package=proper-lockfile@4.1.2 node scripts/conversation-signin.test.cjs
const assert = require('node:assert/strict');
const { mkdtemp, readFile, writeFile, readdir, stat, rm, mkdir, utimes } = require('node:fs/promises');
const { randomBytes, createHash } = require('node:crypto');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const { findPackage, PINNED } = require('../runtime/connect.cjs');

const hex = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const sdkRoot = findPackage(...PINNED.sdk);
  const sdk = file => import(pathToFileURL(path.join(sdkRoot, 'dist/esm', file)).href);
  const express = createRequire(path.join(sdkRoot, 'package.json'))('express');
  const { Client } = await sdk('client/index.js');
  const { StdioClientTransport } = await sdk('client/stdio.js');
  const { ToolListChangedNotificationSchema } = await sdk('types.js');

  // ── fixture ─────────────────────────────────────────────────────────────
  const app = express();
  const http = app.listen(0, '127.0.0.1');
  await new Promise(resolve => http.once('listening', resolve));
  const origin = `http://127.0.0.1:${http.address().port}`;
  const fx = { registrations: 0, logins: 0, refreshes: 0, calls: 0, creates: 0, deny: false, revoked: false, holdPoll: false, featureOff: false };
  const clients = new Map(), codes = new Map(), mailboxes = new Map();
  const secrets = [];
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => res.json({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ['read'] }));
  app.get('/.well-known/oauth-protected-resource', (_req, res) => res.json({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ['read'] }));
  app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json({
    issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['read'] }));
  app.post('/register', (req, res) => {
    fx.registrations++;
    const info = { ...req.body, client_id: randomBytes(12).toString('hex') };
    clients.set(info.client_id, info);
    res.status(201).json(info);
  });
  app.get('/authorize', (req, res) => {
    fx.logins++;
    assert.equal(req.query.redirect_uri, `${origin}/plugin-auth/callback`);
    assert.equal(req.query.code_challenge_method, 'S256');
    assert.ok(clients.get(req.query.client_id)?.redirect_uris.includes(req.query.redirect_uri));
    const code = randomBytes(32).toString('hex');
    codes.set(code, { clientId: req.query.client_id, challenge: req.query.code_challenge });
    secrets.push(code);
    const next = new URL(req.query.redirect_uri);
    next.searchParams.set('state', req.query.state);
    next.searchParams.set(fx.deny ? 'error' : 'code', fx.deny ? 'access_denied' : code);
    res.redirect(next.href);
  });
  app.post('/token', (req, res) => {
    const body = req.body;
    if (body.grant_type === 'authorization_code') {
      const issued = codes.get(body.code);
      const challenge = createHash('sha256').update(body.code_verifier || '').digest('base64url');
      if (!issued || issued.challenge !== challenge || issued.clientId !== body.client_id) return res.status(400).json({ error: 'invalid_grant' });
      assert.equal(body.redirect_uri, `${origin}/plugin-auth/callback`);
      secrets.push(body.code_verifier);
      codes.delete(body.code);
      fx.revoked = false;
    } else if (body.grant_type === 'refresh_token' && !fx.revoked && body.refresh_token === 'fixture-refresh') {
      fx.refreshes++;
    } else {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    res.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'Bearer', expires_in: 3600, scope: 'read' });
  });
  app.post('/mcp', (req, res) => {
    if (fx.revoked || req.headers.authorization !== 'Bearer fixture-access') {
      return res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`).json({ error: 'unauthorized' });
    }
    const message = req.body;
    if (message.id === undefined) return res.sendStatus(202);
    let result = {};
    if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'MosoFin fixture', version: '1' } };
    else if (message.method === 'tools/list') result = { tools: [{ name: 'list_workspaces', inputSchema: { type: 'object' } }] };
    else if (message.method === 'tools/call') { fx.calls++; result = { content: [{ type: 'text', text: '{"status":"confirmed","workspaces":[{"workspace_id":"ws_fixture","name":"Fixture Books"}]}' }] }; }
    res.json({ jsonrpc: '2.0', id: message.id, result });
  });
  app.get('/mcp', (_req, res) => res.sendStatus(405));
  // The hosted mailbox: the protocol shape mcp.mosofin.com must serve (docs/conversation-signin.md).
  app.get('/plugin-auth/status', (_req, res) => (fx.featureOff ? res.sendStatus(404) : res.json({ enabled: true })));
  app.post('/plugin-auth/requests', (req, res) => {
    fx.creates++;
    const { state, client_id, code_challenge, poll_token_hash } = req.body;
    if (![state, client_id, code_challenge, poll_token_hash].every(v => typeof v === 'string' && v.length <= 256)) return res.sendStatus(400);
    if (mailboxes.has(state)) return res.sendStatus(409);
    mailboxes.set(state, { client_id, code_challenge, poll_token_hash, status: 'pending' });
    res.status(201).json({ expires_in: 300, interval: 1 });
  });
  app.post('/plugin-auth/poll', (req, res) => {
    const secret = (req.headers.authorization || '').replace(/^Bearer /, '');
    secrets.push(secret);
    const box = mailboxes.get(req.body.state);
    if (!box || hex(secret) !== box.poll_token_hash) return res.sendStatus(404);
    if (fx.holdPoll) return res.json({ status: 'pending' });
    if (box.status === 'pending') return res.json({ status: 'pending' });
    mailboxes.delete(req.body.state); // one-shot delivery
    res.json({ status: box.status, ...(box.code ? { code: box.code } : {}) });
  });
  app.get('/plugin-auth/callback', (req, res) => {
    const box = mailboxes.get(req.query.state);
    if (!box) return res.status(400).send('Unknown sign-in');
    if (req.query.code) {
      const issued = codes.get(req.query.code);
      if (!issued || issued.clientId !== box.client_id || issued.challenge !== box.code_challenge) return res.status(400).send('Mismatched sign-in');
      box.code = req.query.code;
      box.status = 'authorized';
    } else {
      box.status = 'denied';
    }
    res.redirect(303, '/plugin-auth/done');
  });
  app.get('/plugin-auth/done', (_req, res) => res.send('Signed in to MosoFin. Return to your conversation.'));

  // ── helpers ─────────────────────────────────────────────────────────────
  const temp = await mkdtemp(path.join(tmpdir(), 'mosofin-conversation-test-'));
  const active = new Set(), visible = [], logs = [];
  async function helper(directory = temp, timeout = '300') {
    const client = new Client({ name: 'test-host', version: '1' });
    let changes = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => { changes++; });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve(__dirname, '../runtime/connect.cjs'), `${origin}/mcp`, '--auth-timeout', timeout],
      env: { PATH: process.env.PATH, MCP_REMOTE_CONFIG_DIR: directory }, stderr: 'pipe',
    });
    transport.stderr.on('data', chunk => logs.push(chunk.toString()));
    await client.connect(transport);
    active.add(client);
    const call = async name => {
      const result = await client.callTool({ name, arguments: {} });
      visible.push(JSON.stringify(result));
      return result.structuredContent;
    };
    return {
      client, call, changes: () => changes,
      hasData: async () => (await client.listTools()).tools.some(tool => tool.name === 'list_workspaces'),
      workspace: async () => JSON.parse((await client.callTool({ name: 'list_workspaces', arguments: {} })).content[0].text).workspaces[0].name,
      close: async () => { await client.close(); active.delete(client); },
      crash: async () => { process.kill(transport.pid, 'SIGKILL'); await sleep(100); await client.close(); active.delete(client); },
    };
  }
  async function waitConnected(h) {
    for (let i = 0; i < 80; i++) {
      const s = await h.call('mosofin_connection_status');
      if (s.state === 'connected') return s;
      if (s.state === 'failed') throw new Error(`Connection failed: ${s.message}`);
      await sleep(100);
    }
    throw new Error('Connection did not finish');
  }
  const cachePath = directory => path.join(directory, 'conversation', `${hex(`${origin}/mcp`)}.json`);

  try {
    // Idle start: listing tools and reading status never registers or signs in.
    let h = await helper();
    assert.deepEqual((await h.client.listTools()).tools.map(t => t.name), ['mosofin_connection_status', 'mosofin_sign_in', 'mosofin_connect']);
    const idle = await h.call('mosofin_connection_status');
    assert.equal(idle.state, 'idle');
    assert.equal(idle.connection_route, 'none');
    assert.ok(idle.plugin_version && idle.helper_instance);
    assert.equal(fx.registrations + fx.creates, 0);

    // Link in the conversation; a second call reuses it.
    const first = await h.call('mosofin_sign_in');
    assert.equal(first.state, 'awaiting_sign_in');
    assert.ok(first.expires_in > 0 && first.expires_in <= 300);
    assert.equal((await h.call('mosofin_sign_in')).authorization_url, first.authorization_url);
    assert.equal(fx.creates, 1);
    assert.ok(!(await h.hasData()));
    const page = await fetch(first.authorization_url);
    assert.equal(page.status, 200);
    assert.equal(new URL(page.url).pathname, '/plugin-auth/done');
    assert.equal(new URL(page.url).search, '', 'the code never stays in the address bar');
    await waitConnected(h);
    assert.ok(h.changes() > 0, 'host is told about the new tools');
    assert.equal(await h.workspace(), 'Fixture Books');
    await h.close();

    // A new conversation reuses the saved sign-in.
    h = await helper();
    assert.equal((await h.call('mosofin_sign_in')).state, 'connected');
    assert.equal(await h.workspace(), 'Fixture Books');
    await h.close();
    assert.equal(fx.logins, 1);
    assert.equal(fx.creates, 1);
    const file = cachePath(temp);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);

    // Expired access token + a stale lock left by a crashed helper: two helpers
    // refresh once between them.
    const cached = JSON.parse(await readFile(file, 'utf8'));
    cached.tokens.access_token = 'expired';
    await writeFile(file, JSON.stringify(cached));
    await mkdir(`${file}.lock`);
    const old = new Date(Date.now() - 20_000);
    await utimes(`${file}.lock`, old, old);
    const a = await helper(), b = await helper();
    await Promise.all([a.call('mosofin_sign_in'), b.call('mosofin_sign_in')]);
    await Promise.all([waitConnected(a), waitConnected(b)]);
    assert.equal(fx.refreshes, 1);
    assert.equal(fx.logins, 1);
    await b.close();

    // Revoked: the next call fails without opening an unmonitored sign-in;
    // an explicit retry gives a fresh link.
    fx.revoked = true;
    await assert.rejects(a.client.callTool({ name: 'list_workspaces', arguments: {} }));
    assert.equal((await a.call('mosofin_connection_status')).state, 'failed');
    assert.equal(fx.creates, 1, 'revocation must not create a sign-in by itself');
    const renewed = await a.call('mosofin_sign_in');
    assert.equal(renewed.state, 'awaiting_sign_in');
    assert.notEqual(renewed.authorization_url, first.authorization_url);
    await fetch(renewed.authorization_url);
    await waitConnected(a);
    await a.close();
    console.log('PASS: idle start, link in conversation, hosted callback, PKCE, same-session tools, saved sign-in, private cache, stale lock, shared refresh, revoked-login retry');

    // Denial, then retry.
    fx.deny = true;
    h = await helper(path.join(temp, 'denied'));
    const denied = await h.call('mosofin_sign_in');
    await fetch(denied.authorization_url);
    await sleep(1500);
    assert.equal((await h.call('mosofin_connection_status')).state, 'failed');
    assert.ok(!(await h.hasData()));
    fx.deny = false;
    const retry = await h.call('mosofin_sign_in');
    assert.equal(retry.state, 'awaiting_sign_in');
    assert.notEqual(retry.authorization_url, denied.authorization_url);
    await fetch(retry.authorization_url);
    await waitConnected(h);
    await h.close();

    // Sign-in deadline.
    h = await helper(path.join(temp, 'deadline'), '1');
    await h.call('mosofin_sign_in');
    await sleep(1400);
    assert.equal((await h.call('mosofin_connection_status')).state, 'failed');
    await h.close();

    // Clean shutdown while waiting releases the lock.
    h = await helper(path.join(temp, 'cancelled'));
    await h.call('mosofin_sign_in');
    await h.close();
    assert.ok(!(await readdir(path.join(temp, 'cancelled', 'conversation'))).some(f => f.endsWith('.lock')));

    // Host stops the helper after showing the link; the user signs in while no
    // helper runs; the next helper's status check finishes the same attempt.
    const restart = path.join(temp, 'restart');
    h = await helper(restart);
    const pendingLink = await h.call('mosofin_sign_in');
    const creates = fx.creates, logins = fx.logins;
    await h.close();
    const pending = JSON.parse(await readFile(cachePath(restart), 'utf8')).pending;
    assert.ok(pending.verifier && pending.secret);
    secrets.push(pending.verifier, pending.secret);
    assert.equal((await fetch(pendingLink.authorization_url)).status, 200);
    h = await helper(restart);
    const resumed = await h.call('mosofin_connection_status');
    assert.equal(resumed.state, 'connected', 'status after a restart finishes the original sign-in');
    assert.notEqual(resumed.helper_instance, pendingLink.helper_instance);
    assert.equal(fx.creates, creates);
    assert.equal(fx.logins, logins + 1);
    assert.equal(await h.workspace(), 'Fixture Books');
    assert.equal(JSON.parse(await readFile(cachePath(restart), 'utf8')).pending, undefined, 'completion removes the pending secrets');
    await h.close();

    // Crash before and after consent.
    for (const consentFirst of [false, true]) {
      const directory = path.join(temp, `crash-${consentFirst}`);
      h = await helper(directory);
      fx.holdPoll = true;
      const original = await h.call('mosofin_sign_in');
      const before = fx.creates;
      if (consentFirst) assert.equal((await fetch(original.authorization_url)).status, 200);
      await sleep(150);
      await h.crash();
      fx.holdPoll = false;
      h = await helper(directory);
      if (consentFirst) {
        await waitConnected(h);
      } else {
        const again = await h.call('mosofin_connection_status');
        assert.equal(again.state, 'awaiting_sign_in');
        assert.equal(again.authorization_url, original.authorization_url, 'the original link is reused');
        await fetch(original.authorization_url);
        await waitConnected(h);
      }
      assert.equal(fx.creates, before, 'crash recovery never creates a new sign-in');
      assert.equal(await h.workspace(), 'Fixture Books');
      await h.close();
    }

    // Two helpers share one pending sign-in.
    const shared = path.join(temp, 'shared');
    const one = await helper(shared), two = await helper(shared);
    const sharedLink = await one.call('mosofin_sign_in');
    const sharedCreates = fx.creates;
    assert.equal((await two.call('mosofin_connection_status')).authorization_url, sharedLink.authorization_url);
    await fetch(sharedLink.authorization_url);
    await Promise.all([waitConnected(one), waitConnected(two)]);
    assert.equal(fx.creates, sharedCreates);
    await one.close();
    await two.close();

    // An expired saved attempt is removed by status, which never starts a new one.
    const expired = path.join(temp, 'expired');
    h = await helper(expired);
    const stale = await h.call('mosofin_sign_in');
    await h.close();
    const record = JSON.parse(await readFile(cachePath(expired), 'utf8'));
    record.pending.until = Date.now() - 1;
    await writeFile(cachePath(expired), JSON.stringify(record));
    h = await helper(expired);
    const beforeExpiry = fx.creates;
    assert.equal((await h.call('mosofin_connection_status')).state, 'failed');
    assert.equal(JSON.parse(await readFile(cachePath(expired), 'utf8')).pending, undefined);
    assert.equal(fx.creates, beforeExpiry);
    const fresh = await h.call('mosofin_sign_in');
    assert.notEqual(fresh.authorization_url, stale.authorization_url);
    await fetch(fresh.authorization_url);
    await waitConnected(h);
    await h.close();
    console.log('PASS: denial, deadline, cancellation, restart while pending, crash before/after consent, shared attempt, expired attempt cleanup');

    // A MosoFin server without the hosted callback: no client registration, no link.
    fx.featureOff = true;
    const registrations = fx.registrations, beforeOff = fx.creates;
    h = await helper(path.join(temp, 'feature-off'));
    const off = await h.call('mosofin_sign_in');
    assert.equal(off.state, 'failed');
    assert.match(off.message, /not enabled on this MosoFin server/);
    assert.equal(off.authorization_url, undefined);
    assert.equal(fx.registrations, registrations);
    assert.equal(fx.creates, beforeOff);
    await h.close();
    fx.featureOff = false;
    console.log('PASS: server without conversation sign-in reports it and points to the host sign-in');

    const output = visible.join('\n') + logs.join('\n');
    for (const value of [...secrets, 'fixture-access', 'fixture-refresh'].filter(Boolean)) {
      assert.ok(!output.includes(value), 'credentials must never reach tool results or logs');
    }
    console.log('PASS: no codes, verifiers, poll secrets or tokens in tool results or helper logs');
  } finally {
    await Promise.all([...active].map(client => client.close()));
    http.closeAllConnections();
    await new Promise(resolve => http.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
