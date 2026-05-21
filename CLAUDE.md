# Jarvis-Pro — Claude Code Configuration

## Project Overview
Personal AI assistant for a local SEO agency. Task-based architecture with client registry,
research harness, Obsidian knowledge management, and self-improving skill system.

## Key Architecture Decisions
- **Task-based, not client-based**: Skills run against a list of clients, not vice versa.
- **Client registry**: `clients/clients.json` is the single source of truth for all client data.
- **Obsidian-native**: All outputs are Markdown notes written directly to the vault.
- **Self-improving**: Every skill execution is metered; Claude analyzes failures and proposes improvements.

## Directory Structure
```
core/               Config, registry, logging
clients/            clients.json registry + schema
integrations/       Anthropic client, Obsidian vault, Local Falcon API
research/           Multi-source research harness
agents/             Specialized Claude agent wrappers
self_improvement/   Metrics, evaluator, skill optimizer
skills/             Task-based skill runners (Python)
obsidian/           Vault templates and structure docs
docker/             LibreChat + supporting services
scripts/            CLI helpers (onboard_client, run_workflow)
tests/              pytest suite
cli.py              Typer CLI entry point (`jarvis` command)
```

## Common Commands
```bash
# Research
jarvis research "how does Google treat NAP inconsistency"
jarvis research "competitor analysis for injury lawyers in Philly" --client kaplunmarx --depth 3

# Run skills across clients
jarvis skill run citation-audit --clients all
jarvis skill run falcon-report --clients kaplunmarx "carpet salem"
jarvis skill run keyword-hygiene --clients all --save-vault

# Client management
jarvis client list
jarvis client add
jarvis client show kaplunmarx
jarvis client update kaplunmarx --field local_falcon_id --value "abc123"

# Self-improvement
jarvis improve analyze citation-audit
jarvis improve run          # full improvement cycle across all skills

# Obsidian
jarvis obsidian sync-clients    # create/update client profile notes
jarvis obsidian dashboard       # rebuild weekly dashboard note
```

## Environment Setup
```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY and OBSIDIAN_VAULT_PATH at minimum
pip install -e ".[dev]"
```

## Adding a New Skill
1. Create `skills/your_skill.py` inheriting from `skills.base.SkillBase`
2. Implement `async def run(self, client, params) -> SkillResult`
3. The skill is automatically discovered by the CLI and self-improvement engine

## Adding a New Client
```bash
jarvis client add
# Interactive prompt walks through all fields
```
Or edit `clients/clients.json` directly following the schema in `clients/schema.json`.

## Self-Improvement Loop
- Every skill execution writes a metric entry to `.jarvis/metrics.json`
- `jarvis improve analyze <skill>` uses Claude to review failure patterns
- `jarvis improve run` generates improved skill prompts stored in `.jarvis/skill_versions/`
- Improved versions are staged for review before replacing the current version

## Research Harness
- Sources: `web` (Brave Search), `vault` (Obsidian full-text), `local_falcon`
- Results are always saved to the vault under `3-Resources/Research/`
- Use `--no-save` flag to skip vault write
- Research memory cached in `.jarvis/research_cache.json` (TTL: 7 days)

## Testing
```bash
pytest                    # all tests
pytest tests/test_registry.py -v
pytest -k "research" -v
```
