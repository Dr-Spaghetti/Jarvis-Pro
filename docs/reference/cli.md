# CLI Reference

## Start the dashboard

```bash
octogent
```

Starts the local API for the current project and opens the UI when bundled web assets are present.

If the current directory has not been initialized yet, `octogent` also creates or updates the local `.octogent/` scaffold automatically on first run.

## Initialize a project

```bash
octogent init [project-name]
```

Creates or updates the `.octogent/` scaffold in the current directory without starting the dashboard.

Use this when you want to initialize the project explicitly or set the project display name ahead of time. In normal use, running `octogent` inside the codebase is enough to initialize and start the app.

## List registered projects

```bash
octogent projects
```

## Create a tentacle

```bash
octogent tentacle create <name> --description "API runtime and routes"
```

Octogent must already be running for this command.

## List tentacles

```bash
octogent tentacle list
```

## Create a terminal

```bash
octogent terminal create [options]
```

Options:

- `--name`, `-n`: terminal display name
- `--workspace-mode`, `-w`: `shared` or `worktree`
- `--initial-prompt`, `-p`: raw initial prompt text
- `--terminal-id`: explicit terminal ID
- `--tentacle-id`: existing tentacle ID to attach to
- `--worktree-id`: explicit worktree ID
- `--parent-terminal-id`: parent terminal ID for child terminals
- `--prompt-template`: prompt template name
- `--prompt-variables`: JSON object of prompt template variables

## List terminals

```bash
octogent terminal list
```

Shows each terminal ID, lifecycle state, recorded process ID when available, lifecycle reason, and display name.

## Stop or kill a terminal

```bash
octogent terminal stop <terminal-id>
octogent terminal kill <terminal-id>
```

`stop` closes an active session or sends `SIGTERM` to the recorded process for a stale terminal. `kill` uses `SIGKILL`.

## Prune inactive terminal records

```bash
octogent terminal prune
```

Removes terminal records whose lifecycle state is `stale`, `stopped`, or `exited`. It does not remove active sessions.

## Send a message

```bash
octogent channel send <terminal-id> "message"
```

Use `--from <terminal-id>` when sending on behalf of a worker or parent terminal. If `--from` is omitted, the CLI falls back to `OCTOGENT_SESSION_ID` when the command is running inside an Octogent-managed terminal.

## List messages

```bash
octogent channel list <terminal-id>
```

## Skills

Octogent ships with a bundled skills catalog. These commands work from any
project directory and do not require the dashboard to be running. See the
[Skills Catalog](../guides/skills-catalog.md) guide for the full model.

```bash
octogent skills list
```

Lists bundled skills (always available inside Octogent) and any skills installed
in the project's `.claude/skills/`. Flags bundled skills whose required API keys
are unset.

```bash
octogent skills install --skill <name>
octogent skills install --all
```

Copies bundled skills into `.claude/skills/` so plain Claude Code can discover
them too. Existing skills are skipped unless `--force` is passed.

```bash
octogent skills status
```

Shows which bundled skills have their required API keys set.

```bash
octogent skills doctor
```

Diagnoses skill prerequisites: Node version, required API keys, and per-skill
setup commands.
