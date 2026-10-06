#!/usr/bin/env python3
"""Run the packaged `local` server exactly as .mcp.json declares it, against a
loopback MosoFin fixture, and drive the mosofin_connect (mcp-remote) route.

Checks: idle start without OAuth, explicit and idempotent connect, branded
callback, PKCE, same-session tools, restart reuse, token refresh, owner-only
credential files, sign-in deadline, clean shutdown. Synthetic credentials only.
"""

import json
import os
from pathlib import Path
import queue
import signal
import socket
import subprocess
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen

from mosofin_fixture import Fixture, PRODUCTION, ROOT, clean_env, fixture_url, start

LOCAL_TOOLS = ["mosofin_connection_status", "mosofin_sign_in", "mosofin_connect"]
INIT = {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "fixture-host", "version": "1"}}


class Helper:
    def __init__(self, config, env):
        self.process = subprocess.Popen([config["command"], *config["args"]], env=env, text=True,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        start_new_session=True)
        self.messages = queue.Queue()
        self.stderr = []
        self.notifications = []
        self.url_file = Path(env["SYNTHETIC_AUTH_URL_FILE"])
        self.authorize = True
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=lambda: [self.stderr.append(line) for line in self.process.stderr], daemon=True).start()

    def _read_stdout(self):
        for line in self.process.stdout:
            try:
                self.messages.put(json.loads(line))
            except ValueError:
                self.messages.put({"error": "non-JSON text on MCP stdout"})

    def _complete_browser_sign_in(self):
        url = self.url_file.read_text()
        self.url_file.unlink()
        assert urlsplit(url).hostname == "127.0.0.1"
        callback = urlsplit(parse_qs(urlsplit(url).query)["redirect_uri"][0])
        ready_by = time.monotonic() + 10
        while True:
            try:
                with socket.create_connection((callback.hostname, callback.port), timeout=0.2):
                    break
            except OSError:
                if time.monotonic() > ready_by:
                    raise AssertionError("OAuth callback listener did not start")
                time.sleep(0.05)
        with urlopen(url, timeout=10) as response:
            html = response.read().decode()
            assert response.status == 200
            assert "You’re connected to MosoFin." in html
            assert "fixture-code" not in html and "return to the CLI" not in html
            assert response.headers["Cache-Control"] == "no-store"
            assert "default-src 'none'" in response.headers["Content-Security-Policy"]

    def request(self, ident, method, params=None):
        message = {"jsonrpc": "2.0", "method": method}
        if ident is not None:
            message["id"] = ident
        if params is not None:
            message["params"] = params
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()
        if ident is None:
            return None
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if self.authorize and self.url_file.exists():
                self._complete_browser_sign_in()
            try:
                result = self.messages.get(timeout=0.1)
            except queue.Empty:
                if self.process.poll() is not None:
                    break
                continue
            if "method" in result and "id" not in result:
                self.notifications.append(result["method"])
            if result.get("id") == ident:
                assert "error" not in result, result
                return result["result"]
        raise AssertionError(f"helper did not answer {method}: {''.join(self.stderr)[-1500:]}")

    def call(self, ident, name):
        return self.request(ident, "tools/call", {"name": name, "arguments": {}})

    def status(self):
        return self.call(80, "mosofin_connection_status")["structuredContent"]

    def wait_connected(self):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            state = self.status()["state"]
            assert state != "failed", self.status()
            if state == "connected":
                return
            time.sleep(0.1)
        raise AssertionError("connection did not finish")

    def close(self, graceful=False):
        if graceful:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.close()
                raise AssertionError("host disconnect left the helper running")
            assert self.process.returncode == 0, "helper should exit cleanly when the host disconnects"
            return
        try:
            os.killpg(self.process.pid, signal.SIGTERM)
            self.process.wait(timeout=5)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            if self.process.poll() is None:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait()


def packaged_config(server):
    config = json.loads((ROOT / ".mcp.json").read_text())["mcpServers"]["local"]
    assert PRODUCTION in config["args"], "the shipped helper must target production"
    config["args"] = [a.replace(PRODUCTION, fixture_url(server)).replace("${CLAUDE_PLUGIN_ROOT}", str(ROOT)) for a in config["args"]]
    return config


