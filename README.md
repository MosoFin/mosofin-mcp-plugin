# MosoFin

Connect your AI assistant — Claude Code, Grok Build, ChatGPT, Codex, or any
MCP client — to your financial data through the MosoFin MCP server. Sign in once; the plugin is read-only and scoped to
the workspace you confirm.

## Install

### Claude Code

```text
/plugin marketplace add mosofin/mosofin-mcp-plugin
/plugin install mosofin@financehub
```

At the start of every session the plugin checks whether MosoFin is connected.
If it isn't, Claude's first reply opens with a one-line prompt to connect.
Then just ask a MosoFin question. If you're not signed in yet, Claude signs
you in from the conversation — a browser sign-in opens (or you get a **Sign in
to MosoFin** link) — and picks your question back up when you say *done*.

`/mcp` lists two MosoFin entries; you only ever need one of them working:

| Entry | What it is |
|---|---|
| `plugin:mosofin:mosofin` | Direct HTTP connection; Claude Code manages its sign-in (`/mcp` → Authenticate) |
| `plugin:mosofin:local` | Optional helper that signs in from the conversation. Needs Node.js 22.12+ and npm; without them it shows *failed* and the HTTP entry still works |

### Grok Build

The plugin uses the same manifest and skill format Grok Build reads. Once the
`mosofin` entry is listed in the
[xAI plugin marketplace](https://github.com/xai-org/plugin-marketplace),
install it from Grok Build's plugin catalog and sign in when prompted. Listing
status and the submission entry are in
[`docs/xai-marketplace-submission.md`](docs/xai-marketplace-submission.md).

### Any other MCP client

Add a remote MCP server at `https://mcp.mosofin.com/mcp` (Streamable HTTP,
OAuth). The client registers itself; no client id or secret is shipped.

### ChatGPT and Codex

1. Open ChatGPT on the web → **Settings → Apps & Connectors** (or [chatgpt.com/plugins](https://chatgpt.com/plugins)).
2. Turn on **Developer mode** if you are adding a custom connector (**Settings → Security and login**, or Apps → Advanced settings).
3. Create **MosoFin**:
   - Name: `MosoFin`
   - MCP server URL: `https://mcp.mosofin.com/mcp`
   - Authentication: **OAuth**
4. Complete MosoFin sign-in in the browser.
5. Start a **new** chat, turn on the MosoFin app/connector, then continue below.

If you see `Unknown tool: mosofin.list_workspaces`, MosoFin is not enabled for
this chat. Connect it as above (or turn the app on in this conversation). That
is not a data-source reconnect.

## Signing in

MosoFin sign-in is standard OAuth handled by your AI host; the plugin ships no
client id, secret, or local helper. Ask your question first — the
`/mosofin:connect` skill notices when you're signed out, keeps your question,
gives the single sign-in step for the host you're in, and continues once you
say *done*.

| Host | Where sign-in happens |
|---|---|
| Claude Code | Ask a question — the helper opens browser sign-in. Or `/mcp` → `plugin:mosofin:mosofin` → **Authenticate**. Headless: `claude mcp login plugin:mosofin:mosofin --no-browser` |
| Cowork | A **Sign in to MosoFin** link in the conversation (once MosoFin's hosted sign-in is enabled — see [`docs/conversation-signin.md`](docs/conversation-signin.md)); otherwise **Settings → Connectors** → MosoFin → **Connect** |
| Claude Desktop / claude.ai | **Settings → Connectors** → MosoFin → **Connect** |
| ChatGPT / Codex | **Settings → Apps & Connectors** (steps above), then a new chat with MosoFin on |
| Grok Build | The sign-in prompt shown after installing `mosofin` |

Signing in to MosoFin is separate from a company file (e.g. QuickBooks)
showing as disconnected; that is fixed with the `reconnect_url` MosoFin
returns, or on the workspace data-sources page (`/mosofin:connections`).

Then:

1. Confirm the workspace for this chat.
2. Ask a business-data question, or run `/mosofin:query-workspace`.

## Update

Plugin hosts do not pick up GitHub changes automatically. After this repo
updates, refresh the marketplace and the plugin (Claude Code shown):

```text
/plugin marketplace update financehub
/plugin update mosofin@financehub
```

Codex and ChatGPT talk to the live MosoFin MCP server, so server tools update
without this step. Skill text in this repo updates only after you refresh the
plugin as above.

## Skills

| Skill | When to use |
|-------|-------------|
| `/mosofin:connect` | Sign in to MosoFin from the conversation, then continue |
| `/mosofin:workspaces` | List, confirm, or switch the workspace for this chat |
| `/mosofin:connections` | See which company files are connected |
| `/mosofin:list-tools` | What API operations are available |
| `/mosofin:run-tool` | Run one named catalog operation |
| `/mosofin:list-skills` | List saved MosoFin skills in the workspace |
| `/mosofin:replay-skill` | Replay a saved skill after you confirm |
| `/mosofin:query-workspace` | Any open data question, end to end |
| `/mosofin:save-skill` | Save a proven workflow after results exist |

## Public workflow resources

- [Financial review prompt library](docs/financial-review-prompt-library.md) — starting prompts for P&L review, cash questions, A/R exceptions, multi-client work, and selected-company analysis.
- [Implementation notes](docs/implementation-notes.md) — the workspace, permission, source-grounding, and human-review decisions behind the plugin.
- [Multi-client month-end review checklist](https://www.mosofin.com/multi-client-quickbooks-month-end-review-checklist) — public web checklist plus printable PDF, editable workbook, and prompt pack.

These resources are examples, not accounting conclusions. Confirm the workspace,
company, period, basis, and available source coverage before a run. MosoFin tools
are read-only; the responsible person reviews the support and owns every decision,
correction, communication, and sign-off.

## Security and network access

Declared for marketplace review (per the xAI marketplace
[security expectations](https://github.com/xai-org/plugin-marketplace/blob/main/CONTRIBUTING.md#security-expectations)):

| Item | Detail |
|---|---|
| Network endpoints | `https://mcp.mosofin.com` only (`/mcp`, and `/plugin-auth/*` for conversation sign-in), hardcoded in `.mcp.json` and `runtime/conversation-auth.mjs`. No user-configurable URL. On first run `npx` fetches two pinned npm packages from the npm registry. |
| Credentials | OAuth in the browser. The `mosofin` HTTP entry's tokens are held by the host. The `local` helper keeps its own tokens under `${CLAUDE_PLUGIN_DATA}/auth`, owner-only (`0600`/`0700`); it never copies the host's tokens and never puts codes, verifiers or tokens in tool results or logs. The plugin never reads `.env`, `~/.ssh`, or environment secrets. |
| Data access | Read-only, scoped to the one workspace you confirm in the chat. No write, post, pay, or reconcile operations. |
| Executable code | One optional local MCP server and one SessionStart hook, `runtime/` (Node.js, ~900 lines of readable source — no binaries or install steps). The hook (`hooks/hooks.json` → `runtime/session-start.cjs`) only adds a connection-check instruction to Claude's context; it makes no network calls and reads no credential contents (it checks whether the helper's saved-login files exist). `npx` runs it with install scripts disabled, using pinned `mcp-remote@0.14.2` and `@modelcontextprotocol/sdk@1.30.0` (their own dependency ranges are resolved by npm). It starts idle and opens no browser until a sign-in tool is called. It runs with the user's OS permissions and adds no file-browsing or shell tools. The `mosofin` HTTP entry works without it. |
| Tests and CI | `scripts/` (synthetic OAuth on loopback only) and `.github/workflows/validate.yml`; not included in the release ZIP. |
| Telemetry | None from the plugin itself. |

Submitting this plugin to the [xAI plugin marketplace](https://github.com/xai-org/plugin-marketplace)
is documented in [`docs/xai-marketplace-submission.md`](docs/xai-marketplace-submission.md).

## Development

```text
hooks/     hooks.json: SessionStart → runtime/session-start.cjs (connection check + prompt to connect)
runtime/   the `local` helper: connect.cjs (entry) → connection-server.mjs (MCP server)
           ├─ conversation-auth.mjs    mosofin_sign_in (hosted callback)
           ├─ oauth-helper.cjs         mosofin_connect (pinned mcp-remote)
           └─ callback-page.cjs/.html  branded localhost callback page
scripts/   tests (synthetic fixtures) and package_plugin.py
```

Run the checks in [`docs/testing.md`](docs/testing.md); CI runs the same set.
`python3 scripts/package_plugin.py` builds `dist/mosofin-<version>.zip` plus a
SHA-256. Bump `version` in both `plugin.json` files and both marketplace
entries together — the packager refuses mismatches.

## Contributing

Issues and pull requests are welcome for documentation fixes, additional
read-only review patterns, and improvements to this connector plugin. Keep examples synthetic, state required source
coverage, separate facts from assumptions, and do not add instructions that
post, send, pay, reconcile, or otherwise change source records. For a new
workflow, include its audience, required inputs, expected output, review
checkpoints, and failure behavior.

## License

MIT. See [LICENSE](LICENSE).
