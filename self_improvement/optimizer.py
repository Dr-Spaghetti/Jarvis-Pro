"""
SkillOptimizer — uses Claude to analyze skill performance and generate improved versions.

Workflow:
1. Fetch execution history + current skill definition
2. Prompt Claude with failure patterns + current prompt
3. Claude generates an improved version with rationale
4. Improved version is written to .jarvis/skill_versions/{skill}/{timestamp}.md
5. Operator reviews and promotes (or rejects)
"""
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from core.config import settings
from core.logger import logger
from integrations.anthropic_client import JarvisAnthropicClient
from self_improvement.evaluator import SkillEvaluator, SkillMetrics


ANALYSIS_SYSTEM = """\
You are an AI skill optimization expert. You analyze how AI agent prompts
perform in practice and suggest targeted improvements.
Be specific: point to exact wording that likely caused failures.
Prioritize changes with the highest expected impact."""

ANALYSIS_PROMPT = """\
Skill: {skill_name}
Current skill code/prompt:
---
{skill_definition}
---

Execution metrics (last {n} runs):
- Total executions: {total}
- Success rate: {success_rate:.1%}
- Avg duration: {avg_duration}s
- User satisfaction: {satisfaction}

Recent failures (sample):
{failures}

Recent user feedback:
{feedback}

Task:
1. Identify the most likely root causes of failures
2. Suggest 3-5 specific, targeted improvements to the skill
3. Generate an improved version of the prompt/skill definition
4. Explain the expected impact of each change

Format your response as:

## Root Cause Analysis
(your analysis)

## Proposed Changes
(numbered list of specific changes)

## Improved Version
```python
(improved code or prompt)
```

## Expected Impact
(per-change impact estimate)"""


@dataclass
class SkillVersion:
    skill: str
    version: str
    content: str
    rationale: str
    created_at: str
    parent_version: Optional[str] = None
    promoted: bool = False


class SkillOptimizer:
    def __init__(self, versions_dir: Optional[Path] = None):
        self._dir = versions_dir or settings.skill_versions_dir
        self._evaluator = SkillEvaluator()
        self._anthropic = JarvisAnthropicClient(model=settings.research_model)

    # ── Analysis ─────────────────────────────────────────────────────────────

    def analyze(self, skill: str) -> str:
        metrics = self._evaluator.get_metrics(skill)
        history = self._evaluator.recent_history(skill, n=50)
        skill_def = self._load_skill_definition(skill)
        failures = [h for h in history if not h["success"]][:5]
        feedback = [
            f"Rating {h['user_rating']}/5: {h.get('user_notes', '')}"
            for h in history
            if h.get("user_rating") is not None
        ]

        prompt = ANALYSIS_PROMPT.format(
            skill_name=skill,
            skill_definition=skill_def or "(definition not found)",
            n=len(history),
            total=metrics.total_executions,
            success_rate=metrics.success_rate,
            avg_duration=metrics.avg_duration_s,
            satisfaction=f"{metrics.avg_user_rating:.1f}/5" if metrics.avg_user_rating else "no ratings yet",
            failures=json.dumps(failures, indent=2) if failures else "none",
            feedback="\n".join(feedback) if feedback else "none yet",
        )
        return self._anthropic.complete(prompt, system=ANALYSIS_SYSTEM, max_tokens=3000)

    def generate_improved_version(self, skill: str) -> SkillVersion:
        analysis = self.analyze(skill)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        version_id = f"{timestamp}"
        sv = SkillVersion(
            skill=skill,
            version=version_id,
            content=analysis,
            rationale=analysis.split("## Root Cause Analysis")[-1][:500],
            created_at=datetime.now().isoformat(),
        )
        self._save_version(sv)
        logger.info("skill_version_generated", skill=skill, version=version_id)
        return sv

    # ── Version management ───────────────────────────────────────────────────

    def _save_version(self, sv: SkillVersion):
        skill_dir = self._dir / sv.skill
        skill_dir.mkdir(parents=True, exist_ok=True)
        path = skill_dir / f"{sv.version}.md"
        content = f"""---
skill: {sv.skill}
version: {sv.version}
created_at: {sv.created_at}
promoted: {sv.promoted}
---

{sv.content}
"""
        path.write_text(content)

    def list_versions(self, skill: str) -> list[Path]:
        skill_dir = self._dir / skill
        if not skill_dir.exists():
            return []
        return sorted(skill_dir.glob("*.md"), reverse=True)

    def promote_version(self, skill: str, version_id: str):
        """Mark a version as promoted (for operator tracking)."""
        path = self._dir / skill / f"{version_id}.md"
        if not path.exists():
            raise FileNotFoundError(f"Version {version_id} not found for skill {skill}")
        content = path.read_text()
        content = content.replace("promoted: false", "promoted: true")
        path.write_text(content)
        logger.info("skill_version_promoted", skill=skill, version=version_id)

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _load_skill_definition(self, skill: str) -> Optional[str]:
        skill_file = settings.skills_dir / f"{skill}.py"
        if skill_file.exists():
            return skill_file.read_text()[:3000]
        return None
