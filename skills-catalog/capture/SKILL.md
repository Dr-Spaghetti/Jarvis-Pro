---
name: capture
description: >
  Ingest an external source — a web article, YouTube video, or PDF — into the
  Obsidian second brain as a cited, summarized, linked note. Trigger whenever the
  user: pastes a URL and wants it saved, says "save this to my brain", "clip
  this", "summarize and file this", "add this source/article/video/paper", "read
  this and take notes", or drops a PDF/link to capture. Distinct from quick text
  capture (that is obsidian-second-brain) — this skill processes a whole external
  artifact end-to-end.
compatibility: >
  Uses Claude's built-in WebFetch (articles/URLs) and PDF reading; for YouTube,
  extract the transcript/summary. Writes into the vault via the obsidian MCP
  server when connected, else via OBSIDIAN_VAULT_PATH. No API key required.
---

# Capture (Reading Pipeline)

Turn a link, video, or document into a permanent, cited note so the brain
compounds — every source you process becomes searchable, linked knowledge.

## Pipeline

1. **Detect the input type:** web article/URL, YouTube video, or PDF (local path
   or URL). Ask only if genuinely ambiguous.
2. **Extract the content:**
   - **Article/URL:** WebFetch the page; pull the main text, title, author, date.
   - **YouTube:** get the transcript/summary (note the channel + title); if a
     transcript isn't available, summarize from what is accessible and say so.
   - **PDF:** read it; capture title, author, and structure.
3. **Check for duplicates:** search the vault for an existing note on this source
   (by title or URL). If found, **update/extend it** instead of creating a new
   one.
4. **Write the source note** (format below).
5. **Link it in:** add `[[wikilinks]]` to clearly related existing notes, and to
   a topic MOC if one exists. **Report the exact note path.**

## Source note format

Default location: `Notes/<Clean Title>.md` (keep folders shallow). Use this
structure:

```markdown
---
title: <title>
source: <url or file path>
author: <author/channel, if known>
type: <article | video | pdf>
captured: <YYYY-MM-DD>
tags: [source]
---

# <title>

## TL;DR
<2–4 sentence summary — the bottom line.>

## Key points
- <the most important takeaways, in the user's-benefit framing>

## Notable quotes
> <verbatim quote>  — (only if genuinely worth keeping)

## My thoughts
<stub for the user; leave a prompt like "—" for them to fill>

## Links
- Related: [[...]]
```

## Principles

- **Faithful, not padded.** Summarize what the source actually says; don't invent
  facts or quotes. If something is unclear, say so.
- **User-benefit framing** for key points (what's useful to *them*), not a flat
  outline.
- **One source per note**; dedupe before creating.
- **Additive and safe:** never overwrite an unrelated note; never touch
  `.obsidian/`.

## After capture

Offer next steps that compound: "Want me to link this into a MOC, add a task
about it, or capture your takeaway?" (hands off to task-manager /
obsidian-second-brain when relevant).

## What this does NOT do

- It does not fabricate sources, quotes, or transcripts.
- It does not save silently — it always reports the note path.
- It does not download paywalled/inaccessible content; it captures what it can
  and flags the gap.
