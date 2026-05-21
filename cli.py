"""
Jarvis-Pro CLI

Entry point for all commands. Install with `pip install -e .` then use `jarvis`.
Or run directly: python cli.py <command>

Commands:
  jarvis research <topic>
  jarvis skill run <skill> [--clients all|id1,id2]
  jarvis skill list
  jarvis client list
  jarvis client add
  jarvis client show <id>
  jarvis client update <id>
  jarvis improve analyze <skill>
  jarvis improve run
  jarvis obsidian sync-clients
  jarvis obsidian dashboard
  jarvis obsidian orphans
  jarvis feedback <exec_id> <1-5>
"""
import sys
from pathlib import Path
from typing import Optional

import typer
from rich import print as rprint
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from core.config import settings
from core.logger import logger
from core.registry import Client, ClientIntegrations, ClientRegistry

app = typer.Typer(
    name="jarvis",
    help="Jarvis-Pro: AI-powered local SEO assistant",
    add_completion=False,
    rich_markup_mode="markdown",
)
skill_app = typer.Typer(help="Run and manage skills")
client_app = typer.Typer(help="Manage the client registry")
improve_app = typer.Typer(help="Self-improvement engine")
obsidian_app = typer.Typer(help="Obsidian vault management")

app.add_typer(skill_app, name="skill")
app.add_typer(client_app, name="client")
app.add_typer(improve_app, name="improve")
app.add_typer(obsidian_app, name="obsidian")

console = Console()

# ── Shared state / lazy loaders ────────────────────────────────────────────────


def _registry() -> ClientRegistry:
    return ClientRegistry()


def _vault():
    if not settings.has_vault:
        return None
    from integrations.obsidian import ObsidianVault
    return ObsidianVault()


def _require_anthropic():
    if not settings.has_anthropic:
        rprint("[red]Error: ANTHROPIC_API_KEY is not set. Run: cp .env.example .env[/red]")
        raise typer.Exit(1)


# ── research ───────────────────────────────────────────────────────────────────


@app.command()
def research(
    topic: str = typer.Argument(..., help="Research question or topic"),
    client_id: Optional[str] = typer.Option(None, "--client", "-c", help="Client context"),
    depth: int = typer.Option(2, "--depth", "-d", help="Research depth (1-5)"),
    no_save: bool = typer.Option(False, "--no-save", help="Skip saving to Obsidian vault"),
    no_cache: bool = typer.Option(False, "--no-cache", help="Skip cache lookup"),
):
    """Run the multi-source research harness."""
    _require_anthropic()
    settings.ensure_jarvis_dirs()

    from research.harness import ResearchHarness

    with console.status(f"[bold cyan]Researching: {topic}[/bold cyan]"):
        harness = ResearchHarness(vault=_vault(), registry=_registry())
        result = harness.research(
            topic,
            client_id=client_id,
            depth=depth,
            save_to_vault=not no_save,
            use_cache=not no_cache,
        )

    console.print(Panel(result.summary, title=f"[bold]{topic}[/bold]", border_style="cyan"))

    if result.vault_path:
        rprint(f"\n[green]Saved to vault:[/green] {result.vault_path}")
    if result.cached:
        rprint("[yellow]Note: result was from cache (use --no-cache to force fresh)[/yellow]")
    if result.sources:
        rprint(f"\n[dim]Sources: {len(result.sources)} cited[/dim]")


# ── skill ──────────────────────────────────────────────────────────────────────


@skill_app.command("list")
def skill_list():
    """List all available skills."""
    from skills import SKILL_REGISTRY

    table = Table(title="Available Skills", show_header=True, header_style="bold cyan")
    table.add_column("Name", style="bold")
    table.add_column("Description")
    for name, cls in SKILL_REGISTRY.items():
        table.add_row(name, cls.description)
    console.print(table)


