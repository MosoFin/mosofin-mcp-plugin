#!/usr/bin/env python3
"""Regression against a real Claude Code engine: a slow (40 s) MosoFin browser
sign-in through mosofin_connect must not trip the host's MCP startup timeout,
must expose MosoFin tools in the same session, and must not be blocked by the
`mosofin` HTTP entry waiting for authentication.

No model requests, real credentials, installed plugins or user settings.
  python3 scripts/test_slow_signin.py [--claude /path/to/claude]
"""

import argparse
import json
import os
from pathlib import Path
import queue
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

from mosofin_fixture import Fixture, PRODUCTION, ROOT, clean_env, fixture_url, start

# Stands in for the model: asks the local server to connect once the host has
# initialised it, and hides that request's reply from the host.
RELAY = '''import json,subprocess,sys,threading,time
child=subprocess.Popen(json.load(open(sys.argv[1])),stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
lock=threading.Lock()
ident='fixture-connect'
def send(line):
 with lock:
  child.stdin.write(line);child.stdin.flush()
def connect():
 time.sleep(2)
 send(json.dumps({'jsonrpc':'2.0','id':ident,'method':'tools/call','params':{'name':'mosofin_connect','arguments':{}}})+'\\n')
def relay():
 for line in child.stdout:
  if json.loads(line).get('id')==ident: continue
  sys.stdout.write(line);sys.stdout.flush()
threading.Thread(target=relay,daemon=True).start()
try:
 for line in sys.stdin:
  send(line)
  if json.loads(line).get('method')=='notifications/initialized': threading.Thread(target=connect,daemon=True).start()
finally:
 child.stdin.close();child.wait(timeout=8)
'''

SLOW_BROWSER = '''#!/usr/bin/env python3
import socket,sys,time
from urllib.parse import parse_qs,urlsplit
from urllib.request import urlopen
url=sys.argv[-1]
assert urlsplit(url).hostname=='127.0.0.1'
time.sleep(40)
callback=urlsplit(parse_qs(urlsplit(url).query)['redirect_uri'][0])
for _ in range(100):
 try:
  with socket.create_connection((callback.hostname,callback.port),timeout=.2): break
 except OSError: time.sleep(.1)
with urlopen(url,timeout=10) as response: assert response.status==200
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--claude", default=shutil.which("claude"))
    options = parser.parse_args()
    if not options.claude:
        parser.error("supply --claude with a Claude Code executable")
    with tempfile.TemporaryDirectory(prefix="mosofin-slow-signin-") as temporary:
        root = Path(temporary)
        plugin = root / "plugin"
        plugin.mkdir()
        for name in (".claude-plugin", "skills", "agents", "assets", "hooks", "runtime"):
            shutil.copytree(ROOT / name, plugin / name)
        server = start()
        url = fixture_url(server)
        config = json.loads((ROOT / ".mcp.json").read_text())
        local = config["mcpServers"]["local"]
        command = root / "local-command.json"
        command.write_text(json.dumps([local["command"], *[a.replace(PRODUCTION, url).replace("${CLAUDE_PLUGIN_ROOT}", str(plugin)) for a in local["args"]]]))
        relay = root / "relay.py"
        relay.write_text(RELAY)
        local["command"], local["args"] = sys.executable, [str(relay), str(command)]
        config["mcpServers"]["mosofin"]["url"] = url
        (plugin / ".mcp.json").write_text(json.dumps(config))
        config_dir = root / "config"
        config_dir.mkdir()
        (config_dir / "settings.json").write_text(json.dumps({"disableClaudeAiConnectors": True}))
        browser = root / "browser"
        browser.write_text(SLOW_BROWSER)
        browser.chmod(0o700)
        env = {**clean_env(), "CLAUDE_CONFIG_DIR": str(config_dir), "BROWSER": str(browser)}
        processes = []

        def session(label, limit):
            process = subprocess.Popen(
                [options.claude, "--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                 "--setting-sources", "user", "--no-session-persistence", "--plugin-dir", str(plugin)],
                cwd=root, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                text=True, start_new_session=True)
            processes.append(process)
            messages = queue.Queue()

            def read():
                for line in process.stdout:
                    try:
                        messages.put(json.loads(line))
                    except ValueError:
                        pass
            threading.Thread(target=read, daemon=True).start()

            def control(ident, subtype):
                process.stdin.write(json.dumps({"type": "control_request", "request_id": ident, "request": {"subtype": subtype}}) + "\n")
                process.stdin.flush()

            began, next_poll, ready_at, http_status = time.monotonic(), 0.0, None, None
            control("init", "initialize")
            while time.monotonic() - began < limit:
                if time.monotonic() > next_poll:
                    control("status", "mcp_status")
                    next_poll = time.monotonic() + 0.5
                try:
                    message = messages.get(timeout=0.2)
                except queue.Empty:
                    assert process.poll() is None, "Claude engine exited early"
                    continue
                response = message.get("response", {})
                if response.get("request_id") != "status":
                    continue
                servers = response.get("response", {}).get("mcpServers", [])
                http_status = next((s.get("status") for s in servers if s.get("name") == "plugin:mosofin:mosofin"), http_status)
                for item in servers:
                    if item.get("name") != "plugin:mosofin:local":
                        continue
                    elapsed = time.monotonic() - began
                    assert item.get("status") != "failed", "host marked the local server failed during sign-in"
                    if item.get("status") != "connected":
                        continue
                    names = [tool["name"] for tool in item.get("tools", [])]
                    if ready_at is None:
                        ready_at = elapsed
                        assert ready_at < 10, "host startup waited for browser sign-in"
                        assert any(n.endswith("mosofin_connection_status") for n in names), names
                        if label == "first":
                            assert Fixture.authorizations == 0, "slow sign-in should still be pending"
                        print(f"{label}: plugin:mosofin:local ready at {ready_at:.1f}s", flush=True)
                    if any(n.endswith("list_workspaces") for n in names):
                        if label == "first":
                            assert elapsed > 40, "sign-in did not outlast the startup timeout"
                        assert http_status == "needs-auth", f"HTTP entry should wait for host sign-in, got {http_status}"
                        print(f"{label}: list_workspaces available in the same session at {elapsed:.1f}s", flush=True)
                        return process
            raise AssertionError("MosoFin data tools did not appear")

        def stop(process):
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=6)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()

        try:
            stop(session("first", 75))
            registrations = Fixture.registrations
            session("restart", 25)
            assert Fixture.authorizations == 1, "a restart reuses the saved sign-in"
            assert Fixture.registrations == registrations
            assert Fixture.client_names.count("MosoFin plugin") == 1
            cache = config_dir / "mcp-needs-auth-cache.json"
            if cache.exists():
                assert "plugin:mosofin:local" not in json.loads(cache.read_text())
            print("PASS: 40-second sign-in does not time out host startup; tools appear in the same session; "
                  "the unauthenticated HTTP entry does not block; restart reuses the sign-in", flush=True)
        finally:
            for process in processes:
                stop(process)
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
