// The plugin's `local` MCP server. It initialises instantly and idle, exposes
// three connection tools, and — once signed in — forwards every MosoFin tool
// from https://mcp.mosofin.com/mcp to the host in the same session.
//
//   mosofin_connection_status  read-only; may resume an existing sign-in, never starts one
//   mosofin_sign_in            sign-in link in the conversation (hosted callback; Cowork, remote hosts)
//   mosofin_connect            local Claude Code: mcp-remote browser sign-in with a localhost callback
//
// Loading this server must never open a browser: hosts start every bundled
// server, including beside an already working `mosofin` HTTP connection.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createConversationAuth, hasSavedConversationAuth } from './conversation-auth.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(readFileSync(path.join(root, '../.claude-plugin/plugin.json'), 'utf8')).version;

const STATUS = 'mosofin_connection_status';
const SIGN_IN = 'mosofin_sign_in';
const CONNECT = 'mosofin_connect';
const noArgs = { type: 'object', properties: {}, additionalProperties: false };

const localTools = [
  {
    name: STATUS,
    title: 'MosoFin connection status',
    description: 'Check whether this MosoFin plugin helper is signed in. Resumes a sign-in the user already started or a saved sign-in after a restart; never starts a new one. If idle and no working MosoFin data tools exist, call mosofin_sign_in (Cowork, remote hosts) or mosofin_connect (local Claude Code). Check once after the user returns; do not poll. This is not the status of a separate Claude-managed MosoFin connector, and not the status of a company file.',
    inputSchema: noArgs,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: SIGN_IN,
    title: 'Sign in to MosoFin',
    description: 'Sign in to MosoFin from this conversation when no working MosoFin data tools are available. Returns authorization_url: show it as a short "Sign in to MosoFin" link, then wait for the user to come back and say done. Completion arrives automatically through MosoFin — no localhost page, no codes to paste. Reuses a saved sign-in; calling again while waiting returns the same link. Never call it to test a connection that already works.',
    inputSchema: noArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: CONNECT,
    title: 'Connect MosoFin in local Claude Code',
    description: 'Start MosoFin sign-in for Claude Code in a local terminal or the Desktop Code tab. Reuses this helper’s saved login or opens a browser on this machine. Do not use in Cowork or remote hosts (the browser cannot reach this machine there); use mosofin_sign_in or the host’s own MosoFin sign-in instead. Calling again while connecting or after success does nothing new.',
    inputSchema: noArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];
const localNames = new Set(localTools.map(tool => tool.name));

const messages = {
  idle: 'This MosoFin helper is idle. Use existing MosoFin data tools if they work. Otherwise call mosofin_sign_in for a sign-in link in this conversation, or mosofin_connect in local Claude Code.',
  connecting: 'MosoFin is connecting. If a sign-in page opens, finish it and return to this conversation.',
  awaiting_sign_in: 'Waiting for MosoFin sign-in. Show authorization_url as a "Sign in to MosoFin" link; after the user returns, check status once. Never ask for codes, tokens or callback URLs.',
  awaiting_browser: 'Finish the MosoFin sign-in that opened in your browser, then return to this conversation.',
  connected: 'MosoFin is signed in. Discover the MosoFin data tools and continue the user’s request, starting with workspace confirmation.',
  failed: 'MosoFin sign-in could not finish or the connection closed. Call mosofin_sign_in once to retry (it resumes a valid link or makes a new one). If that fails too, report it; do not loop.',
  failed_local: 'The local MosoFin connection could not finish. Reconnect `plugin:mosofin:local` in /mcp and retry once. Do not reinstall the plugin.',
  unavailable: 'Conversation sign-in is not enabled on this MosoFin server. Use the host’s own MosoFin sign-in (/mcp → plugin:mosofin:mosofin → Authenticate, or Settings → Connectors → MosoFin), or mosofin_connect in local Claude Code.',
  needs_sign_in: 'The saved MosoFin sign-in no longer works. Call mosofin_sign_in once for a new link.',
};

export async function startConnectionServer({ sdkRoot, args }) {
  const endpoint = args[0];
  const timeoutAt = args.indexOf('--auth-timeout');
  const timeoutSeconds = timeoutAt < 0 ? 300 : Number(args[timeoutAt + 1]);
  const signInTimeout = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds * 1000 : 300_000;
  const authDirectory = process.env.MCP_REMOTE_CONFIG_DIR;
  const sdk = file => import(pathToFileURL(path.join(sdkRoot, 'dist/esm', file)).href);
  const [{ Server }, { StdioServerTransport }, { Client }, { StdioClientTransport }, types] = await Promise.all([
    sdk('server/index.js'), sdk('server/stdio.js'), sdk('client/index.js'), sdk('client/stdio.js'), sdk('types.js'),
  ]);

  const server = new Server({ name: 'MosoFin', version }, {
    capabilities: { tools: { listChanged: true }, resources: { listChanged: true }, prompts: { listChanged: true } },
  });
  const upstream = new Client({ name: 'MosoFin plugin helper', version }, { capabilities: {} });
  const instance = randomUUID();

  let state = 'idle';
  let reason;            // message key when it differs from state
  let route = 'none';    // none | conversation | local
  let link;              // { authorization_url, expires_in } while awaiting conversation sign-in
  let started = false;
  let closing = false;
  let initialized = false;
  let remoteCapabilities = {};
  let conversation;      // createConversationAuth() result
  let controller;
  let task;

  function statusResult() {
    const data = {
      state,
      message: messages[reason || state],
      ...(state === 'awaiting_sign_in' && link ? link : {}),
      plugin_version: version,
      helper_instance: instance,
      connection_route: route,
    };
    return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: state === 'failed' };
  }
  const set = (next, why) => { state = next; reason = why; };
  async function announce() {
    if (initialized && !closing) await server.sendToolListChanged().catch(() => {});
  }
  async function fail(why = route === 'local' ? 'failed_local' : undefined) {
    if (closing) return;
    link = undefined;
    const changed = state !== 'failed';
    set('failed', why);
    if (changed) {
      console.error('[MosoFin] Connection unavailable; check mosofin_connection_status.');
      await announce();
    }
  }
  async function becameConnected() {
    link = undefined;
    remoteCapabilities = upstream.getServerCapabilities() || {};
    set('connected');
    await announce();
    if (remoteCapabilities.resources) await server.sendResourceListChanged().catch(() => {});
    if (remoteCapabilities.prompts) await server.sendPromptListChanged().catch(() => {});
  }

  async function forward(request, extra, schema) {
    if (state !== 'connected') throw new types.McpError(types.ErrorCode.InternalError, messages[reason || state]);
    try {
      const progressToken = request.params?._meta?.progressToken;
      const send = () => upstream.request({ method: request.method, params: request.params }, schema, {
        signal: extra.signal,
        timeout: 300_000,
        ...(progressToken === undefined ? {} : {
          onprogress: progress => server.notification({ method: 'notifications/progress', params: { ...progress, progressToken } }).catch(() => {}),
        }),
      });
      return await (conversation ? conversation.exclusive(send) : send());
    } catch {
      // Never relay transport errors verbatim: they can contain authorization URLs.
      throw new types.McpError(types.ErrorCode.InternalError, 'MosoFin could not complete this request. Check mosofin_connection_status and retry when connected.');
    }
  }

  // ── conversation route ──────────────────────────────────────────────────
  async function startConversation(allowNewSignIn) {
    const retry = allowNewSignIn && route === 'conversation' && state === 'failed';
    if ((started && !retry) || closing) return;
    started = true;
    const previous = task;
    route = 'conversation';
    set('connecting');
    link = undefined;
    controller?.abort();
    await previous?.catch(() => {});
    await conversation?.close().catch(() => {});
    await upstream.close().catch(() => {});
    let linkShown;
    const linkReady = new Promise(resolve => { linkShown = resolve; });
    task = runConversation(allowNewSignIn, linkShown);
    // Return as soon as there is a link, a result, or after a short wait.
    let timer;
    await Promise.race([linkReady, task, new Promise(resolve => { timer = setTimeout(resolve, 8000); })]);
    clearTimeout(timer);
  }

  async function runConversation(allowNewSignIn, linkShown) {
    controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), signInTimeout);
    try {
      conversation = await createConversationAuth({
        endpoint, directory: authDirectory, signal: controller.signal, sdk,
        onNeedsSignIn: () => fail('needs_sign_in'),
        onLink: value => { link = value; set('awaiting_sign_in'); linkShown(); },
      });
      await conversation.connect(upstream, { allowNewSignIn });
      if (!closing) await becameConnected();
    } catch (error) {
      controller.abort();
      await conversation?.close().catch(() => {});
      await fail(['unavailable', 'needs_sign_in'].includes(error?.code) ? error.code : undefined);
    } finally {
      clearTimeout(deadline);
      linkShown();
    }
  }

  // ── local route (mcp-remote, localhost callback) ────────────────────────
  async function startLocal() {
    if (started || closing) return;
    started = true;
    route = 'local';
    set('connecting');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, 'oauth-helper.cjs'), ...args],
      env: process.env,
      stderr: 'pipe',
    });
    // Watch upstream diagnostics for the browser step; never forward them.
    createInterface({ input: transport.stderr }).on('line', line => {
      if (state === 'connecting' && /Please authorize this client|Opening browser|Browser opened/.test(line)) set('awaiting_browser');
    });
    try {
      await upstream.connect(transport, { timeout: signInTimeout });
      if (!closing) await becameConnected();
    } catch {
      await fail('failed_local');
      await upstream.close().catch(() => {});
    }
  }

  // ── MCP handlers ────────────────────────────────────────────────────────
  server.setRequestHandler(types.ListToolsRequestSchema, async (request, extra) => {
    if (state !== 'connected') return { tools: localTools };
    const result = await forward(request, extra, types.ListToolsResultSchema);
    const remote = result.tools.filter(tool => !localNames.has(tool.name));
    return { ...result, tools: [...(request.params?.cursor ? [] : localTools), ...remote] };
  });

  server.setRequestHandler(types.CallToolRequestSchema, async (request, extra) => {
    const { name } = request.params;
    if (name === STATUS) {
      if (!started && !closing) {
        try {
          if (await hasSavedConversationAuth({ endpoint, directory: authDirectory })) await startConversation(false);
        } catch {
          route = 'conversation';
          await fail();
        }
      }
      return statusResult();
    }
    if (name === SIGN_IN) {
      if (route === 'local' && state !== 'failed') return statusResult();
      await startConversation(true);
      return statusResult();
    }
    if (name === CONNECT) {
      if (route === 'conversation') return statusResult();
      void startLocal();
      await new Promise(resolve => setImmediate(resolve));
      return statusResult();
    }
    // A data tool before sign-in is an error, carrying the status so the model knows the next step.
    if (state !== 'connected') return { ...statusResult(), isError: true };
    return forward(request, extra, types.CallToolResultSchema);
  });

  for (const [requestSchema, resultSchema, capability, empty] of [
    [types.ListResourcesRequestSchema, types.ListResourcesResultSchema, 'resources', { resources: [] }],
    [types.ListResourceTemplatesRequestSchema, types.ListResourceTemplatesResultSchema, 'resources', { resourceTemplates: [] }],
    [types.ListPromptsRequestSchema, types.ListPromptsResultSchema, 'prompts', { prompts: [] }],
  ]) {
    server.setRequestHandler(requestSchema, (request, extra) => (
      state !== 'connected' || !remoteCapabilities[capability] ? empty : forward(request, extra, resultSchema)
    ));
  }
  server.setRequestHandler(types.ReadResourceRequestSchema, (request, extra) => forward(request, extra, types.ReadResourceResultSchema));
  server.setRequestHandler(types.GetPromptRequestSchema, (request, extra) => forward(request, extra, types.GetPromptResultSchema));

  upstream.setNotificationHandler(types.ToolListChangedNotificationSchema, announce);
  upstream.setNotificationHandler(types.ResourceListChangedNotificationSchema, () => (
    initialized && !closing ? server.sendResourceListChanged().catch(() => {}) : undefined));
  upstream.setNotificationHandler(types.PromptListChangedNotificationSchema, () => (
    initialized && !closing ? server.sendPromptListChanged().catch(() => {}) : undefined));
  upstream.onclose = () => (state === 'connected' && !closing ? fail() : undefined);
  upstream.onerror = () => {}; // reported through status, without raw auth logs

  async function shutdown() {
    if (closing) return;
    closing = true;
    controller?.abort();
    await task?.catch(() => {});
    await conversation?.close().catch(() => {});
    await upstream.close().catch(() => {});
    await server.close().catch(() => {});
  }
  server.oninitialized = () => { initialized = true; };
  server.onclose = shutdown;
  process.stdin.once('end', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.stdout.on('error', shutdown);

  await server.connect(new StdioServerTransport());
}
