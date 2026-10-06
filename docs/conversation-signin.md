# Conversation sign-in and the local helper

The plugin reaches `https://mcp.mosofin.com/mcp` two ways (`.mcp.json`):

| Entry | Transport | Who signs in | For |
|---|---|---|---|
| `mosofin` | HTTP | The host (Claude Code `/mcp`, Claude Connectors, ChatGPT, Grok) | Everywhere; needs nothing local |
| `local` | stdio → `runtime/connect.cjs` (Node.js 22.12+, npm) | The plugin helper, from the conversation | Hosts whose own sign-in can't finish — e.g. a `localhost` callback the browser can't reach (Cowork), or a user who prefers not to leave the chat |

Only one working route is needed. Skills check for working tools first and
never sign in to a second route (`skills/connect/SKILL.md`).

## The `local` helper

`runtime/connection-server.mjs` is an MCP server that initialises instantly
and **idle**: loading it, listing tools and reading status never starts
OAuth or opens a browser. Until signed in it exposes three tools:

| Tool | Does |
|---|---|
| `mosofin_connection_status` | Read-only. Resumes a sign-in already started, or saved tokens, after a restart. Never starts a new one. |
| `mosofin_sign_in` | **Conversation sign-in.** Returns `authorization_url` for a "Sign in to MosoFin" link; completion arrives through MosoFin (below). |
| `mosofin_connect` | **Local Claude Code.** Runs the pinned `mcp-remote` OAuth flow with a localhost callback and a MosoFin-branded page (`runtime/callback-page.cjs`). |

Once connected it forwards every MosoFin tool (`list_workspaces`,
`invoke_datasource_api_tool`, …) and sends `tools/list_changed`, so the data
tools appear in the same session as `mcp__plugin_mosofin_local__<tool>`.

Status results always include `state`, `message`, `plugin_version`,
`helper_instance` and `connection_route` (`none` | `conversation` |
`local`) — non-secret fields for diagnosing a host report.

Pinned packages, fetched by `npx` on first use with install scripts
disabled: `mcp-remote@0.14.2`, `@modelcontextprotocol/sdk@1.30.0`,
`proper-lockfile@4.1.2`. Credentials live under
`${CLAUDE_PLUGIN_DATA}/auth` with owner-only permissions:
`mcp-remote-v1/` for `mosofin_connect`, `conversation/` for `mosofin_sign_in`.
The helper never reads or copies the host's own MosoFin tokens.

## Conversation sign-in flow

```
model ── mosofin_sign_in ──▶ helper
helper ── GET  /plugin-auth/status                     (feature on?)
helper ── DCR, redirect_uri = https://mcp.mosofin.com/plugin-auth/callback
helper ── POST /plugin-auth/requests {state, client_id, code_challenge, poll_token_hash}
helper ◀─ authorization_url  (persisted with the PKCE verifier + poll secret first)
model  ── shows [Sign in to MosoFin](authorization_url)
user   ── browser: /authorize → consent → /plugin-auth/callback?code&state → 303 /plugin-auth/done
helper ── POST /plugin-auth/poll {state}, Authorization: Bearer <poll secret>   (every `interval` s)
helper ◀─ {status: "authorized", code}  → token exchange with its private PKCE verifier
helper ── tools/list_changed → MosoFin tools appear; user says "done"; model continues
```

Only the authorization URL ever reaches the model. The poll secret, PKCE
verifier, code and tokens stay between the helper and MosoFin and never
appear in tool results or logs (asserted by
`scripts/conversation-signin.test.cjs`).

Restarts: the pending attempt (state, verifier, poll secret, URL, deadline ≤
5 min) is written — atomically, `0600` — **before** the link is shown, so a
host that kills the helper after the tool returns loses nothing: the next
helper's `mosofin_connection_status` finishes the same attempt. Completion,
denial or expiry deletes it. `proper-lockfile` serialises cache and network
work across concurrent helpers and reclaims stale locks after a crash; the
lease is released between polls so another helper can resume.

## Server contract — required on mcp.mosofin.com

`mosofin_sign_in` works only when the MosoFin server implements these
endpoints. Until then it returns `failed` with "Conversation sign-in is not
enabled on this MosoFin server" — **without** registering a client or
showing a link — and the skill falls back to the host's own sign-in. The
HTTP route and `mosofin_connect` need no server change.

All bodies are JSON. Never log request queries, bodies or `Authorization`
headers on `/plugin-auth/*`. Responses carry `Cache-Control: no-store`.

### `GET /plugin-auth/status`

`200 {"enabled": true}` when the feature is on. `404` when off (the plugin's
off switch — use a feature flag, default off).

### DCR and `/authorize`

Dynamic client registration must accept
`redirect_uris: ["https://mcp.mosofin.com/plugin-auth/callback"]`
(`client_name: "MosoFin conversation sign-in"`, public client,
`token_endpoint_auth_method: none`), and `/authorize` must accept that
redirect URI with S256 PKCE. Token exchange and refresh are unchanged.

### `POST /plugin-auth/requests`

Body: `{state, client_id, code_challenge, poll_token_hash}` — `state` is 43
base64url chars; `poll_token_hash` is the hex SHA-256 of a 43-char secret the
helper keeps. Create a **mailbox** keyed by `state`, TTL ≤ 300 s.

- `201 {"expires_in": 300, "interval": 2}`
- `400` malformed / oversize fields; `409` a mailbox for that `state` exists
  (never replace one); `429` per-source creation throttle.
- Store only the hash, never the secret.

### `GET /plugin-auth/callback?code&state` (browser)

Look up the mailbox by `state`. For a `code`, verify it was issued to the
mailbox's `client_id` **and** `code_challenge` before depositing it (a
forged, cross-client or replayed callback must not complete anything). For
`error=…`, mark the mailbox `denied`. Then `303` to `/plugin-auth/done` so
the code leaves the address bar. Unknown or expired `state` → a static error
page, `400`.

### `GET /plugin-auth/done`

Static page, no external resources, `Referrer-Policy: no-referrer`:
"Signed in to MosoFin — return to your conversation and say *done*."

### `POST /plugin-auth/poll`

Body `{state}`, header `Authorization: Bearer <secret>`; compare
`sha256(secret)` to the stored hash in constant time.

- `200 {"status": "pending"}` — not yet.
- `200 {"status": "authorized", "code": "…"}` — **once**; delete the mailbox
  on delivery.
- `200 {"status": "denied"}` — delete the mailbox.
- `404` unknown/wrong secret, `410` expired — the helper treats both as an
  expired link.

The mailbox is a delivery channel for an ordinary OAuth code, not a token
issuer or an unauthenticated MCP endpoint: consent at `/authorize` stays
mandatory, and the code is still useless without the helper's PKCE verifier.
`scripts/conversation-signin.test.cjs` contains a reference fixture of this
exact protocol.

### Rollout

1. Implement behind a flag, default off; deploy; check `/plugin-auth/done`
   and that `/plugin-auth/status` returns `404` with the flag off.
2. Turn it on for `mcp.mosofin.com` only; verify a fresh sign-in with a test
   account (see `docs/testing.md`, Cowork acceptance).
3. Rollback = flag off. Existing host-managed and `mosofin_connect` sign-ins
   are unaffected; never delete users' auth caches.
