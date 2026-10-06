'use strict';
// Branded localhost callback page: replaces only mcp-remote's callback reply,
// never echoes the code/state/provider text, and leaves other routes alone.
//   node --test scripts/callback-page.test.cjs
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { installCallbackPage } = require('../runtime/callback-page.cjs');

installCallbackPage();
const upstreamSuccess = 'Authorization successful! You may close this window and return to the CLI.';
const upstreamFailure = 'Authorization failed: <script>location="https://untrusted.invalid"</script>';
const server = http.createServer((req, res) => {
  const failed = req.url.includes('error=');
  const body = failed ? upstreamFailure : upstreamSuccess;
  res.statusCode = failed ? 400 : 200;
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.setHeader('ETag', 'upstream');
  res.end(body);
});
const base = (async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
})();
after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));

test('success page is MosoFin-branded, private, and strips OAuth parameters', async () => {
  const response = await fetch(`${await base}/oauth/callback?code=synthetic-secret&state=synthetic-state`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /You’re connected to MosoFin\./);
  assert.match(html, /Return to your conversation/);
  assert.match(html, /data:image\/svg\+xml;base64,/);
  assert.match(html, /history\.replaceState\(null, '', location\.pathname\)/);
  assert.doesNotMatch(html, /synthetic-secret|synthetic-state|return to the CLI|\{\{/);
  assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(html));
  assert.equal(response.headers.get('etag'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const csp = response.headers.get('content-security-policy');
  assert.ok(csp.includes("default-src 'none'"));
  const nonce = csp.match(/script-src 'nonce-([^']+)'/)[1];
  assert.ok(html.includes(`<script nonce="${nonce}">`));
  assert.ok(html.includes(`<style nonce="${nonce}">`));
});

test('failure keeps its status and never renders provider-supplied text', async () => {
  const response = await fetch(`${await base}/oauth/callback?error=access_denied`);
  const html = await response.text();
  assert.equal(response.status, 400);
  assert.match(html, /MosoFin sign-in wasn’t completed/);
  assert.doesNotMatch(html, /untrusted\.invalid|You’re connected/);
});

test('other routes and methods pass through untouched', async () => {
  for (const [route, method] of [['/wait-for-auth', 'GET'], ['/oauth/callback', 'POST']]) {
    const response = await fetch(`${await base}${route}`, { method });
    assert.equal(await response.text(), upstreamSuccess);
    assert.equal(response.headers.get('etag'), 'upstream');
  }
});
