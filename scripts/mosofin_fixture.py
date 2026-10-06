"""Loopback stand-in for mcp.mosofin.com: OAuth (DCR + S256 PKCE) and a tiny MCP.

Synthetic only — no real credentials, workspaces or books. Shared by the Python
connection tests; the conversation sign-in test has its own Node fixture.
"""

import base64
import hashlib
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from urllib.parse import parse_qs, urlencode, urlsplit

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION = "https://mcp.mosofin.com/mcp"
WORKSPACES = {"status": "confirmed", "workspaces": [{"workspace_id": "ws_fixture", "name": "Fixture Books", "role": "admin"}]}


# Network and npm settings a test may inherit so npx can resolve the pinned
# packages behind a proxy. Nothing that carries credentials or Claude/MCP state.
_PASS_THROUGH = ("PATH", "HOME", "SYSTEMROOT", "TMPDIR", "NPM_CONFIG_CACHE", "npm_config_cache",
                 "NPM_CONFIG_USERCONFIG", "npm_config_https_proxy", "npm_config_noproxy",
                 "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy", "NODE_EXTRA_CA_CERTS")


def clean_env():
    return {key: value for key, value in os.environ.items() if key in _PASS_THROUGH}


class Fixture(BaseHTTPRequestHandler):
    registrations = 0
    client_names = []
    authorizations = 0
    refreshes = 0
    calls = 0
    challenge = None

    @classmethod
    def reset(cls):
        cls.registrations = cls.authorizations = cls.refreshes = cls.calls = 0
        cls.client_names = []
        cls.challenge = None

    def log_message(self, *args):
        pass

    @property
    def origin(self):
        return f"http://127.0.0.1:{self.server.server_port}"

    def reply(self, status, body=None, **headers):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        for key, value in headers.items():
            self.send_header(key.replace("_", "-"), value)
        self.end_headers()
        if body is not None:
            self.wfile.write(json.dumps(body).encode())

    def do_GET(self):
        path = urlsplit(self.path)
        if path.path.startswith("/.well-known/oauth-protected-resource"):
            return self.reply(200, {"resource": self.origin + "/mcp", "authorization_servers": [self.origin], "scopes_supported": ["read"]})
        if path.path.startswith("/.well-known/oauth-authorization-server"):
            return self.reply(200, {
                "issuer": self.origin,
                "authorization_endpoint": self.origin + "/authorize",
                "token_endpoint": self.origin + "/token",
                "registration_endpoint": self.origin + "/register",
                "response_types_supported": ["code"],
                "grant_types_supported": ["authorization_code", "refresh_token"],
                "token_endpoint_auth_methods_supported": ["none"],
                "code_challenge_methods_supported": ["S256"],
                "scopes_supported": ["read"],
            })
        if path.path == "/authorize":
            params = parse_qs(path.query)
            if params.get("code_challenge_method") != ["S256"] or not params.get("state"):
                return self.reply(400, {"error": "PKCE and state required"})
            Fixture.authorizations += 1
            Fixture.challenge = params["code_challenge"][0]
            callback = params["redirect_uri"][0]
            if urlsplit(callback).hostname not in ("localhost", "127.0.0.1"):
                return self.reply(400, {"error": "non-local callback refused"})
            return self.reply(302, Location=callback + "?" + urlencode({"code": "fixture-code", "state": params["state"][0]}))
        if path.path == "/mcp":
            return self.reply(405)
        self.reply(404)

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        if self.path == "/register":
            Fixture.registrations += 1
            metadata = json.loads(raw)
            Fixture.client_names.append(metadata.get("client_name"))
            return self.reply(201, {**metadata, "client_id": f"fixture-client-{Fixture.registrations}"})
        if self.path == "/token":
            params = parse_qs(raw.decode())
            grant = params.get("grant_type", [""])[0]
            if grant == "authorization_code":
                verifier = params.get("code_verifier", [""])[0]
                digest = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
                if params.get("code") != ["fixture-code"] or digest != Fixture.challenge:
                    return self.reply(400, {"error": "invalid_grant"})
            elif grant == "refresh_token" and params.get("refresh_token") == ["fixture-refresh"]:
                Fixture.refreshes += 1
            else:
                return self.reply(400, {"error": "invalid_grant"})
            return self.reply(200, {"access_token": "fixture-access", "refresh_token": "fixture-refresh", "token_type": "Bearer", "expires_in": 3600, "scope": "read"})
        if self.path != "/mcp":
            return self.reply(404)
        if self.headers.get("Authorization") != "Bearer fixture-access":
            return self.reply(401, {"error": "unauthorized"}, WWW_Authenticate=f'Bearer resource_metadata="{self.origin}/.well-known/oauth-protected-resource/mcp"')
        request = json.loads(raw)
        if "id" not in request:
            return self.reply(202)
        method = request["method"]
        if method == "initialize":
            result = {"protocolVersion": "2025-03-26", "capabilities": {"tools": {}}, "serverInfo": {"name": "MosoFin fixture", "version": "1.0.0"}}
        elif method == "tools/list":
            result = {"tools": [{"name": "list_workspaces", "description": "List synthetic workspaces", "inputSchema": {"type": "object", "properties": {}}}]}
        elif method == "tools/call" and request["params"]["name"] == "list_workspaces":
            Fixture.calls += 1
            result = {"content": [{"type": "text", "text": json.dumps(WORKSPACES)}]}
        else:
            result = {}
        self.reply(200, {"jsonrpc": "2.0", "id": request["id"], "result": result})


def start():
    Fixture.reset()
    server = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def fixture_url(server):
    return f"http://127.0.0.1:{server.server_port}/mcp"
