// Conversation sign-in: OAuth (DCR + S256 PKCE) whose redirect lands on a
// MosoFin-hosted page instead of a localhost listener, so it works where the
// browser cannot reach this machine (Cowork, remote hosts).
//
// The model only ever sees the authorization URL. The PKCE verifier, the
// mailbox poll secret, authorization codes and tokens stay between this
// helper and mcp.mosofin.com. Server contract: docs/conversation-signin.md.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, lstat, chmod } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { findPackage, PINNED } = require('./connect.cjs');

export const PRODUCTION_ENDPOINT = 'https://mcp.mosofin.com/mcp';
const PENDING_MAX_MS = 300_000;
const LOCK_WAIT_MS = 310_000;
const hex = value => createHash('sha256').update(value).digest('hex');
const challengeOf = verifier => createHash('sha256').update(verifier).digest('base64url');

export class SignInError extends Error {
  // code: unavailable | needs_sign_in | denied | expired | storage
  constructor(code, message) { super(message); this.code = code; }
}

// Only MosoFin production, or a loopback fixture in tests. Never a discovered URL.
export function checkEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (url.href === PRODUCTION_ENDPOINT) return url;
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1') return url;
  throw new SignInError('unavailable', 'Unsupported MosoFin endpoint');
}

const cacheFile = (endpoint, directory) => path.join(directory, 'conversation', `${hex(new URL(endpoint).href)}.json`);

