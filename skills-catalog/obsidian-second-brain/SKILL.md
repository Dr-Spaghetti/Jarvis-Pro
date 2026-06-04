---
name: obsidian-second-brain
description: >
  Use the user's Obsidian vault as a persistent second brain: capture notes,
  retrieve knowledge, maintain daily notes, link ideas, and keep an organized
  knowledge base. Trigger whenever the user asks to: remember something, save a
  note, "add this to my notes/brain", look something up in their notes, find
  what they wrote about a topic, summarize their vault, create a daily note,
  build a map-of-content/index, capture a task or idea, or "what do I know
  about X". Also trigger on phrases like "put this in Obsidian", "check my
  vault", "log this", "second brain", or "my knowledge base".
compatibility: >
  Works two ways. PREFERRED: a connected Obsidian MCP server (server name
  "obsidian", via the Local REST API plugin) exposing tools like search,
  get_file_contents, append_content, patch_content, and create/list files.
  FALLBACK: direct filesystem access to the vault folder via the
  OBSIDIAN_VAULT_PATH environment variable, using Read/Grep/Glob/Write. No API
  key required.
---

# Obsidian Second Brain

This skill turns the user's Obsidian vault into durable memory for the
assistant. The vault is the single source of truth for what the user knows,
decides, and wants to remember. Treat it with the care of someone's actual
brain: additive by default, never destructive.

## Memory & activity journal (the Jarvis substrate)

Two special files back the Jarvis home — keep them current; this is the canonical
protocol every Jarvis skill follows:

- **`Jarvis/Memory.md`** — long-lived facts/preferences about Nick (durable
  context, not daily noise). Read it at the start of any task that benefits from
  context. When you learn a lasting fact, append it as a `- ` bullet under
  `## Facts`. The web "remember" action and `POST /api/brain/remember` write here too.
- **`Journal/Activity Log.md`** — an append-only record of what Jarvis did. After a
  meaningful action, append exactly one line (create the file with a
  `# Jarvis Activity Log` header if missing):
  `- [<ISO-8601 timestamp>] [ok|warn|error] (<skill-name>) <what you did> — <short detail>`
  The home Activity panel parses this exact format, so match it precisely.

## Choosing how to access the vault

Check, in this order:

1. **Obsidian MCP tools** — if an MCP server named `obsidian` is available
   (tools such as `search`, `get_file_contents`, `list_files_in_vault`,
   `append_content`, `patch_content`, create/update), prefer it. It respects
   Obsidian's own indexing and works while the app is open.
2. **Filesystem fallback** — otherwise read the env var `OBSIDIAN_VAULT_PATH`
   for the vault root and operate on the `.md` files directly with
   Grep (search), Read (open), Glob (discover), and Write/Edit (create/update).
   If `OBSIDIAN_VAULT_PATH` is unset, ask the user for the vault path once.

Never touch the `.obsidian/` config folder — that is Obsidian's settings, not
knowledge.

## Core principles

- **Know the user first.** If `Profile.md` exists at the vault root, read it at
  the start of a session for standing context — who they are, their goals,
  priorities, and preferences — and tailor everything to it.
- **Retrieve before you answer.** For any "what do I know / did I write about
  X" question, SEARCH the vault first and answer from the user's own notes,
  citing the note name/path. Do not answer from general knowledge when the user
  is asking about *their* brain.
- **Capture, don't lose.** When the user says "remember/save/log this", write it
  to the vault immediately in the right place. Confirm where you put it.
- **Atomic + linked.** Prefer small, single-idea notes connected with
  `[[wikilinks]]` over giant documents. Link generously to existing notes.
- **Additive and safe.** Append or patch; do not overwrite or delete notes
  unless the user explicitly asks. Preserve existing frontmatter and structure.
- **Don't duplicate.** Before creating a note, search for an existing one on the
  topic and extend it instead.

## Conventions

Use these unless the vault clearly already follows a different scheme (detect by
listing a few folders/notes first and matching what's there):

- **Inbox / capture:** quick captures go to `Inbox/` (or append to the current
  daily note) for later filing.
- **Daily notes:** `Daily/YYYY-MM-DD.md`. Append timestamped bullets.
- **Permanent notes:** topical notes at the vault root or in a `Notes/` folder,
  one idea per note, richly linked.
- **Projects:** `Projects/<name>.md` with status, next actions, and links.
- **Maps of Content (MOCs):** index notes like `<Topic> MOC.md` that link out to
  related notes — build these when a topic accumulates several notes.
- **Frontmatter:** keep YAML frontmatter (`tags`, `created`, `aliases`) intact;
  add `tags` when it helps retrieval.

## Workflows

### Capture
1. Decide destination: daily note (fleeting) vs. a topical/permanent note
   (durable) vs. `Inbox/` (unsorted).
2. Append the content (timestamp fleeting captures).
3. Add `[[links]]` to any clearly related existing notes.
4. Tell the user exactly which note you wrote to.

### Retrieve / answer from the brain
1. Search the vault for the topic (MCP `search` or Grep over the vault).
2. Open the most relevant notes and read them.
3. Answer using the user's own words/notes, citing note names; quote sparingly.
4. Offer to capture any new conclusions back into the vault.

### Daily note
1. Resolve today's date note `Daily/YYYY-MM-DD.md`; create from the daily
   template if missing.
2. Append entries under clear headings (e.g. `## Log`, `## Tasks`, `## Notes`).

### Organize / synthesize
1. Find clusters of related notes via search/tags.
2. Propose or create a MOC linking them.
3. Surface orphan notes (no inbound/outbound links) and suggest connections.

## Output style

- After any write, state the note path and a one-line summary of what changed.
- When answering from the vault, lead with the answer, then cite the notes used
  (e.g. "from `[[Pricing Strategy]]` and `Daily/2026-05-28`").
- Be honest when the vault has nothing on a topic — say so and offer to start a
  note, rather than inventing.

## What this skill does NOT do

- It does not delete or overwrite notes unless explicitly told.
- It does not modify `.obsidian/` settings, themes, or plugins.
- It does not sync or publish the vault anywhere.