@skill_app.command("run")
def skill_run(
    skill_name: str = typer.Argument(..., help="Skill name (e.g. citation-audit)"),
    clients: str = typer.Option("all", "--clients", "-c", help="'all' or comma-separated IDs"),
    save_vault: bool = typer.Option(False, "--save-vault", help="Write output to Obsidian vault"),
    show_output: bool = typer.Option(True, "--output/--no-output", help="Print output to console"),
):
    """Run a skill across one or more clients."""
    _require_anthropic()
    settings.ensure_jarvis_dirs()

    from skills import SKILL_REGISTRY

    if skill_name not in SKILL_REGISTRY:
        rprint(f"[red]Unknown skill: {skill_name}[/red]. Run `jarvis skill list` to see options.")
        raise typer.Exit(1)

    reg = _registry()
    vault = _vault()
    client_ids = "all" if clients == "all" else [c.strip() for c in clients.split(",")]
    client_list = reg.resolve(client_ids)

    if not client_list:
        rprint("[red]No matching clients found.[/red]")
        raise typer.Exit(1)

    skill_cls = SKILL_REGISTRY[skill_name]
    skill = skill_cls(vault=vault)

    rprint(f"\n[bold]Running [cyan]{skill_name}[/cyan] for {len(client_list)} client(s)...[/bold]\n")

    results = []
    for client in client_list:
        with console.status(f"  {client.name}..."):
            r = skill.run(client, save_vault=save_vault)
        status = "[green]OK[/green]" if r.success else "[red]FAIL[/red]"
        rprint(f"  {status} {client.name} ({r.duration_s:.1f}s) [dim]exec:{r.execution_id}[/dim]")
        if show_output and r.output:
            console.print(Panel(str(r.output)[:2000], title=client.name, border_style="dim"))
        if r.vault_path:
            rprint(f"       [dim]Saved: {r.vault_path}[/dim]")
        results.append(r)

    ok = sum(1 for r in results if r.success)
    rprint(f"\n[bold]Done: {ok}/{len(results)} succeeded[/bold]")
    if ok < len(results):
        rprint("[yellow]Tip: run `jarvis improve run` to analyze failures[/yellow]")


# ── client ─────────────────────────────────────────────────────────────────────


@client_app.command("list")
def client_list(
    all_clients: bool = typer.Option(False, "--all", "-a", help="Include inactive clients"),
    tag: Optional[str] = typer.Option(None, "--tag", "-t", help="Filter by tag"),
):
    """List clients in the registry."""
    reg = _registry()
    tags = [tag] if tag else None
    clients = reg.list(active_only=not all_clients, tags=tags)

    table = Table(title="Clients", show_header=True, header_style="bold cyan")
    table.add_column("ID")
    table.add_column("Name")
    table.add_column("Type")
    table.add_column("Location")
    table.add_column("Keyword")
    table.add_column("Active")

    for c in clients:
        active_str = "[green]yes[/green]" if c.active else "[red]no[/red]"
        table.add_row(c.id, c.name, c.business_type, c.location_str, c.primary_keyword, active_str)

    console.print(table)
    rprint(f"\n[dim]{len(clients)} client(s) shown[/dim]")


@client_app.command("show")
def client_show(client_id: str = typer.Argument(..., help="Client ID or name")):
    """Show all details for a client."""
    reg = _registry()
    client = reg.get(client_id)
    if not client:
        rprint(f"[red]Client not found: {client_id}[/red]")
        raise typer.Exit(1)
    console.print(Panel(client.to_context_string(), title=f"[bold]{client.name}[/bold]"))
    rprint(f"\n[dim]Integrations: {client.integrations.model_dump()}[/dim]")


