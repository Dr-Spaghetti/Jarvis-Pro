---
name: web-research
description: >
  Research a topic on the open web, verify claims across multiple sources, and
  optionally save a cited synthesis into the Obsidian vault. Trigger whenever the
  user asks to: look something up online, research a topic, find sources, check
  the latest on X, fact-check a claim, compare options, gather references, or
  "what's the current state of …". Also trigger on phrases like "search the web
  for", "find me articles on", "is it true that", or "dig into this topic".
compatibility: >
  Uses Claude's built-in WebSearch and WebFetch tools (no API key). If the
  obsidian second brain is available (obsidian MCP server or OBSIDIAN_VAULT_PATH),
  it can save the synthesis as a linked, cited note.
---

# Web Research

Turn an open question into a verified, cited answer — and optionally capture it
into the second brain so the knowledge compounds.

## Method

1. **Clarify the question** if it is ambiguous (timeframe, scope, what decision
   it informs). One quick question beats a wrong research direction.
2. **Plan 2–4 search angles** rather than one. Cover the obvious query plus a
   skeptical/counter angle and a "latest/recent" angle.
3. **Search** with WebSearch, then **WebFetch** the most credible 3–6 results to
   read the actual content (don't answer from snippets alone).
4. **Cross-check** key claims across at least two independent sources. Flag where
   sources disagree or where evidence is thin.
5. **Synthesize** a direct answer first, then the supporting detail.

## Source quality

- Prefer primary sources, official docs, and reputable outlets over content
  farms and SEO spam.
- Note the **date** of each source; for fast-moving topics, prioritize recent
  ones and say when something may be stale.
- Be explicit about uncertainty. "I couldn't verify X" is more useful than a
  confident guess.

## Output

- Lead with the **answer / bottom line**.
- Follow with concise supporting points.
- End with a **Sources** list: title + URL for everything you relied on.

## Save to the second brain (when relevant)

If the research is worth keeping (decisions, evergreen topics, ongoing
projects), offer to save it — or save it when the user asks to "remember this":

- Default location: `Notes/<Topic>.md` (permanent) or `Inbox/` (if unsorted).
- Include the bottom line, key findings, and the Sources list.
- Link to related existing notes with `[[wikilinks]]` and add a few `tags`.
- Use the obsidian MCP tools if connected; otherwise write via the vault path.
- Tell the user exactly which note you saved.

## What this does NOT do

- It does not present unverified claims as fact.
- It does not fabricate URLs or citations — only real, fetched sources.
- It does not save to the vault silently; it says where it wrote.
