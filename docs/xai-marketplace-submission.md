# Submitting MosoFin to the xAI plugin marketplace

The [xAI plugin marketplace](https://github.com/xai-org/plugin-marketplace) is an
index, not a host. Submitting means opening a PR that adds **one entry** to
`.grok-plugin/marketplace.json` in that repo, pointing at this repo as a remote
source pinned to a full commit SHA. Nothing from this repo is vendored there.

## What this repo already satisfies

| Requirement (xAI `CONTRIBUTING.md`) | Status here |
|---|---|
| Valid plugin manifest | `.claude-plugin/plugin.json` — explicitly accepted for Claude-ecosystem plugins, alongside `.grok-plugin/plugin.json` |
| `README.md` + `homepage` | `README.md`; `homepage: https://mosofin.com` |
| Clear description, brand-scoped `keywords` / `domains`, `category` | Set on both entries in `.claude-plugin/marketplace.json` |
| License stated | MIT ([LICENSE](../LICENSE)); `mosofin-finance` is AGPL-3.0-only in its own repo |
| Remote sources pinned to a 40-char lowercase SHA | The `mosofin-finance` entry is pinned; `python3 scripts/validate-catalog.py` from the xAI repo passes against `.claude-plugin/marketplace.json` |
| Official org source, not a personal account | `github.com/MosoFin/mosofin-mcp-plugin` |
| Security expectations | Disclosed in [README → Security and network access](../README.md#security-and-network-access): one HTTPS MCP endpoint, OAuth in browser, read-only, no scripts/hooks/binaries, no telemetry |

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
  "description": "Connect Grok Build to MosoFin: authenticated, workspace-scoped, read-only business data across connected SaaS platforms, including QuickBooks.",
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
  "domains": ["mosofin.com", "mcp.mosofin.com", "docs.mosofin.com"]
}
```

`domains` are brand-scoped. Note that xAI's contributing guide pushes back on
generic `keywords` (`mcp`, `finance`, `automation`, …) because they drive the
plugin CTA and can mis-fire on unrelated requests — if review asks, trim the
list to `mosofin`-prefixed terms and `quickbooks`.

Submit `mosofin` first. `mosofin-finance` lives in
[mosofin/mosofin-finance-skills](https://github.com/mosofin/mosofin-finance-skills)
and would be a separate entry pinned to that repo's own SHA.

## Updating after it lands

Bump the `sha` in the xAI catalog entry and regenerate the index there — don't
open a parallel duplicate entry. Keep every pinned commit reachable on `main`;
a force-push away from a pinned SHA fails their CI loudly.
