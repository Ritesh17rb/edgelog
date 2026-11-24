"""Verify deployed news/MCP using a temporary Auth user, then delete it.

Needs the already authenticated Supabase CLI. Credentials remain in process memory.
No provider requests are made and no journal data is written.
"""
import json
import subprocess
import urllib.request
import urllib.error
import uuid

PROJECT = "rqeyaamvnwjiucbstzqq"
BASE = f"https://{PROJECT}.supabase.co"


def main():
    result = subprocess.run(
        ["npx.cmd", "--yes", "supabase", "projects", "api-keys", f"--remote={PROJECT}", "--reveal", "--output-format", "json"],
        capture_output=True, text=True, check=True,
    )
    payload = json.loads(result.stdout)
    candidates = []

    def walk(value):
        if isinstance(value, dict):
            if value.get("name") == "service_role":
                candidates.append(value)
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(payload)
    key = next((row.get("api_key") for row in candidates if row.get("api_key")), None)
    if not key:
        raise RuntimeError("A service-role key was not available for the isolated smoke check.")

    def request(path, body=None, token=None, method="POST"):
        req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json", "apikey": key, "Authorization": "Bearer " + (token or key),
                     "Accept": "application/json, text/event-stream"}, method=method)
        with urllib.request.urlopen(req, timeout=60) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    user_id = None
    try:
        password = uuid.uuid4().hex + "Aa1!"
        email = f"news-smoke-{uuid.uuid4().hex}@example.invalid"
        user = request("/auth/v1/admin/users", {"email": email, "password": password, "email_confirm": True})
        user_id = user["id"]
        session = request("/auth/v1/token?grant_type=password", {"email": email, "password": password})
        token = session["access_token"]
        status = request("/functions/v1/news-mcp/app", {"action": "status"}, token)
        library = request("/functions/v1/news-mcp/app", {"action": "library"}, token)
        assert library == {"items": []}
        protocol = request("/functions/v1/news-mcp", {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "edgelog-smoke", "version": "1.0.0"}}}, token)
        assert protocol["result"]["serverInfo"]["name"] == "edgelog-news"
        tools = request("/functions/v1/news-mcp", {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, token)
        assert len(tools["result"]["tools"]) == 7
        print("Live authenticated MCP initialization, seven-tool discovery and empty private library: passed.")
        print("Provider configuration: " + json.dumps(status))
    finally:
        if user_id:
            request("/auth/v1/admin/users/" + user_id, method="DELETE")
            print("Temporary verification user deleted.")


if __name__ == "__main__":
    try:
        main()
    except Exception as failure:
        # Do not print response bodies, CLI output, credentials, or tokens.
        print("Smoke check failed: " + type(failure).__name__)
        raise SystemExit(1)
