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

BASE  = "http://localhost:8080"
KEY   = os.environ.get("ANTHROPIC_API_KEY", "")
EMAIL = "admin@jarvis.local"
PASS  = "jarvis"

if not KEY:
    print("ERROR: ANTHROPIC_API_KEY is not set.")
    print("Run:  export ANTHROPIC_API_KEY=sk-ant-api03-...")
    sys.exit(1)

def wait_for_webui():
    for _ in range(15):
        try:
            if requests.get(f"{BASE}/health", timeout=3).ok:
                return True
        except Exception:
            pass
        time.sleep(2)
    print("Cannot reach Open WebUI at localhost:8080")
    return False

def get_token(s):
    # WEBUI_AUTH=false: signin returns a token even without a real user
    r = s.post(f"{BASE}/api/v1/auths/signin",
               json={"email": EMAIL, "password": PASS}, timeout=5)
    if r.ok:
        token = r.json().get("token")
        if token:
            print(f"Got session token.")
            return token
    print(f"Signin failed: {r.status_code} {r.text[:200]}")
    return None

def probe_get(s, headers, paths):
    """Try GETs until one returns JSON, return (path, data)."""
    for p in paths:
        try:
            r = s.get(f"{BASE}{p}", headers=headers, timeout=5)
            data = r.json()
            if isinstance(data, dict) and r.status_code < 500:
                return p, data
        except Exception:
            pass
    return None, {}

def configure_anthropic(s, token):
    headers = {"Authorization": f"Bearer {token}"}

    # Discover the actual config endpoint
    config_paths = [
        "/api/openai/config",
        "/api/v1/openai/config",
    ]
    cfg_path, current = probe_get(s, headers, config_paths)
    print(f"Config endpoint: {cfg_path or 'not found'}")
    print(f"Current config: {json.dumps(current, indent=2)[:400]}")

    # Build updated URL/key lists
    urls = current.get("OPENAI_API_BASE_URLS", [])
    keys = current.get("OPENAI_API_KEYS", [])
    target = "https://api.anthropic.com/v1"
    if target not in urls:
        urls.append(target)
        keys.append(KEY)
        print("Adding Anthropic to connection list...")
    else:
        # Update the key in case it changed
        idx = urls.index(target)
        keys[idx] = KEY
        print("Anthropic already in list, updating key...")

    payload = {"OPENAI_API_BASE_URLS": urls, "OPENAI_API_KEYS": keys}

    # Try update sub-path first, then PUT on main path
    update_attempts = []
    if cfg_path:
        update_attempts = [
            ("POST", f"{cfg_path}/update"),
            ("PUT",  cfg_path),
            ("POST", cfg_path),
        ]
    # Also try versioned variants
    update_attempts += [
        ("POST", "/api/openai/config/update"),
        ("POST", "/api/v1/openai/config/update"),
        ("PUT",  "/api/openai/config"),
        ("PUT",  "/api/v1/openai/config"),
    ]

    for method, path in update_attempts:
        try:
            fn = getattr(s, method.lower())
            r = fn(f"{BASE}{path}", json=payload, headers=headers, timeout=5)
            print(f"  {method} {path} → {r.status_code}")
            if r.ok:
                print("  SUCCESS — Anthropic connection saved.")
                return True
            if r.status_code not in (404, 405):
                print(f"  Response: {r.text[:200]}")
        except Exception as e:
            pass

    print("\nAll update attempts failed. Dumping available routes for diagnosis:")
    for p in ["/api/openai/", "/api/v1/openai/", "/openapi.json"]:
        try:
            r = s.get(f"{BASE}{p}", headers=headers, timeout=5)
            if r.ok:
                try:
                    print(f"\n{p}: {json.dumps(r.json(), indent=2)[:800]}")
                except Exception:
                    print(f"\n{p}: (HTML, {len(r.text)} bytes)")
        except Exception:
            pass
    return False

def main():
    if not wait_for_webui():
        sys.exit(1)

    s = requests.Session()
    token = get_token(s)
    if not token:
        sys.exit(1)

    print("\nConfiguring Anthropic connection...")
    configure_anthropic(s, token)
    print("\nDone. Hard-refresh the browser (Ctrl+Shift+R) and check the model selector.")

if __name__ == "__main__":
    main()
