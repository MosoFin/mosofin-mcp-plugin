# Release checks

## Automated (CI: `.github/workflows/validate.yml`)

Every test runs against loopback fixtures with synthetic OAuth — no real
credentials, workspaces or books, and no model requests. Node.js 22.12+,
npm and Python 3.11+ are required; `test_slow_signin.py` also needs a Claude
Code binary (`--claude /path/to/claude`, default: `claude` on PATH).

```bash
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
claude plugin validate skills --strict
claude plugin validate agents --strict
node --test scripts/callback-page.test.cjs scripts/session-start.test.cjs
npx --yes --ignore-scripts --package=mcp-remote@0.14.2 --package=@modelcontextprotocol/sdk@1.30.0 \
  --package=proper-lockfile@4.1.2 node scripts/conversation-signin.test.cjs
python3 scripts/test_local_connection.py
python3 scripts/test_remote_connection.py
python3 scripts/test_slow_signin.py
python3 scripts/package_plugin.py
```

Manifests skip `--strict` because `logo` and `domains` (kept for the xAI
marketplace) are unknown to Claude Code and only produce warnings.

| Script | Covers |
|---|---|
| `callback-page.test.cjs` | Branded localhost page: no code/state/provider text, `no-store`, nonce CSP, URL cleanup, other routes untouched |
| `session-start.test.cjs` | SessionStart hook: always emits the connection check and the prompt-to-connect instruction; detects a saved helper sign-in from file names only; never fails a session |
| `conversation-signin.test.cjs` | `mosofin_sign_in`: idle start, link, hosted callback, PKCE, same-session tools, saved sign-in, stale lock, shared refresh, revocation, denial, deadline, restart while pending, crash before/after consent, shared attempt, expiry cleanup, server without the feature, no secret leakage |
| `test_local_connection.py` | The `local` entry exactly as `.mcp.json` declares it, via `mosofin_connect`: no OAuth at startup, idempotent connect, restart reuse, refresh, owner-only files, sign-in deadline, clean shutdown |
| `test_remote_connection.py` | The `mosofin` HTTP entry stays a bare URL; standard MCP OAuth against it works |
| `test_slow_signin.py` | Real Claude Code engine: a 40 s sign-in doesn't trip MCP startup timeout; tools appear in the same session; the unauthenticated HTTP entry doesn't block the helper |
| `package_plugin.py` | Reproducible ZIP from an allowlist; manifest/marketplace versions agree; all runtime files present |

Passing these does not prove a real host signs in, routes skills correctly,
or returns real books. Do the manual checks below before claiming support.

## Claude Code acceptance (local)

Dedicated MosoFin test account, Node.js 22.12+ and npm installed.

1. Install `mosofin@financehub`; start a session and say "hi". Claude's
   first reply opens with a one-line prompt to connect MosoFin (the
   SessionStart hook). No browser opens. `/mcp`
   shows `plugin:mosofin:mosofin` (needs authentication) and
   `plugin:mosofin:local` (connected, three tools).
2. Ask "list my MosoFin workspaces". Expect `mosofin_connect` once, a browser
   sign-in, the MosoFin callback page, then a real `list_workspaces` in the
   same conversation and a workspace confirmation question. Take > 30 s once.
3. New conversation, then a Claude Code restart: no new sign-in.
4. Instead authenticate `plugin:mosofin:mosofin` in `/mcp` with `local` idle:
   the skill uses the HTTP tools and never calls a helper sign-in tool.
5. Uninstall Node from PATH: `local` fails at startup; the HTTP route still
   works via `/mcp` → Authenticate.

## Cowork acceptance (needs the server contract in `conversation-signin.md`)

1. New Cowork conversation: "Use MosoFin to list my workspaces." No browser
   from loading the plugin.
2. Expect `mosofin_sign_in` and a **Sign in to MosoFin** link — no settings
   page, no localhost page, no request to paste anything.
3. Final page is `https://mcp.mosofin.com/plugin-auth/done` with no code in
   the URL. Return, say "done": a real `list_workspaces` follows.
4. New conversation and full app restart: no new sign-in (if Cowork keeps the
   plugin data directory — record if it doesn't). Restart while consent is
   pending: the original link still completes.
5. Denial, an expired (5 min) link, and one retry recover with one fresh link.
6. With a working MosoFin connector already present, neither helper sign-in
   tool is called.

Record clicks and approvals, tool names, final status (`plugin_version`,
`helper_instance`, `connection_route`), and whether sign-in persisted. Keep
credentials and customer data out of release artifacts.
