"""Verify deployed news/MCP using a temporary Auth user, then delete it.

Needs the already authenticated Supabase CLI. Credentials remain in process memory.
No AI calls or journal writes are made. --feed checks live news discovery.
"""
import json
import subprocess
import urllib.request
import urllib.error
import uuid
import sys

PROJECT = "rqeyaamvnwjiucbstzqq"
BASE = f"https://{PROJECT}.supabase.co"
APP_ORIGIN = "https://edgelog-iota-six.vercel.app"


def main():
    endpoint = BASE + "/functions/v1/news-mcp/app"
    preflight = urllib.request.Request(endpoint, method="OPTIONS", headers={
        "Origin": APP_ORIGIN, "Access-Control-Request-Method": "POST"})
    with urllib.request.urlopen(preflight, timeout=60) as response:
        assert response.headers.get("Access-Control-Allow-Origin") == APP_ORIGIN
    anonymous = urllib.request.Request(endpoint, data=b'{"action":"status"}', headers={
        "Origin": APP_ORIGIN, "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(anonymous, timeout=60)
        raise AssertionError("Anonymous access was accepted")
    except urllib.error.HTTPError as error:
        assert error.code == 401
    print("Production browser origin accepted and anonymous access rejected: passed.")
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
                     "Accept": "application/json, text/event-stream", "Origin": APP_ORIGIN}, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            print('Live request failed: '+path.split('?')[0]+' HTTP '+str(error.code))
            if path.startswith('/functions/'):
                try:
                    detail=json.load(error)
                    print('Service error code: '+str(detail.get('code','unavailable')))
                    print('Service message: '+str(detail.get('error','Unavailable')))
                except (ValueError,TypeError):
                    pass
            raise

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
        if '--feed' in sys.argv:
            feed = request('/functions/v1/news-mcp/app', {'action':'feed','args':{'query':'gold','hours':24}},token)
            assert isinstance(feed.get('articles'),list)
            for article in feed['articles']:
                assert article['id'].startswith('thenewsapi:') and article['published_at']
            assert feed['articles'], 'The live news query returned no stories'
            print('Live news feed through authenticated MCP: passed; articles='+str(len(feed['articles'])))
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
