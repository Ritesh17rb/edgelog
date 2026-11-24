"""Check a provider key via hidden input; never print it or request URLs."""
import getpass
import json
import urllib.request
import urllib.parse
import urllib.error

key = getpass.getpass("News API key (hidden): ")
url = "https://api.thenewsapi.com/v1/news/all?" + urllib.parse.urlencode({
    "api_token": key, "language": "en", "categories": "business", "limit": 3,
})
request = urllib.request.Request(url, headers={"User-Agent": "EdgeLog/1.0", "Accept": "application/json"})
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.load(response)
        print(json.dumps({"status": response.status, "articles": len(data.get("data", []))}))
except urllib.error.HTTPError as error:
    raw = error.read(2000).decode(errors="replace").replace(key, "[redacted]")
    try:
        detail = json.loads(raw)
        print(json.dumps({"status": error.code, "error": detail.get("error", {})}))
    except ValueError:
        print(json.dumps({"status": error.code, "error": "Provider returned a non-JSON denial."}))
    raise SystemExit(1)