@client_app.command("add")
def client_add():
    """Interactively add a new client to the registry."""
    rprint("[bold cyan]Add New Client[/bold cyan]\n")

    client_id = typer.prompt("Client ID (slug, e.g. 'my-business')")
    name = typer.prompt("Display name")
    business_type = typer.prompt("Business type", default="")
    primary_keyword = typer.prompt("Primary keyword", default="")
    city = typer.prompt("City", default="")
    state = typer.prompt("State (2-letter)", default="")
    website = typer.prompt("Website URL", default="")
    notes = typer.prompt("Notes", default="")

    rprint("\n[bold]Integrations (press Enter to skip):[/bold]")
    gbp_url = typer.prompt("GBP URL", default="")
    local_falcon_id = typer.prompt("Local Falcon location ID", default="")
    yext_id = typer.prompt("Yext account ID", default="")

    client = Client(
        id=client_id,
        name=name,
        business_type=business_type,
        primary_keyword=primary_keyword,
        city=city,
        state=state,
        website=website,
        notes=notes,
        integrations=ClientIntegrations(
            gbp_url=gbp_url,
            local_falcon_id=local_falcon_id,
            yext_account_id=yext_id,
        ),
    )

    reg = _registry()
    try:
        reg.add(client)
        rprint(f"\n[green]Client '{name}' added successfully.[/green]")
    except ValueError as e:
        rprint(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


@client_app.command("update")
def client_update(
    client_id: str = typer.Argument(...),
    field: str = typer.Option(..., "--field", "-f", help="Field name (dot notation: integrations.gbp_url)"),
    value: str = typer.Option(..., "--value", "-v", help="New value"),
):
    """Update a single field on a client."""
    reg = _registry()
    try:
        updated = reg.update(client_id, **{field: value})
        rprint(f"[green]Updated {field} for {updated.name}[/green]")
    except (ValueError, KeyError) as e:
        rprint(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


# ── improve ────────────────────────────────────────────────────────────────────


@improve_app.command("analyze")
def improve_analyze(skill: str = typer.Argument(..., help="Skill name to analyze")):
    """Use Claude to analyze a skill's performance and suggest improvements."""
    _require_anthropic()
    settings.ensure_jarvis_dirs()

    from self_improvement.optimizer import SkillOptimizer

    with console.status(f"Analyzing [cyan]{skill}[/cyan]..."):
        opt = SkillOptimizer()
        analysis = opt.analyze(skill)

    console.print(Panel(analysis, title=f"[bold]Analysis: {skill}[/bold]", border_style="yellow"))


@improve_app.command("run")
def improve_run(
    force: Optional[str] = typer.Option(
        None, "--force", "-f", help="Comma-separated skills to force (bypasses threshold)"
    )
):
    """Run a full improvement cycle across all underperforming skills."""
    _require_anthropic()
    settings.ensure_jarvis_dirs()

    from self_improvement.feedback_loop import FeedbackLoop

    force_list = [s.strip() for s in force.split(",")] if force else None

    with console.status("Running improvement cycle..."):
        loop = FeedbackLoop()
        result = loop.run(force_skills=force_list)

    rprint(f"\n{result.summary}")
    if result.improvements:
        rprint(f"\n[yellow]Review staged versions in: {settings.skill_versions_dir}[/yellow]")


@improve_app.command("metrics")
def improve_metrics():
    """Show performance metrics for all tracked skills."""
    settings.ensure_jarvis_dirs()

    from self_improvement.evaluator import SkillEvaluator

    ev = SkillEvaluator()
    all_metrics = ev.all_metrics()

    if not all_metrics:
        rprint("[dim]No execution history yet. Run some skills first.[/dim]")
        return

    table = Table(title="Skill Metrics", show_header=True, header_style="bold cyan")
    table.add_column("Skill")
    table.add_column("Runs")
    table.add_column("Success Rate")
    table.add_column("Avg Duration")
    table.add_column("Avg Rating")
    table.add_column("Status")

    for m in all_metrics:
        sr_str = f"{m.success_rate:.0%}"
        dur_str = f"{m.avg_duration_s:.1f}s"
        rating_str = f"{m.avg_user_rating:.1f}/5" if m.avg_user_rating else "—"
        health = m.health_emoji
        status = f"[{health}]{health.upper()}[/{health}]"
        table.add_row(m.skill, str(m.total_executions), sr_str, dur_str, rating_str, status)

    console.print(table)


# ── feedback ───────────────────────────────────────────────────────────────────


@app.command()
def feedback(
    execution_id: str = typer.Argument(..., help="Execution ID shown after skill run"),
    rating: int = typer.Argument(..., help="Rating 1-5 (5 = excellent)"),
    notes: str = typer.Option("", "--notes", "-n"),
):
    """Rate a previous skill execution to improve future runs."""
    settings.ensure_jarvis_dirs()
    from self_improvement.feedback_loop import FeedbackLoop

    ok = FeedbackLoop().quick_feedback(execution_id, rating, notes)
    if ok:
        rprint(f"[green]Feedback recorded for execution {execution_id}. Thank you.[/green]")
    else:
        rprint(f"[yellow]Execution ID {execution_id} not found.[/yellow]")


# ── obsidian ───────────────────────────────────────────────────────────────────


@obsidian_app.command("sync-clients")
def obsidian_sync():
    """Create/update client profile notes in the vault from the registry."""
    vault = _vault()
    if not vault:
        rprint("[red]OBSIDIAN_VAULT_PATH not set or vault does not exist.[/red]")
        raise typer.Exit(1)

    from agents.obsidian_agent import ObsidianAgent

    with console.status("Syncing clients to vault..."):
        agent = ObsidianAgent(vault=vault, registry=_registry())
        result = agent.run("sync clients", action="sync_clients")

    rprint(f"[green]{result.output}[/green]" if result.success else f"[red]{result.error}[/red]")


@obsidian_app.command("dashboard")
def obsidian_dashboard():
    """Rebuild the weekly dashboard note in the vault."""
    _require_anthropic()
    vault = _vault()
    if not vault:
        rprint("[red]OBSIDIAN_VAULT_PATH not set or vault does not exist.[/red]")
        raise typer.Exit(1)

    from agents.obsidian_agent import ObsidianAgent

    with console.status("Building dashboard..."):
        agent = ObsidianAgent(vault=vault, registry=_registry())
        result = agent.run("build dashboard", action="dashboard")

    rprint(f"[green]{result.output}[/green]" if result.success else f"[red]{result.error}[/red]")


@obsidian_app.command("orphans")
def obsidian_orphans(folder: str = typer.Option("3-Resources/Research", "--folder")):
    """List research notes with no outbound wikilinks (orphan notes)."""
    vault = _vault()
    if not vault:
        rprint("[red]OBSIDIAN_VAULT_PATH not set.[/red]")
        raise typer.Exit(1)

    from agents.obsidian_agent import ObsidianAgent

    agent = ObsidianAgent(vault=vault)
    orphans = agent.find_orphan_notes(folder)

    if not orphans:
        rprint("[green]No orphan notes found.[/green]")
        return
    rprint(f"[yellow]{len(orphans)} orphan note(s) (no wikilinks):[/yellow]")
    for path in orphans:
        rprint(f"  [dim]{path}[/dim]")


# ── version / info ─────────────────────────────────────────────────────────────


@app.command()
def info():
    """Show Jarvis-Pro configuration status."""
    table = Table(title="Jarvis-Pro Status", show_header=False)
    table.add_column("Setting", style="bold")
    table.add_column("Status")

    def check(name, value, good_msg, bad_msg):
        status = f"[green]{good_msg}[/green]" if value else f"[red]{bad_msg}[/red]"
        table.add_row(name, status)

    check("Anthropic API", settings.has_anthropic, "configured", "NOT SET")
    check("Obsidian Vault", settings.has_vault, f"{settings.vault_path}", "not configured")
    check("Local Falcon", settings.has_local_falcon, "configured", "not configured")
    check("Brave Search", settings.has_brave_search, "configured", "not configured (using DuckDuckGo)")

    reg = _registry()
    table.add_row("Clients", f"{len(reg.list(active_only=True))} active")
    table.add_row("Default Model", settings.default_model)
    table.add_row("Research Model", settings.research_model)

    console.print(table)


if __name__ == "__main__":
    app()
