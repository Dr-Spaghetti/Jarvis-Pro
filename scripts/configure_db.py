#!/usr/bin/env python3
"""
Directly write Anthropic config into Open WebUI's SQLite database.

Stop Open WebUI first, then run:
    export ANTHROPIC_API_KEY=sk-ant-api03-...
    python scripts/configure_db.py

Then restart with ./launch.sh
"""
import os, sys, json, sqlite3, time
from pathlib import Path

DATA_DIR = os.environ.get("DATA_DIR", str(Path.home() / ".jarvis-webui"))
DB_PATH  = os.path.join(DATA_DIR, "webui.db")
KEY      = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_URL = "https://api.anthropic.com/v1"

if not KEY:
    print("ERROR: ANTHROPIC_API_KEY is not set.")
    print("Run:  export ANTHROPIC_API_KEY=sk-ant-api03-...")
    sys.exit(1)

if not os.path.exists(DB_PATH):
    print(f"ERROR: Database not found at {DB_PATH}")
    print("Make sure you started Open WebUI at least once with ./launch.sh")
    sys.exit(1)

print(f"Database: {DB_PATH}")

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print(f"Tables: {tables}")

# Read existing config
row = conn.execute("SELECT * FROM config ORDER BY id DESC LIMIT 1").fetchone()
if row:
    raw = row["data"]
    data = json.loads(raw) if isinstance(raw, str) else dict(raw)
    print(f"Existing config keys: {list(data.keys())}")
else:
    data = {}
    print("No config row found — will create one")

# Add or update Anthropic connection
urls = data.get("OPENAI_API_BASE_URLS", [])
keys = data.get("OPENAI_API_KEYS", [])

if ANTHROPIC_URL in urls:
    idx = urls.index(ANTHROPIC_URL)
    keys[idx] = KEY
    print(f"Updated existing Anthropic entry at index {idx}")
else:
    urls.append(ANTHROPIC_URL)
    keys.append(KEY)
    print(f"Added Anthropic URL: {ANTHROPIC_URL}")

data["OPENAI_API_BASE_URLS"] = urls
data["OPENAI_API_KEYS"]      = keys

# Write back
ts = int(time.time())
if row:
    conn.execute(
        "UPDATE config SET data=?, updated_at=? WHERE id=?",
        (json.dumps(data), ts, row["id"])
    )
else:
    conn.execute(
        "INSERT INTO config (data, version, created_at, updated_at) VALUES (?, 1, ?, ?)",
        (json.dumps(data), ts, ts)
    )

conn.commit()
conn.close()

print("\nDone. Now:")
print("  1. Start Open WebUI:  ./launch.sh")
print("  2. Go to http://localhost:8080")
print("  3. Click the model selector — Claude models should appear")
