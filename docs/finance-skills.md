# Finance skills — where they live and how this repo points at them

The accounting skills (`month-end-close-checklist`, `bank-reconciliation`,
`journal-entry-builder`, …) are **not in this repo**. They live in
[**mosofin/mosofin-finance-skills**](https://github.com/mosofin/mosofin-finance-skills)
and this repo lists them from its marketplace manifest.

This document is the pointer. Nothing here needs to change when a skill's text
changes — only when a new release is pinned.

## How the link works

This repo is a **marketplace** named `financehub`, and it publishes two plugins:

```
mosofin-mcp-plugin/
└── .claude-plugin/marketplace.json
    └── plugins[]
        ├── "mosofin"          source: "./"      ← this repo IS the plugin
        └── "mosofin-finance"  source: { url }   ← a different repo entirely
```

The second entry is the whole integration:

```json
{
  "name": "mosofin-finance",
  "source": {
    "source": "url",
    "url": "https://github.com/mosofin/mosofin-finance-skills.git",
    "ref": "v0.2.1",
    "sha": "cbd8107912877d70f7ffa9f18ab0c4b60e9813eb"
  }
}
```

At install time the plugin host (Claude Code, Grok Build):

1. reads `marketplace.json` from this repo,
2. clones `mosofin-finance-skills` at the pinned commit,
3. reads **that** repo's `.claude-plugin/plugin.json`,
4. loads **that** repo's `skills/*/SKILL.md`.

No skill file is ever copied into this repo. This repo holds a reference, not a
mirror — which is why there is no `skills/finance-*` directory here, and why one
must not be added. Everything under `skills/` in this repo is loaded as a skill of
the `mosofin` plugin, so a placeholder folder there would register a phantom skill.

## Install

```text
/plugin marketplace add mosofin/mosofin-mcp-plugin
/plugin install mosofin-finance@financehub
```

`mosofin` and `mosofin-finance` are independent — either can be installed without
the other. In practice both are wanted: `mosofin` provides the MCP connection and
the workspace/connection skills; `mosofin-finance` provides the accounting
procedures that read through it.

The finance skills require an active MosoFin subscription and a connected company
file. Setup is documented at
[docs.mosofin.com](https://docs.mosofin.com/start-here/quickstart), and each skill
links it inline.

## Releasing a change to the finance skills

**The `sha` is the release lever.** Because the entry is pinned to an exact commit,
pushing to `mosofin-finance-skills` changes nothing for users, and
`/plugin marketplace update financehub` will not move them. A finance-skills
release is a two-repo operation:

| # | Where | Do |
|---|---|---|
| 1 | `mosofin-finance-skills` | Merge the change to `main`; CI must be green |
| 2 | `mosofin-finance-skills` | Tag the release and push the tag |
| 3 | `mosofin-finance-skills` | Bump `version` in `.claude-plugin/plugin.json` to match |
| 4 | **here** | Update `ref`, `sha` and `version` on the `mosofin-finance` entry |
| 5 | users | `/plugin marketplace update financehub` then `/plugin update mosofin-finance@financehub` |

`sha` takes precedence over `ref`, so both must be updated together. Leaving a
stale `sha` beside a new `ref` silently ships the old tree.

`sha` must be the **commit**, not the annotated tag object — the two have
different hashes and `git ls-remote` prints both. The bare `refs/tags/vX` line is
the tag object; the `refs/tags/vX^{}` line is the commit. Use the `^{}` one. A
tag-object hash happens to survive `git fetch` (git peels it), so this mistake
does not fail loudly — but it does not match the resolved `HEAD`, so any
integrity check that compares the two will reject it.

Verify the pin resolves to what you intend before merging:

```bash
# the ^{} line is the commit the tag points at — that is the value for "sha"
git ls-remote https://github.com/mosofin/mosofin-finance-skills.git 'refs/tags/v0.2.1*'
```

## What is in the finance plugin

Ten skills in Wave 1. The full ship order for the remaining set is tracked in
[`deploy-queue.tsv`](https://github.com/mosofin/mosofin-finance-skills/blob/main/deploy-queue.tsv)
in that repo.

| Skill | Use it for |
|-------|------------|
| `month-end-close-checklist` | Driving a period close; the hub skill — it points at the others |
| `bank-reconciliation` | Reconciling a bank or credit card account to a statement |
| `journal-entry-builder` | Constructing and validating a balanced JE |
| `gl-coding-assistant` | Deciding which account a transaction belongs in |
| `financial-statement-builder` | P&L, balance sheet, cash flow |
| `ar-aging-and-collections` | Aging buckets and collection prioritisation |
| `invoice-data-extractor` | Pulling structured fields off an invoice |
| `three-way-match` | PO ↔ receipt ↔ invoice agreement |
| `duplicate-invoice-detection` | Finding duplicate or near-duplicate bills |
| `expense-report-processor` | Policy checks over expense reports |

All are **read-only**. Nothing posts an entry, files a return, or moves money —
every output is a proposal for a person to act on.

## Licensing

The two repos are licensed differently, deliberately:

| Repo | Licence | Why |
|------|---------|-----|
| `mosofin-mcp-plugin` (this) | MIT | Thin connection layer; maximum reuse |
| `mosofin-finance-skills` | AGPL-3.0-only | The accounting procedures are the product |

A marketplace may list plugins under licences other than its own. The `license`
field on each entry in `marketplace.json` is what users see, and it must match
the target repo's `LICENSE`.
