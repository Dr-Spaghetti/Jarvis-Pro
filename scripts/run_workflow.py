"""
Workflow runner — executes a sequence of skills across a set of clients.

Usage: python scripts/run_workflow.py --workflow weekly --clients all
       python scripts/run_workflow.py --workflow onboard --clients kaplunmarx

Workflows are defined as ordered lists of skills with options.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import typer
from rich import print as rprint
from rich.console import Console

app = typer.Typer()
console = Console()

WORKFLOWS: dict[str, list[dict]] = {
    "weekly": [
        {"skill": "falcon-report", "save_vault": True},
        {"skill": "gbp-monitor", "save_vault": True},
    ],
    "audit": [
        {"skill": "citation-audit", "save_vault": True},
        {"skill": "keyword-hygiene", "save_vault": True},
        {"skill": "gbp-monitor", "save_vault": True},
    ],
    "onboard": [
        {"skill": "citation-audit", "save_vault": True},
        {"skill": "gbp-monitor", "save_vault": True},
        {"skill": "keyword-hygiene", "save_vault": True},
    ],
    "rankings": [
        {"skill": "falcon-report", "save_vault": True},
    ],
}


@app.command()
def main(
    workflow: str = typer.Option(..., "--workflow", "-w", help=f"One of: {list(WORKFLOWS)}"),
    clients: str = typer.Option("all", "--clients", "-c"),
):
    from core.config import settings
    from core.registry import ClientRegistry
    from integrations.obsidian import ObsidianVault
    from skills import SKILL_REGISTRY

    settings.ensure_jarvis_dirs()

    if workflow not in WORKFLOWS:
        rprint(f"[red]Unknown workflow: {workflow}[/red]. Options: {list(WORKFLOWS)}")
        raise typer.Exit(1)

    steps = WORKFLOWS[workflow]
    reg = ClientRegistry()
    vault = ObsidianVault() if settings.has_vault else None
    client_ids = "all" if clients == "all" else [c.strip() for c in clients.split(",")]
    client_list = reg.resolve(client_ids)

    if not client_list:
        rprint("[red]No matching clients.[/red]")
        raise typer.Exit(1)

    rprint(f"\n[bold]Workflow: [cyan]{workflow}[/cyan] — {len(steps)} steps × {len(client_list)} clients[/bold]\n")

    total_ok = 0
    total_fail = 0

    for step in steps:
        skill_name = step["skill"]
        save_vault = step.get("save_vault", False)

        if skill_name not in SKILL_REGISTRY:
            rprint(f"[yellow]Skipping unknown skill: {skill_name}[/yellow]")
            continue

        rprint(f"[bold]Step: {skill_name}[/bold]")
        skill_cls = SKILL_REGISTRY[skill_name]
        skill = skill_cls(vault=vault)

        for client in client_list:
            with console.status(f"  {client.name}..."):
                r = skill.run(client, save_vault=save_vault)
            if r.success:
                total_ok += 1
                rprint(f"  [green]OK[/green] {client.name}")
            else:
                total_fail += 1
                rprint(f"  [red]FAIL[/red] {client.name}: {r.error}")
        console.print()

    rprint(f"[bold]Workflow complete: {total_ok} OK, {total_fail} failed[/bold]")


if __name__ == "__main__":
    app()
