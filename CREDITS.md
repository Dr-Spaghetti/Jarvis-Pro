# Credits

Octogent + Skills is a combination of two open-source projects, fused into a
single tool: a multi-agent orchestration dashboard whose tentacle agents come
with a ready-to-use library of practical skills.

## Upstream projects

### Octogent — orchestration dashboard

- Source: https://github.com/hesamsheikh/octogent
- Author: Hesam Sheikh ([@Hesamation](https://x.com/Hesamation))
- License: MIT (see [`LICENSE`](./LICENSE))

Provides the entire orchestration layer: tentacles (scoped context folders),
`todo.md` execution surface, multi-terminal coordination, child-agent
orchestration, inter-agent messaging, the local API, and the web UI. This repo
uses Octogent as its base.

### rm-skills — skills catalog

- Source: https://github.com/reymerekar7/rm-skills
- Author: reymerekar7
- License: MIT (see [`LICENSE.rm-skills`](./LICENSE.rm-skills))

Provides the bundled skills under [`skills-catalog/`](./skills-catalog):
`gmail-triage`, `infographic-generator`, `linkedin-asset-analyzer`,
`twitter-reader`, `video-performance-analyzer`, and `x-scanner`. These are
unmodified Claude Code skills (`SKILL.md` format) shipped as Octogent's bundled
catalog.

## What this combination adds

The glue layer that makes the two work as one tool:

- A bundled **skills catalog** that is always visible inside the dashboard
  (`source: "bundled"`) without polluting the user's workspace.
- `octogent skills` CLI commands (`list`, `install`, `status`, `doctor`).
- A `catalog.json` manifest describing each skill's required API keys and setup.
- Automatic `.env` loading at startup so skill API keys reach every spawned
  agent through the PTY environment.
- UI affordances: bundled badges and "missing API key" warnings in the tentacle
  skill picker.

Both upstream projects are MIT licensed; this combined work is distributed under
the same terms.
