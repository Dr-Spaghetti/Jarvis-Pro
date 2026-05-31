# obsidian-second-brain

Use an Obsidian vault as the assistant's persistent second brain — capture,
retrieve, link, and organize knowledge.

Works two ways:

- **Live (preferred):** an Obsidian MCP server (the `obsidian` server, via the
  Obsidian **Local REST API** community plugin) registered with Claude Code.
  Configure once and every Octogent tentacle inherits live vault access.
- **File-based (fallback):** set `OBSIDIAN_VAULT_PATH` to your vault folder; the
  skill reads/searches/writes the `.md` files directly. No plugin required.

## Setup (live MCP)

1. In Obsidian: Settings → Community plugins → Browse → install **Local REST
   API** → enable it → copy the **API key**.
2. Register it with Claude Code (user scope so all agents inherit it):
   ```bash
   claude mcp add --transport http --scope user obsidian https://127.0.0.1:27124/mcp/ -H "Authorization: Bearer <API_KEY>"
   ```
   If TLS fails on the self-signed cert, enable the plugin's non-encrypted HTTP
   server and use `http://127.0.0.1:27123/mcp/` instead.
3. Verify: `claude mcp list` shows `obsidian` connected.

## Setup (file-based)

Add to your project `.env`:

```
OBSIDIAN_VAULT_PATH=C:\path\to\your\vault
```

See `SKILL.md` for the full operating manual.
