# MosoFin

Connect Claude Code or ChatGPT to your QuickBooks and business data through
the MosoFin MCP server. Sign in once; the plugin is read-only and scoped to
the workspace you confirm.

## Install

### Claude Code

```text
/plugin marketplace add mosofin/mosofin-plugins
/plugin install mosofin@financehub
```

Sign in in the browser when prompted.

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
is not a QuickBooks reconnect.

Then:

1. Confirm the workspace for this chat.
2. Ask a business-data question, or run `/mosofin:query-workspace`.

## Update

Claude Code does not pick up GitHub changes automatically. After this repo
updates, refresh the marketplace and the plugin:

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
| `/mosofin:workspaces` | List, confirm, or switch the workspace for this chat |
| `/mosofin:connections` | See which company files are connected |
| `/mosofin:list-tools` | What API operations are available |
| `/mosofin:run-tool` | Run one named catalog operation |
| `/mosofin:list-skills` | List saved MosoFin skills in the workspace |
| `/mosofin:replay-skill` | Replay a saved skill after you confirm |
| `/mosofin:query-workspace` | Any open data question, end to end |
| `/mosofin:save-skill` | Save a proven workflow after results exist |

## Finance skills (separate repo)

The accounting skills are **not in this repo**. They live in
[mosofin/mosofin-finance-skills](https://github.com/mosofin/mosofin-finance-skills)
and are published through this marketplace as a second plugin:

```text
/plugin marketplace add mosofin/mosofin-plugins
/plugin install mosofin-finance@financehub
```

That installs ten read-only accounting procedures — month-end close, bank
reconciliation, journal entries, GL coding, financial statements, AR aging,
invoice extraction, three-way match, duplicate detection, expense review — which
read your live books through the MosoFin connection this plugin provides. They
require an active MosoFin subscription; setup is at
[docs.mosofin.com](https://docs.mosofin.com/start-here/quickstart).

`mosofin` and `mosofin-finance` install independently. How the two repos are
wired together, and how to cut a finance-skills release, is documented in
[`docs/finance-skills.md`](./docs/finance-skills.md).

## Public workflow resources

- [Financial review prompt library](docs/financial-review-prompt-library.md) — starting prompts for P&L review, cash questions, A/R exceptions, multi-client work, and selected-company analysis.
- [Implementation notes](docs/implementation-notes.md) — the workspace, permission, source-grounding, and human-review decisions behind the plugin.
- [Multi-client month-end review checklist](https://www.mosofin.com/multi-client-quickbooks-month-end-review-checklist) — public web checklist plus printable PDF, editable workbook, and prompt pack.

These resources are examples, not accounting conclusions. Confirm the workspace,
company, period, basis, and available source coverage before a run. MosoFin tools
are read-only; the responsible person reviews the support and owns every decision,
correction, communication, and sign-off.

## Contributing

Issues and pull requests are welcome for documentation fixes, additional
read-only review patterns, and improvements to this connector plugin. Financial
skill implementations belong in the separate `mosofin-finance-skills`
repository linked above. Keep examples synthetic, state required source
coverage, separate facts from assumptions, and do not add instructions that
post, send, pay, reconcile, or otherwise change source records. For a new
workflow, include its audience, required inputs, expected output, review
checkpoints, and failure behavior.

## License

MIT. See [LICENSE](LICENSE).
