#!/usr/bin/env python3
"""Exercise the bundled `mosofin` HTTP entry with synthetic OAuth — no local helper.

Checks that the shipped entry is a plain HTTP server (no command, headers or
secrets) and that standard MCP OAuth against it works: discovery, DCR, PKCE,
workspace calls, saved-login reuse, refresh.
"""

import json
import subprocess

from mosofin_fixture import Fixture, PRODUCTION, ROOT, clean_env, fixture_url, start


def main():
    config = json.loads((ROOT / ".mcp.json").read_text())["mcpServers"]["mosofin"]
    assert config == {"type": "http", "url": PRODUCTION}, "the HTTP entry must stay a bare production URL"
    server = start()
    env = {**clean_env(), "NPM_CONFIG_IGNORE_SCRIPTS": "true"}
    try:
        subprocess.run(
            ["npx", "--yes", "--ignore-scripts", "--package=@modelcontextprotocol/sdk@1.30.0", "--package=proper-lockfile@4.1.2",
             "--package=mcp-remote@0.14.2", "node", str(ROOT / "scripts/remote-client.test.cjs")],
            input=json.dumps({**config, "url": fixture_url(server)}), text=True, env=env, check=True, timeout=90)
        assert Fixture.registrations == 1, "the client reuses its registration"
        assert Fixture.authorizations == 1, "only the first session signs in"
        assert Fixture.refreshes == 1, "an expired access token refreshes"
        assert Fixture.calls == 3
        print("PASS: bundled HTTP entry, OAuth discovery, DCR, PKCE, workspace calls, saved-login reuse, refresh; no local helper used")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
