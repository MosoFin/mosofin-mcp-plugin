# Submitting MosoFin to the xAI plugin marketplace

> **Status:** submitted as [xai-org/plugin-marketplace#623](https://github.com/xai-org/plugin-marketplace/pull/623)
> as a remote source pinned to commit `5f9a391`.

The [xAI plugin marketplace](https://github.com/xai-org/plugin-marketplace) is an
index, not a host. Submitting means opening a PR that adds **one entry** to
`.grok-plugin/marketplace.json` in that repo, pointing at this repo as a remote
source pinned to a full commit SHA. Nothing from this repo is vendored there.

> **Before re-pinning (0.5.0+):** this release adds an optional local MCP
> server (`runtime/`, run through `npx` with pinned packages) beside the HTTP
> server, plus a SessionStart hook (`hooks/hooks.json`). The "no scripts/hooks/binaries" disclosure submitted at `5f9a391` no
> longer holds — update the PR description with the current
> [README → Security and network access](../README.md#security-and-network-access)
> table when bumping the `sha`, and expect review of the stdio entry.

## What this repo already satisfies

| Requirement (xAI `CONTRIBUTING.md`) | Status here |
|---|---|
| Valid plugin manifest | `.grok-plugin/plugin.json` (Grok-native) and `.claude-plugin/plugin.json` (Claude Code) — identical content; keep both in sync when bumping version |
| `README.md` + `homepage` | `README.md`; `homepage: https://mosofin.com` |
| Clear description, brand-scoped `keywords` / `domains`, `category` | Set on both entries in `.grok-plugin/marketplace.json` (mirrored in `.claude-plugin/marketplace.json`) |
| License stated | MIT ([LICENSE](../LICENSE)) |
| Remote sources pinned to a 40-char lowercase SHA | The marketplace lists only `mosofin` (`source: "./"`), so there is no remote source to pin; the xAI catalog entry itself pins this repo's SHA |
| Official org source, not a personal account | `github.com/MosoFin/mosofin-mcp-plugin` |
| Security expectations | Disclosed in [README → Security and network access](../README.md#security-and-network-access): one hardcoded HTTPS host, OAuth in browser, read-only, one optional readable-source local MCP server with pinned npm packages, one SessionStart hook that only adds context (no network, no credential reads), no binaries, no telemetry |
| Portable `.mcp.json` | Production URL is literal — no `${user_config.*}` substitution, which only Claude Code expands. The `local` stdio entry uses `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}`; confirm Grok Build expands them — if not, the `local` entry fails to start there and the HTTP entry is unaffected |
| `generate-plugin-index.py` sees the components | Dry run at `5f9a391` indexed 8 skills, 1 agent, 1 HTTP MCP server; 0.5.0 has 9 skills, 1 agent, 1 SessionStart hook, 1 HTTP + 1 stdio MCP server |

## Steps

1. Push the commit you want to ship to `main` of this repo.
2. Get the SHA to pin:

   ```bash
   git ls-remote https://github.com/MosoFin/mosofin-mcp-plugin.git HEAD
   ```

3. Fork `xai-org/plugin-marketplace`, branch from `main`, and append the entry
   below to the `plugins` array in `.grok-plugin/marketplace.json`, replacing
   `<SHA>` with the value from step 2.
4. Regenerate the index and validate — from the fork's root:

   ```bash
   python3 scripts/generate-plugin-index.py
   python3 scripts/validate-catalog.py
   python3 scripts/generate-plugin-index.py --check
   ```

5. Open the PR against `xai-org/plugin-marketplace` and fill in the template.

## Catalog entry to submit

```json
{
  "name": "mosofin",
  "description": "Connect Grok Build to MosoFin: authenticated, workspace-scoped, read-only financial data across connected SaaS platforms.",
  "category": "finance",
  "source": {
    "source": "url",
    "url": "https://github.com/MosoFin/mosofin-mcp-plugin.git",
    "sha": "<SHA>"
  },
  "homepage": "https://mosofin.com",
  "version": "0.4.0",
  "author": { "name": "MosoFin", "email": "support@mosofin.com" },
  "keywords": ["mosofin", "mcp", "integrations", "oauth", "automation", "productivity", "finance"],
  "domains": ["mosofin.com", "app.mosofin.com", "mcp.mosofin.com", "docs.mosofin.com"]
}
```

`domains` are brand-scoped. Note that xAI's contributing guide pushes back on
generic `keywords` (`mcp`, `finance`, `automation`, …) because they drive the
plugin CTA and can mis-fire on unrelated requests — if review asks, trim the
list to `mosofin`-prefixed terms.

`mosofin` is the only plugin this repo publishes.

## Updating after it lands

Bump the `sha` in the xAI catalog entry and regenerate the index there — don't
open a parallel duplicate entry. Keep every pinned commit reachable on `main`;
a force-push away from a pinned SHA fails their CI loudly.