def main():
    with tempfile.TemporaryDirectory(prefix="mosofin-local-test-") as temporary:
        root = Path(temporary)
        # A scripted "browser" records the authorization URL; the test follows it.
        bin_dir = root / "bin"
        bin_dir.mkdir()
        for name in ("xdg-open", "gio", "x-www-browser", "wslview", "open"):
            (bin_dir / name).write_text("#!/bin/sh\nexit 0\n")
            (bin_dir / name).chmod(0o700)
        browser = bin_dir / "test-browser"
        browser.write_text('#!/usr/bin/env python3\nimport os,sys\nopen(os.environ["SYNTHETIC_AUTH_URL_FILE"],"w").write(sys.argv[-1])\n')
        browser.chmod(0o700)
        server = start()
        config = packaged_config(server)
        # Never inherit the developer's or CI's credentials.
        env = clean_env()
        env.update({k: v.replace("${CLAUDE_PLUGIN_DATA}", str(root / "plugin-data")) for k, v in config["env"].items()})
        env.update(PATH=f"{bin_dir}{os.pathsep}{env['PATH']}", BROWSER=str(browser),
                   SYNTHETIC_AUTH_URL_FILE=str(root / "authorization-url"))
        auth_dir = root / "plugin-data" / "auth"
        try:
            for session in range(3):
                helper = Helper(config, env)
                try:
                    began = time.monotonic()
                    initialized = helper.request(1, "initialize", INIT)
                    assert time.monotonic() - began < 10, "initialization must not wait for OAuth"
                    assert initialized["capabilities"]["tools"]["listChanged"] is True
                    helper.request(None, "notifications/initialized")
                    assert helper.status()["state"] == "idle"
                    if session == 0:
                        helper.authorize = False
                        assert [t["name"] for t in helper.request(2, "tools/list")["tools"]] == LOCAL_TOOLS
                        blocked = helper.call(3, "list_workspaces")
                        assert blocked["isError"] and Fixture.calls == 0
                        assert helper.request(4, "resources/list") == {"resources": []}
                        assert helper.request(5, "prompts/list") == {"prompts": []}
                        # Loading next to a working HTTP connection must never start OAuth.
                        time.sleep(2)
                        assert Fixture.registrations == Fixture.authorizations == 0
                        assert not auth_dir.exists()
                        helper.authorize = True
                    for ident in (6, 7):  # idempotent
                        helper.call(ident, "mosofin_connect")
                    helper.wait_connected()
                    status = helper.status()
                    assert status["connection_route"] == "local"
                    assert any(t["name"] == "list_workspaces" for t in helper.request(8, "tools/list")["tools"])
                    data = helper.call(9, "list_workspaces")
                    assert json.loads(data["content"][0]["text"])["workspaces"][0]["name"] == "Fixture Books"
                    assert "notifications/tools/list_changed" in helper.notifications
                    assert helper.call(10, "mosofin_connect")["structuredContent"]["state"] == "connected"
                    assert not any("fixture-access" in line or "/authorize?" in line for line in helper.stderr)
                finally:
                    helper.close()
                tokens = list(auth_dir.rglob("*_tokens.json"))
                assert len(tokens) == 1, "expected one token cache"
                for item in auth_dir.rglob("*"):
                    if item.is_file():
                        assert item.stat().st_mode & 0o077 == 0, f"{item.name} must be owner-only"
                if session == 1:
                    record = json.loads(tokens[0].read_text())
                    record["expires_at"] = 1  # force the third session to refresh
                    tokens[0].write_text(json.dumps(record))
            assert Fixture.registrations == 1, "restarts reuse the registered client"
            assert Fixture.client_names == ["MosoFin plugin"]
            assert Fixture.authorizations == 1, "restarts reuse the sign-in"
            assert Fixture.refreshes == 1, "an expired access token refreshes"
            assert Fixture.calls == 3

            # Never-finished sign-in: actionable failure, server stays responsive.
            failing = {**config, "args": list(config["args"])}
            failing["args"][failing["args"].index("--auth-timeout") + 1] = "2"
            helper = Helper(failing, {**env, "MCP_REMOTE_CONFIG_DIR": str(root / "abandoned"),
                                      "SYNTHETIC_AUTH_URL_FILE": str(root / "abandoned-url")})
            helper.authorize = False
            try:
                helper.request(1, "initialize", INIT)
                helper.request(None, "notifications/initialized")
                helper.call(2, "mosofin_connect")
                states = []
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    states.append(helper.status()["state"])
                    if states[-1] == "failed":
                        break
                    time.sleep(0.1)
                assert "awaiting_browser" in states and states[-1] == "failed", states
                assert "plugin:mosofin:local" in helper.status()["message"]
                assert helper.request(3, "ping") == {}
                assert [t["name"] for t in helper.request(4, "tools/list")["tools"]] == LOCAL_TOOLS
                assert helper.call(5, "list_workspaces")["isError"]
            finally:
                helper.close(graceful=True)

            # An idle helper closes cleanly without touching saved credentials.
            helper = Helper(config, env)
            helper.authorize = False
            try:
                helper.request(1, "initialize", INIT)
                helper.request(None, "notifications/initialized")
                assert helper.status()["state"] == "idle"
            finally:
                helper.close(graceful=True)
            print("PASS: idle start without OAuth, explicit idempotent mosofin_connect, branded callback, PKCE, "
                  "same-session tools, restart reuse, token refresh, owner-only files, sign-in deadline, clean shutdown")
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
