#!/usr/bin/env python3
"""
Configure Open WebUI with Anthropic models.
Run while Open WebUI is running (in a second terminal):

    export ANTHROPIC_API_KEY=sk-ant-api03-...
    python scripts/setup_anthropic.py
"""
import os, sys, json, time
try:
    import requests
except ImportError:
    print("pip install requests")
    sys.exit(1)

BASE = "http://localhost:8080"
KEY  = os.environ.get("ANTHROPIC_API_KEY", "")

if not KEY:
    print("ERROR: ANTHROPIC_API_KEY is not set.")
    print("Run:  export ANTHROPIC_API_KEY=sk-ant-api03-...")
    sys.exit(1)

# Models to register (Anthropic API IDs)
MODELS = [
    "claude-sonnet-4-6",
    "claude-opus-4-7",
    "claude-haiku-4-5",
]

def wait_for_webui():
    print("Waiting for Open WebUI...")
    for _ in range(15):
        try:
            r = requests.get(f"{BASE}/health", timeout=3)
            if r.ok:
                print("Open WebUI is up.")
                return True
        except Exception:
            pass
        time.sleep(2)
    print("Could not reach Open WebUI at localhost:8080")
    return False

def get_session_token(s):
    """Load the page to get a session cookie, then extract the JWT."""
    # Load root — Open WebUI sets a session/cookie in no-auth mode
    s.get(f"{BASE}/", timeout=10)

    # Try to get user info (works in no-auth mode, returns default user)
    r = s.get(f"{BASE}/api/v1/auths/", timeout=5)
    if r.ok:
        try:
            data = r.json()
            token = data.get("token") or data.get("access_token")
            if token:
                print(f"Got session token via /api/v1/auths/")
                return token
        except Exception:
            pass

    # Fallback: try signing in with any email (no-auth mode may accept anything)
    for email, pw in [
        ("admin@jarvis.local", "jarvis"),
        ("user@localhost", "password"),
    ]:
        r = s.post(f"{BASE}/api/v1/auths/signin",
                   json={"email": email, "password": pw}, timeout=5)
        if r.ok:
            token = r.json().get("token")
            if token:
                print(f"Got token via signin ({email})")
                return token

    return None

def add_openai_connection(s, token):
    """Register Anthropic as an OpenAI-compatible connection."""
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    # Open WebUI stores OpenAI-compatible connection URLs + keys together
    # Try the v1 API endpoint first, then fallback
    payload = {
        "url": "https://api.anthropic.com/v1",
        "key": KEY,
    }

    endpoints = [
        "/api/openai/config",
        "/api/v1/openai/config",
    ]

    # First, read existing config so we don't overwrite other connections
    existing_urls = []
    existing_keys = []
    for ep in endpoints:
        r = s.get(f"{BASE}{ep}", headers=headers, timeout=5)
        if r.ok:
            try:
                data = r.json()
                existing_urls = data.get("OPENAI_API_BASE_URLS", [])
                existing_keys = data.get("OPENAI_API_KEYS", [])
                break
            except Exception:
                pass

    anthropic_url = "https://api.anthropic.com/v1"
    if anthropic_url not in existing_urls:
        existing_urls.append(anthropic_url)
        existing_keys.append(KEY)

    update_payload = {
        "OPENAI_API_BASE_URLS": existing_urls,
        "OPENAI_API_KEYS": existing_keys,
    }

    for ep in endpoints:
        r = s.post(f"{BASE}{ep}", json=update_payload, headers=headers, timeout=5)
        print(f"POST {ep} → {r.status_code}")
        if r.ok:
            print("  Anthropic connection registered.")
            return True
        else:
            print(f"  {r.text[:200]}")

    return False

def enable_models(s, token):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    for model_id in MODELS:
        payload = {
            "id": model_id,
            "name": model_id,
            "meta": {"description": "Anthropic Claude"},
            "is_active": True,
        }
        r = s.post(f"{BASE}/api/v1/models/", json=payload, headers=headers, timeout=5)
        status = "OK" if r.ok else f"FAILED ({r.status_code})"
        print(f"  Model {model_id}: {status}")

def main():
    if not wait_for_webui():
        sys.exit(1)

    s = requests.Session()
    token = get_session_token(s)
    if not token:
        print("\nWARNING: Could not get session token. Trying without auth...")

    print("\nRegistering Anthropic connection...")
    ok = add_openai_connection(s, token)

    print("\nEnabling models...")
    enable_models(s, token)

    print("\nDone. Refresh http://localhost:8080 and check the model selector.")

if __name__ == "__main__":
    main()
