# Skill: {{ skill_name }}

## Purpose
{{ purpose }}

## Inputs
- `client_ids`: list of IDs from `clients.json` (or `"all"` for every active client)
- `save_vault` (optional, default `false`): write output to Obsidian vault

## Overrides (per-client)
Add keys to `client.overrides` in `clients.json` to customise behaviour:
```json
"overrides": {
  "{{ skill_name }}_skip": ["directory-or-step-name"],
  "{{ skill_name }}_extra": ["additional-item"]
}
```
Never fork this skill per client — extend the override schema instead.

## Process
1. Load client records where `id ∈ client_ids` and `active = true`.
2. Apply `overrides` before running any logic.
3. (Skill-specific steps here)
4. Write results to vault if `save_vault = true`.
5. Emit a summary table.

## Output Format
```
## ✅ Client Name

(Skill output — structured Markdown)

*Saved to vault: `1-Projects/{client-id}/{skill-name}-{date}.md`*
```

## CLI Usage
```bash
jarvis skill run {{ skill_name }} --clients all
jarvis skill run {{ skill_name }} --clients kaplunmarx --save-vault
```

## LibreChat Agent Setup
1. Create a new Agent in LibreChat → Agent Builder
2. Name: "{{ skill_name | title }}"
3. System prompt: paste this file's contents
4. Context files: attach `clients/clients.json`
5. Tools: enable `jarvis-tools` MCP → `run_skill`
6. Model: `claude-sonnet-4-6`

## Notes
{{ notes }}
