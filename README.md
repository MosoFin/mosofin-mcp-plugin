# MosoFin

Connect your AI assistant — Claude Code, claude.ai, Cowork, Grok Build,
ChatGPT, Codex, or any MCP client — to your financial data through the MosoFin
MCP server. Sign in once; the plugin is read-only and scoped to the workspace
you confirm. A MosoFin account is required (sign up at
[mosofin.com](https://mosofin.com)).

## Install

### Claude Code

```text
/plugin marketplace add mosofin/mosofin-mcp-plugin
/plugin install mosofin@financehub
```

Then just ask a MosoFin question. If you're not signed in yet, the
`/mosofin:connect` skill keeps your question, points you at `/mcp` →
`plugin:mosofin:mosofin` → **Authenticate**, and picks the question back up
when you say *done*.

### claude.ai, Claude Desktop and Cowork

Install **MosoFin** from the Claude plugin directory, or add it as a custom
connector at `https://mcp.mosofin.com/mcp` (**Settings → Connectors**), then
**Connect** and complete the MosoFin sign-in in the browser.

### Grok Build

The plugin uses the same manifest and skill format Grok Build reads. Once the
`mosofin` entry is listed in the
[xAI plugin marketplace](https://github.com/xai-org/plugin-marketplace),
install it from Grok Build's plugin catalog and sign in when prompted. Listing
status and the submission entry are in
[`docs/xai-marketplace-submission.md`](docs/xai-marketplace-submission.md).

### Any other MCP client

Add a remote MCP server at `https://mcp.mosofin.com/mcp` (Streamable HTTP,
OAuth). The client registers itself; there is nothing to configure.

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

MosoFin sign-in is standard OAuth handled by your AI host; the plugin takes no
part in it and ships no local helper. Ask your question first — the
`/mosofin:connect` skill notices when you're signed out, keeps your question,
gives the single sign-in step for the host you're in, and continues once you
say *done*.

| Host | Where sign-in happens |
|---|---|
| Claude Code | `/mcp` → `plugin:mosofin:mosofin` → **Authenticate**. Without a browser, use Claude Code's no-browser MCP sign-in for the same server. |
| Claude Desktop / claude.ai / Cowork | **Settings → Connectors** → MosoFin → **Connect** |
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

Declared for directory and marketplace review:

| Item | Detail |
|---|---|
| Network endpoints | `https://mcp.mosofin.com/mcp` only, hardcoded in `.mcp.json`. No user-configurable URL. Nothing is downloaded or installed. |
| Sign-in | OAuth in the browser, run entirely by your AI host (Claude Code, Claude Connectors, ChatGPT, Grok Build). The plugin takes no part in sign-in, stores nothing, and never asks you to type or paste anything from the sign-in flow into the chat. It reads nothing from your machine. |
| Data access | Read-only, scoped to the one workspace you confirm in the chat. No write, post, pay, or reconcile operations. `create_skill` saves a workflow description to your own MosoFin workspace only after you confirm. |
| Executable code | None. The plugin is one remote MCP server declaration, nine skills (Markdown), and one agent (Markdown). No hooks, scripts, binaries, or local servers. |
| Account | A MosoFin account is required to sign in; the plugin is free. |
| Telemetry | None from the plugin itself. |

Submitting this plugin to the [xAI plugin marketplace](https://github.com/xai-org/plugin-marketplace)
is documented in [`docs/xai-marketplace-submission.md`](docs/xai-marketplace-submission.md).

## Development

```text
.mcp.json   the MosoFin remote MCP server (Streamable HTTP, OAuth)
skills/     one SKILL.md per MCP tool or workflow
agents/     mosofin-analyst: read-only data analyst for delegation
docs/       tool contract and public workflow resources
```

Validate locally with `claude plugin validate --strict .`; CI runs the same
checks. Bump `version` in both `plugin.json` files and both marketplace
entries together.

## Contributing

Issues and pull requests are welcome for documentation fixes, additional
read-only review patterns, and improvements to this connector plugin. Keep examples synthetic, state required source
coverage, separate facts from assumptions, and do not add instructions that
post, send, pay, reconcile, or otherwise change source records. For a new
workflow, include its audience, required inputs, expected output, review
checkpoints, and failure behavior.

## License

MIT. See [LICENSE](LICENSE).
