"""
Jarvis-Pro interactive TUI — runs directly in any terminal.

Uses Rich's Layout + Live display for a full-screen dashboard you
can drive without a browser.

Controls:
  1-4       → select skill
  a / c / k → select clients (all / carpet-salem / kaplunmarx)
  r         → run selected skill on selected clients
  R         → open research prompt
  m         → switch to metrics view
  s         → switch to skills view
  q         → quit
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

# Ensure project root is on the path regardless of cwd
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from typing import Optional

from rich import box
from rich.align import Align
from rich.columns import Columns
from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.markdown import Markdown
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich.prompt import Prompt

console = Console()

# ── Colour palette ────────────────────────────────────────────────────────────
ACCENT   = "bright_blue"
GREEN    = "bright_green"
RED      = "bright_red"
YELLOW   = "yellow"
MUTED    = "dim white"
HEADER   = "bold bright_white on grey19"


# ── Lazy imports (keep startup fast) ─────────────────────────────────────────
def _registry():
    from core.registry import ClientRegistry
    return ClientRegistry()

def _skill_registry():
    from skills import SKILL_REGISTRY
    return SKILL_REGISTRY

def _metrics():
    from core.config import settings
    from self_improvement.evaluator import SkillEvaluator
    settings.ensure_jarvis_dirs()
    ev = SkillEvaluator()
    rows = []
    for name in _skill_registry():
        m = ev.get_metrics(name)
        rows.append(m)
    return rows


# ── State ─────────────────────────────────────────────────────────────────────
class AppState:
    def __init__(self):
        self.clients = []
        self.skills  = []
        self.selected_skill_idx = 0
        self.selected_clients: set[str] = {"all"}
        self.view = "skills"          # "skills" | "metrics" | "research"
        self.output_lines: list[str] = []
        self.running = False
        self.status = "Ready"
        self.metrics_cache = []

    @property
    def selected_skill(self) -> str:
        if not self.skills:
            return ""
        return self.skills[self.selected_skill_idx % len(self.skills)]

    def add_output(self, line: str):
        self.output_lines.append(line)
        # Keep last 200 lines
        if len(self.output_lines) > 200:
            self.output_lines = self.output_lines[-200:]


state = AppState()


# ── Renderers ─────────────────────────────────────────────────────────────────

def render_header() -> Panel:
    t = Text()
    t.append("  ██ ", style=f"bold {ACCENT}")
    t.append("Jarvis-Pro", style="bold bright_white")
    t.append("   SEO Intelligence Platform", style=MUTED)
    t.append("   │   ", style=MUTED)
    t.append(f"view:{state.view}", style=ACCENT)
    t.append("   │   [q]quit  [r]run  [R]research  [m]metrics  [s]skills", style=MUTED)
    return Panel(t, style="on grey19", padding=(0, 1))


def render_sidebar() -> Panel:
    t = Table.grid(padding=(0, 1))
    t.add_column(width=24)

    # Clients
    t.add_row(Text("CLIENTS", style=f"bold {MUTED}"))
    client_opts = [("all", "★ All clients")]
    for c in state.clients:
        client_opts.append((c.id, f"{c.name}"))

    for cid, label in client_opts:
        sel = cid in state.selected_clients
        style = f"bold {ACCENT}" if sel else "white"
        prefix = "● " if sel else "○ "
        t.add_row(Text(prefix + label, style=style))

    t.add_row(Text(""))
    t.add_row(Text("SKILLS", style=f"bold {MUTED}"))

    keys = ["1", "2", "3", "4"]
    for i, skill in enumerate(state.skills):
        sel = i == state.selected_skill_idx
        key = keys[i] if i < len(keys) else "-"
        style = f"bold {ACCENT}" if sel else "white"
        prefix = f"[{key}] ● " if sel else f"[{key}] ○ "
        t.add_row(Text(prefix + skill, style=style))

    t.add_row(Text(""))
    t.add_row(Text("STATUS", style=f"bold {MUTED}"))
    status_style = RED if "Error" in state.status or "FAIL" in state.status else (
        GREEN if "Done" in state.status or "OK" in state.status else ACCENT
    )
    t.add_row(Text(state.status, style=status_style))

    return Panel(t, title="[bold]Navigator[/bold]", border_style=ACCENT, padding=(1, 1))


def render_main() -> Panel:
    if state.view == "metrics":
        return render_metrics_panel()
    return render_output_panel()


def render_output_panel() -> Panel:
    body = Text()
    if not state.output_lines:
        body.append(
            "Select a skill with [1-4], clients with [a/c/k], then press [r] to run.\n"
            "Press [R] to open the research harness.\n"
            "Press [m] for the metrics dashboard.",
            style=MUTED,
        )
    else:
        for line in state.output_lines[-80:]:
            if line.startswith("✅") or "OK" in line[:6]:
                body.append(line + "\n", style=GREEN)
            elif line.startswith("❌") or "FAIL" in line[:6] or "Error" in line[:8]:
                body.append(line + "\n", style=RED)
            elif line.startswith("##") or line.startswith("#"):
                body.append(line + "\n", style=f"bold {ACCENT}")
            elif line.startswith("---"):
                body.append(line + "\n", style=MUTED)
            else:
                body.append(line + "\n")

    title = f"[bold]{'Running…' if state.running else 'Output'}[/bold]"
    return Panel(body, title=title, border_style=ACCENT if not state.running else YELLOW)


def render_metrics_panel() -> Panel:
    if not state.metrics_cache:
        return Panel(Text("Loading metrics…", style=MUTED), title="[bold]Metrics[/bold]")

    t = Table(box=box.SIMPLE_HEAD, show_header=True, header_style=f"bold {MUTED}")
    t.add_column("Skill", style="bold")
    t.add_column("Runs",   justify="right")
    t.add_column("Success", justify="right")
    t.add_column("Avg Duration", justify="right")
    t.add_column("Rating", justify="right")
    t.add_column("Status")

    for m in state.metrics_cache:
        sr = f"{m.success_rate*100:.0f}%" if m.success_rate is not None else "—"
        dur = f"{m.avg_duration_s:.1f}s" if m.avg_duration_s else "—"
        rating = f"★{m.avg_user_rating:.1f}" if m.avg_user_rating else "—"
        status_style = GREEN if m.total_executions == 0 or (m.success_rate or 0) >= 0.80 else RED
        status_label = "GREEN" if m.total_executions == 0 or (m.success_rate or 0) >= 0.80 else "RED"
        t.add_row(
            m.skill,
            str(m.total_executions),
            Text(sr, style=GREEN if (m.success_rate or 0) >= 0.80 else RED),
            dur,
            rating,
            Text(status_label, style=f"bold {status_style}"),
        )

    return Panel(t, title="[bold]Skill Performance Metrics[/bold]", border_style=ACCENT)


def render_layout(layout: Layout):
    layout["header"].update(render_header())
    layout["sidebar"].update(render_sidebar())
    layout["main"].update(render_main())


# ── Background task runner ────────────────────────────────────────────────────

def run_skill_bg(skill_name: str, client_ids: set[str], live: Live):
    """Run the skill in a background thread so the TUI stays live."""
    from core.config import settings
    settings.ensure_jarvis_dirs()
    reg = _registry()
    skills = _skill_registry()

    ids = "all" if "all" in client_ids else list(client_ids)
    clients = reg.resolve(ids)

    if not clients:
        state.add_output("❌ No matching clients found.")
        state.running = False
        state.status = "Error: no clients"
        return

    skill_cls = skills[skill_name]
    skill = skill_cls()

    state.add_output(f"\n{'─'*60}")
    state.add_output(f"▶  {skill_name.upper()}  ·  {len(clients)} client(s)  ·  {time.strftime('%H:%M:%S')}")
    state.add_output(f"{'─'*60}")

    ok = 0
    for client in clients:
        state.add_output(f"\n⏳ {client.name}…")
        state.status = f"Running on {client.name}…"
        r = skill.run(client)
        if r.success:
            ok += 1
            state.add_output(f"✅ {client.name}  ({r.duration_s:.1f}s)  exec:{r.execution_id}")
            if r.output:
                for line in str(r.output).split("\n"):
                    state.add_output(line)
        else:
            state.add_output(f"❌ {client.name}  ({r.duration_s:.1f}s)  exec:{r.execution_id}")
            state.add_output(f"   Error: {r.error}")

    state.add_output(f"\n{'─'*60}")
    state.add_output(f"Done: {ok}/{len(clients)} succeeded")
    state.running = False
    state.status = f"Done: {ok}/{len(clients)} OK"


def run_research_bg(topic: str, depth: int, client_id: Optional[str], live: Live):
    from core.config import settings
    settings.ensure_jarvis_dirs()
    from research.harness import ResearchHarness

    state.add_output(f"\n{'─'*60}")
    state.add_output(f"▶  RESEARCH  ·  depth:{depth}  ·  {time.strftime('%H:%M:%S')}")
    state.add_output(f"Topic: {topic}")
    state.add_output(f"{'─'*60}\n")
    state.status = "Researching…"

    try:
        reg = _registry()
        harness = ResearchHarness(vault=None, registry=reg)
        result = harness.research(
            topic,
            client_id=client_id or None,
            depth=depth,
            save_to_vault=False,
            use_cache=True,
        )
        if result.summary:
            for line in result.summary.split("\n"):
                state.add_output(line)
        state.add_output(f"\n{'─'*60}")
        state.add_output(f"✅ Research complete  ·  {len(result.sources)} sources")
        state.status = "Research done"
    except Exception as exc:
        state.add_output(f"❌ Research error: {exc}")
        state.status = f"Error: {exc}"
    finally:
        state.running = False


# ── Main TUI loop ─────────────────────────────────────────────────────────────

def main():
    # Load initial data
    try:
        reg = _registry()
        state.clients = reg.list(active_only=True)
        state.skills  = list(_skill_registry().keys())
    except Exception as e:
        console.print(f"[red]Failed to load data: {e}[/red]")
        sys.exit(1)

    layout = Layout()
    layout.split_column(
        Layout(name="header", size=3),
        Layout(name="body"),
    )
    layout["body"].split_row(
        Layout(name="sidebar", minimum_size=28, ratio=1),
        Layout(name="main", ratio=4),
    )

    # Alias for cleaner render calls
    def _refresh():
        render_layout(layout)

    console.print("\n[bold bright_blue]Jarvis-Pro TUI[/bold bright_blue]  —  press [q] to quit\n")

    with Live(layout, console=console, refresh_per_second=4, screen=True) as live:
        _refresh()

        while True:
            try:
                import termios, tty, select
                fd = sys.stdin.fileno()
                old = termios.tcgetattr(fd)
                tty.setraw(fd)
                try:
                    r, _, _ = select.select([sys.stdin], [], [], 0.25)
                    if not r:
                        _refresh()
                        continue
                    ch = sys.stdin.read(1)
                finally:
                    termios.tcsetattr(fd, termios.TCSADRAIN, old)
            except Exception:
                # Fallback for environments without raw-mode TTY
                _refresh()
                time.sleep(0.5)
                continue

            # ── Key handling ──────────────────────────────────────────────
            if ch == "q":
                break

            elif ch in "1234":
                idx = int(ch) - 1
                if idx < len(state.skills):
                    state.selected_skill_idx = idx

            elif ch == "a":
                state.selected_clients = {"all"}

            elif ch == "c":
                state.selected_clients = {"carpet-salem"}

            elif ch == "k":
                state.selected_clients = {"kaplunmarx"}

            elif ch == "A":   # Toggle ALL without deselecting others
                if "all" in state.selected_clients:
                    state.selected_clients.discard("all")
                else:
                    state.selected_clients.add("all")

            elif ch == "m":
                state.view = "metrics"
                state.metrics_cache = _metrics()

            elif ch == "s":
                state.view = "skills"

            elif ch == "r" and not state.running:
                if not state.selected_skill:
                    state.add_output("❌ No skill selected.")
                else:
                    state.running = True
                    state.view = "skills"
                    t = threading.Thread(
                        target=run_skill_bg,
                        args=(state.selected_skill, set(state.selected_clients), live),
                        daemon=True,
                    )
                    t.start()

            elif ch == "R" and not state.running:
                # Temporarily leave raw mode to collect input
                state.view = "skills"
                _refresh()
                live.stop()
                console.print()
                try:
                    topic = Prompt.ask("[bright_blue]Research topic[/bright_blue]")
                    depth_str = Prompt.ask("Depth [1-3]", default="2")
                    depth = max(1, min(3, int(depth_str or "2")))
                    cid_prompt = ", ".join(c.id for c in state.clients)
                    cid = Prompt.ask(f"Client context [{cid_prompt}] or blank", default="")
                except KeyboardInterrupt:
                    topic = ""

                live.start()
                if topic:
                    state.running = True
                    t = threading.Thread(
                        target=run_research_bg,
                        args=(topic, depth, cid or None, live),
                        daemon=True,
                    )
                    t.start()

            _refresh()

    console.print("\n[bold bright_blue]Jarvis-Pro[/bold bright_blue] — session ended.\n")


if __name__ == "__main__":
    main()
