#!/usr/bin/env python3
"""
Run while Open WebUI is running to diagnose model setup.
Usage: python scripts/diagnose_webui.py
"""
import os, sys, json
try:
    import requests
except ImportError:
    print("pip install requests first")
    sys.exit(1)

BASE = "http://localhost:8080"
KEY  = os.environ.get("ANTHROPIC_API_KEY", "")

def show(label, r):
    print(f"\n--- {label} [{r.status_code}] ---")
    try:
        data = r.json()
        print(json.dumps(data, indent=2)[:800])
    except Exception:
        print(r.text[:400])

print(f"Probing Open WebUI at {BASE} ...")
print(f"ANTHROPIC_API_KEY set: {'YES' if KEY else 'NO'}")

# Health
try:
    show("Health", requests.get(f"{BASE}/health", timeout=5))
except Exception as e:
    print(f"\nCannot reach {BASE}: {e}")
    sys.exit(1)

# Model list (main selector source)
show("GET /api/models",       requests.get(f"{BASE}/api/models",      timeout=5))
show("GET /api/v1/models/",   requests.get(f"{BASE}/api/v1/models/",  timeout=5))

# Connection config endpoints (differ by version)
for path in [
    "/api/config",
    "/api/v1/configs/",
    "/api/openai/config/urls",
    "/api/v1/openai/config/urls",
]:
    try:
        show(f"GET {path}", requests.get(f"{BASE}{path}", timeout=5))
    except Exception:
        pass

# Try to add Anthropic via known endpoints
if KEY:
    print("\n\n=== Attempting to register Anthropic connection ===")
    attempts = [
        ("POST /api/openai/config/url",
         {"url": "https://api.anthropic.com/v1", "key": KEY}),
        ("POST /api/v1/openai/config/url",
         {"url": "https://api.anthropic.com/v1", "key": KEY}),
        ("POST /api/v1/configs/",
         {"ANTHROPIC_API_KEY": KEY}),
    ]
    for label, payload in attempts:
        path = label.split(" ", 1)[1]
        try:
            r = requests.post(f"{BASE}{path}", json=payload, timeout=5)
            show(label, r)
            if r.ok:
                print("  ^^^ THIS ONE WORKED")
                break
        except Exception as e:
            print(f"{label}: ERROR {e}")
else:
    print("\nSkipping connection attempt — ANTHROPIC_API_KEY not set in environment")
    print("Run:  export ANTHROPIC_API_KEY=sk-ant-api03-...")
    print("Then: python scripts/diagnose_webui.py")
