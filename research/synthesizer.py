"""
Uses Claude to synthesize multi-source research findings into a structured note.
"""
from integrations.anthropic_client import JarvisAnthropicClient
from core.config import settings

SYNTHESIS_SYSTEM = """\
You are a research synthesizer for a local SEO agency. Your job is to take raw
research findings from multiple sources and produce a clean, structured, actionable
Markdown document. Focus on practical insights. Cite sources with [n] notation.
Be concise — every sentence should earn its place."""

SYNTHESIS_PROMPT = """\
Topic: {topic}
Context: {context}

--- FINDINGS ---
{findings}

--- TASK ---
Synthesize the findings above into a well-structured Markdown document.
Include:
1. A 2-3 sentence executive summary
2. Key findings (bullet points)
3. Actionable recommendations for a local SEO practitioner
4. Gaps / questions still open

Use [n] inline citations referencing the source URLs listed at the end.
Do NOT pad with generic filler. If the data is thin, say so plainly."""


def synthesize(
    topic: str,
    findings: list[dict],
    context: str = "",
    model: str = None,
) -> dict:
    """
    findings: list of {"title": str, "snippet": str, "url": str}
    Returns {"summary": str, "sources": [str]}
    """
    client = JarvisAnthropicClient(model=model or settings.research_model)
    numbered = []
    sources = []
    for i, f in enumerate(findings, 1):
        numbered.append(f"[{i}] {f['title']}\n{f['snippet']}\nURL: {f['url']}")
        sources.append(f['url'])

    findings_text = "\n\n".join(numbered)
    prompt = SYNTHESIS_PROMPT.format(
        topic=topic,
        context=context or "General research",
        findings=findings_text or "(No external findings — synthesize from general knowledge)",
    )
    text = client.complete(prompt, system=SYNTHESIS_SYSTEM, max_tokens=3000)
    return {"summary": text, "sources": [s for s in sources if s]}