async function readCache(filename) {
  try {
    const parent = await lstat(path.dirname(filename));
    const info = await lstat(filename);
    if (!parent.isDirectory() || parent.isSymbolicLink() || info.isSymbolicLink() || !info.isFile()) {
      throw new SignInError('storage', 'Invalid MosoFin sign-in storage');
    }
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

// Status checks may resume a sign-in already started or reuse saved tokens,
// but must never begin a new authorization. This only inspects the cache.
export async function hasSavedConversationAuth({ endpoint, directory }) {
  if (!directory) return false;
  const saved = await readCache(cacheFile(endpoint, directory));
  return Boolean(saved.pending || saved.tokens?.access_token);
}

export async function createConversationAuth({ endpoint, directory, signal, sdk, onLink, onNeedsSignIn, fetchFn = fetch }) {
  const url = checkEndpoint(endpoint);
  if (!directory) throw new SignInError('storage', 'Plugin data directory is unavailable');
  const cacheDir = path.join(directory, 'conversation');
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const dirInfo = await lstat(cacheDir);
  if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) throw new SignInError('storage', 'Invalid MosoFin sign-in storage');
  await chmod(cacheDir, 0o700);
  const filename = cacheFile(endpoint, directory);
  const lockfile = require(findPackage(...PINNED.lockfile));
  const redirectUrl = new URL('/plugin-auth/callback', url).href;

  let stored = {};
  let verifier;
  let currentState;
  let authorizing = false;
  let lockLost = false;
  let pollInterval = 2000;
  let transport;

  async function api(route, { method = 'POST', body, secret } = {}) {
    const response = await fetchFn(new URL(`/plugin-auth/${route}`, url), {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      redirect: 'error',
    });
    if (route === 'status' && response.status === 404) {
      throw new SignInError('unavailable', 'Conversation sign-in is not enabled on this MosoFin server');
    }
    if (route === 'poll' && [404, 410].includes(response.status)) throw new SignInError('expired', 'Sign-in link expired');
    if (!response.ok) throw new Error('MosoFin sign-in service unavailable');
    return response.json();
  }

  // The hosted callback is a server feature. Check before registering a
  // client or showing a link that could never complete.
  async function requireHostedCallback() {
    const status = await api('status', { method: 'GET' });
    if (status?.enabled !== true) throw new SignInError('unavailable', 'Conversation sign-in is not enabled on this MosoFin server');
  }

  async function load() {
    stored = await readCache(filename);
    try { await chmod(filename, 0o600); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async function save() {
    signal.throwIfAborted();
    if (lockLost) throw new SignInError('storage', 'MosoFin sign-in storage lock was lost');
    const temporary = `${filename}.${randomBytes(12).toString('hex')}`;
    try {
      await writeFile(temporary, JSON.stringify(stored), { flag: 'wx', mode: 0o600 });
      await rename(temporary, filename);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  // One helper at a time touches the cache or the network for this endpoint.
  // The lease is released between polls: a host may stop this process right
  // after a tool result is delivered, and another helper must be able to resume.
  async function exclusive(action) {
    const giveUpAt = Date.now() + LOCK_WAIT_MS;
    let release;
    for (;;) {
      signal.throwIfAborted();
      if (lockLost) throw new SignInError('storage', 'MosoFin sign-in storage lock was lost');
      try {
        release = await lockfile.lock(filename, { realpath: false, stale: 10_000, update: 2000, onCompromised: () => { lockLost = true; } });
        break;
      } catch (error) {
        if (error.code !== 'ELOCKED') throw error;
        if (Date.now() > giveUpAt) throw new SignInError('storage', 'Another MosoFin session is using this sign-in');
        await delay(150, undefined, { signal });
      }
    }
    try {
      await load();
      return await action();
    } finally {
      await release();
    }
  }

  function showPending() {
    const { authorization, until } = stored.pending;
    onLink({ authorization_url: authorization, expires_in: Math.max(0, Math.ceil((until - Date.now()) / 1000)) });
  }

  // Reload a pending attempt saved by this or an earlier helper. Anything that
  // does not match exactly what this helper would have created is discarded.
  async function restorePending() {
    const pending = stored.pending;
    if (!pending) return false;
    let valid = false;
    try {
      const target = new URL(pending.authorization);
      valid = /^[A-Za-z0-9_-]{43}$/.test(pending.state)
        && /^[A-Za-z0-9_-]{43}$/.test(pending.secret)
        && /^[A-Za-z0-9._~-]{43,128}$/.test(pending.verifier)
        && Number.isFinite(pending.until) && pending.until > Date.now() && pending.until <= Date.now() + PENDING_MAX_MS
        && target.origin === url.origin
        && target.searchParams.get('redirect_uri') === redirectUrl
        && target.searchParams.get('client_id') === stored.client?.client_id
        && target.searchParams.get('state') === pending.state
        && target.searchParams.get('code_challenge_method') === 'S256'
        && target.searchParams.get('code_challenge') === challengeOf(pending.verifier);
    } catch {}
    if (!valid) {
      delete stored.pending;
      await save();
      return false;
    }
    verifier = pending.verifier;
    currentState = pending.state;
    return true;
  }

  const provider = {
    redirectUrl,
    clientMetadata: {
      client_name: 'MosoFin conversation sign-in',
      redirect_uris: [redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    state: () => (currentState ||= randomBytes(32).toString('base64url')),
    clientInformation: () => stored.client,
    saveClientInformation: async value => { stored.client = value; await save(); },
    tokens: () => stored.tokens,
    saveTokens: async value => { stored.tokens = value; delete stored.pending; await save(); },
    saveCodeVerifier: value => { verifier = value; },
    codeVerifier: () => {
      if (!verifier) throw new SignInError('expired', 'No pending MosoFin sign-in');
      return verifier;
    },
    invalidateCredentials: async scope => {
      if (scope === 'all' || scope === 'client') delete stored.client;
      if (scope === 'all' || scope === 'tokens') delete stored.tokens;
      if (scope === 'all' || scope === 'verifier') verifier = undefined;
      if (scope === 'all' || scope === 'client' || scope === 'verifier') delete stored.pending;
      await save();
    },
    redirectToAuthorization: async value => {
      // Saved tokens stopped working while no sign-in was requested (e.g. a
      // status check). Report it; never open an unmonitored authorization.
      if (!authorizing) {
        await onNeedsSignIn?.();
        throw new SignInError('needs_sign_in', 'MosoFin sign-in is required again');
      }
      const target = new URL(value);
      if (target.origin !== url.origin
          || target.searchParams.get('redirect_uri') !== redirectUrl
          || target.searchParams.get('state') !== currentState
          || target.searchParams.get('code_challenge_method') !== 'S256') {
        throw new SignInError('unavailable', 'Unexpected MosoFin authorization destination');
      }
      const secret = randomBytes(32).toString('base64url');
      const mailbox = await api('requests', { body: {
        state: currentState,
        client_id: target.searchParams.get('client_id'),
        code_challenge: target.searchParams.get('code_challenge'),
        poll_token_hash: hex(secret),
      } });
      if (!Number.isFinite(mailbox.expires_in) || mailbox.expires_in <= 0) throw new Error('Invalid sign-in lifetime');
      if (Number.isFinite(mailbox.interval)) pollInterval = Math.min(10, Math.max(1, mailbox.interval)) * 1000;
      // Persist before the link is shown: a helper restart must be able to
      // finish this exact attempt. Removed on completion, denial or expiry.
      stored.pending = {
        secret, state: currentState, verifier, authorization: target.href,
        until: Date.now() + Math.min(PENDING_MAX_MS / 1000, mailbox.expires_in) * 1000,
      };
      await save();
      showPending();
    },
  };

  const { StreamableHTTPClientTransport } = await sdk('client/streamableHttp.js');
  const { UnauthorizedError } = await sdk('client/auth.js');
  const makeTransport = () => new StreamableHTTPClientTransport(url, {
    authProvider: provider,
    fetch: (input, init) => fetchFn(input, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000), ...(init?.signal ? [init.signal] : [])]) }),
  });
  async function reconnect(client) {
    await transport?.close().catch(() => {});
    transport = makeTransport();
    await client.connect(transport);
  }

  async function connect(client, { allowNewSignIn = true } = {}) {
    authorizing = allowNewSignIn;
    try {
      const waiting = await exclusive(async () => {
        if (await restorePending()) return true;
        if (!stored.tokens?.access_token) {
          if (!allowNewSignIn) throw new SignInError('needs_sign_in', 'No saved MosoFin sign-in to resume');
          await requireHostedCallback();
        }
        try {
          await reconnect(client);
          return false;
        } catch (error) {
          if (!(error instanceof UnauthorizedError) || !stored.pending) throw error;
          return true;
        }
      });
      if (!waiting) return;
      for (;;) {
        const again = await exclusive(async () => {
          // Another helper may have finished this same attempt while our lease
          // was released. Use its tokens instead of exchanging the code twice.
          if (!stored.pending && stored.tokens?.access_token) {
            authorizing = false;
            await reconnect(client);
            return false;
          }
          if (!await restorePending()) throw new SignInError('expired', 'MosoFin sign-in link expired');
          let result;
          try {
            result = await api('poll', { body: { state: stored.pending.state }, secret: stored.pending.secret });
          } catch (error) {
            if (error.code === 'expired') { delete stored.pending; await save(); }
            throw error;
          }
          if (result.status === 'pending') { showPending(); return true; }
          if (result.status !== 'authorized' || typeof result.code !== 'string') {
            delete stored.pending;
            await save();
            throw new SignInError(result.status === 'denied' ? 'denied' : 'expired', 'MosoFin sign-in was not completed');
          }
          transport ||= makeTransport();
          await transport.finishAuth(result.code);
          // New tokens must work as-is; don't silently start a second flow.
          authorizing = false;
          await reconnect(client);
          verifier = undefined;
          return false;
        });
        if (!again) return;
        await delay(pollInterval, undefined, { signal });
      }
    } finally {
      authorizing = false;
      currentState = undefined;
    }
  }

  return {
    connect,
    exclusive,
    close: async () => { verifier = undefined; await transport?.close().catch(() => {}); },
  };
}
