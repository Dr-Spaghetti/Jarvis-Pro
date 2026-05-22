"""
Automated first-run setup for Open WebUI.
Runs inside the jarvis-backend container after Open WebUI starts.
Handles: admin account creation, MCP tool server registration.
"""
import os
import sys
import time
import json

try:
    import requests
except ImportError:
    print("[setup] requests not available, skipping Open WebUI auto-setup")
    sys.exit(0)

WEBUI_URL   = os.environ.get("WEBUI_URL", "http://open-webui:8080")
MCP_URL     = os.environ.get("MCP_SELF_URL", "http://jarvis-backend:8765/mcp")
ADMIN_EMAIL = os.environ.get("WEBUI_ADMIN_EMAIL", "admin@jarvis.local")
ADMIN_PASS  = os.environ.get("WEBUI_ADMIN_PASSWORD", "jarvis-admin-2026")
ADMIN_NAME  = os.environ.get("WEBUI_ADMIN_NAME", "Admin")


def wait_for_webui(timeout=120):
    print(f"[setup] waiting for Open WebUI at {WEBUI_URL} ...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = requests.get(f"{WEBUI_URL}/health", timeout=3)
            if r.ok:
                print("[setup] Open WebUI is up")
                return True
        except Exception:
            pass
        time.sleep(4)
    print("[setup] Open WebUI did not start in time — skipping auto-setup")
    return False


def create_admin():
    """Create the first admin account. No-ops if users already exist."""
    try:
        r = requests.post(
            f"{WEBUI_URL}/api/v1/auths/signup",
            json={"name": ADMIN_NAME, "email": ADMIN_EMAIL, "password": ADMIN_PASS},
            timeout=10,
        )
        if r.ok:
            print(f"[setup] Admin account created ({ADMIN_EMAIL})")
        else:
            print(f"[setup] Signup response {r.status_code} (account may already exist)")
    except Exception as e:
        print(f"[setup] Could not create admin: {e}")


def get_token():
    try:
        r = requests.post(
            f"{WEBUI_URL}/api/v1/auths/signin",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
            timeout=10,
        )
        if r.ok:
            token = r.json().get("token")
            if token:
                print("[setup] Signed in successfully")
                return token
        print(f"[setup] Sign-in failed: {r.status_code} {r.text[:200]}")
    except Exception as e:
        print(f"[setup] Sign-in error: {e}")
    return None


def add_mcp_tool_server(token):
    """Register the Jarvis MCP server as a Tool Server in Open WebUI."""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Check existing tool connections to avoid duplicates
    try:
        r = requests.get(f"{WEBUI_URL}/api/v1/tools/", headers=headers, timeout=10)
        if r.ok:
            existing = r.json()
            if any(MCP_URL in str(t) for t in existing):
                print("[setup] MCP tool server already registered")
                return
    except Exception:
        pass

    # Try the OpenAPI connections endpoint (Open WebUI 0.5+)
    payloads_and_endpoints = [
        (f"{WEBUI_URL}/api/v1/tools/connection",
         {"url": MCP_URL, "name": "Jarvis Tools"}),
        (f"{WEBUI_URL}/api/v1/openapi/connections",
         {"url": MCP_URL, "name": "Jarvis Tools"}),
        (f"{WEBUI_URL}/api/v1/models/connection",
         {"url": MCP_URL, "api_key": "", "name": "Jarvis Tools"}),
    ]
    for endpoint, payload in payloads_and_endpoints:
        try:
            r = requests.post(endpoint, json=payload, headers=headers, timeout=10)
            if r.ok:
                print(f"[setup] MCP tool server registered via {endpoint}")
                return
        except Exception:
            pass

    # All API attempts failed — print manual instructions
    print("[setup] Could not register MCP tool server automatically.")
    print("[setup] Manual step (30 seconds):")
    print(f"[setup]   Admin Panel → Settings → Tools → + Add")
    print(f"[setup]   URL: {MCP_URL.replace('jarvis-backend', 'localhost')}")


def set_default_model(token):
    """Set Claude as the default model."""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    default_model = os.environ.get("DEFAULT_MODEL", "claude-sonnet-4-6")
    try:
        r = requests.post(
            f"{WEBUI_URL}/api/v1/configs/default/models",
            json={"models": [default_model]},
            headers=headers,
            timeout=10,
        )
        if r.ok:
            print(f"[setup] Default model set to {default_model}")
    except Exception:
        pass


def main():
    if not wait_for_webui():
        return
    create_admin()
    token = get_token()
    if token:
        add_mcp_tool_server(token)
        set_default_model(token)
    print("[setup] Done. Open WebUI is ready.")


if __name__ == "__main__":
    main()
