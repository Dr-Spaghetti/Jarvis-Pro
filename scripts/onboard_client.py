"""
Interactive client onboarding script.

Walks through all fields, validates input, optionally creates the Obsidian
client profile, and prints a summary.

Usage: python scripts/onboard_client.py
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.config import settings
from core.registry import Client, ClientContact, ClientIntegrations, ClientRegistry
from rich import print as rprint
from rich.console import Console
from rich.panel import Panel

console = Console()


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def prompt(label: str, default: str = "", required: bool = False) -> str:
    while True:
        val = console.input(f"  [cyan]{label}[/cyan]{f' [{default}]' if default else ''}: ").strip()
        if not val:
            val = default
        if required and not val:
            rprint("  [red]This field is required.[/red]")
            continue
        return val


def main():
    console.print(Panel("[bold cyan]Jarvis-Pro Client Onboarding[/bold cyan]", expand=False))
    console.print()

    name = prompt("Business name", required=True)
    suggested_id = slugify(name)
    client_id = prompt(f"Client ID (slug)", default=suggested_id)
    business_type = prompt("Business type (e.g. Personal Injury Law Firm)")
    primary_keyword = prompt("Primary keyword (e.g. 'plumber las vegas')")

    console.print("\n[bold]Location[/bold]")
    city = prompt("City")
    state = prompt("State (2-letter)")
    website = prompt("Website URL")

    console.print("\n[bold]Keywords[/bold]")
    secondary_kws_raw = prompt("Secondary keywords (comma-separated)", default="")
    secondary_keywords = [k.strip() for k in secondary_kws_raw.split(",") if k.strip()]

    console.print("\n[bold]Contact[/bold]")
    contact_name = prompt("Contact name")
    contact_email = prompt("Contact email")
    contact_phone = prompt("Contact phone")

    console.print("\n[bold]Integrations[/bold]")
    gbp_url = prompt("GBP URL (Google Business Profile)")
    gbp_cid = prompt("GBP CID (numeric ID)")
    local_falcon_id = prompt("Local Falcon location ID")
    yext_id = prompt("Yext account ID")
    brightlocal_id = prompt("BrightLocal campaign ID")

    console.print("\n[bold]Notes[/bold]")
    notes = prompt("Any notes about this client")

    console.print("\n[bold]Tags[/bold] (comma-separated, e.g. 'legal,philadelphia')")
    tags_raw = prompt("Tags", default="")
    tags = [t.strip() for t in tags_raw.split(",") if t.strip()]

    client = Client(
        id=client_id,
        name=name,
        business_type=business_type,
        primary_keyword=primary_keyword,
        secondary_keywords=secondary_keywords,
        city=city,
        state=state,
        website=website,
        tags=tags,
        notes=notes,
        contact=ClientContact(name=contact_name, email=contact_email, phone=contact_phone),
        integrations=ClientIntegrations(
            gbp_url=gbp_url,
            gbp_cid=gbp_cid,
            local_falcon_id=local_falcon_id,
            yext_account_id=yext_id,
            brightlocal_id=brightlocal_id,
        ),
    )

    console.print("\n[bold]Summary[/bold]")
    console.print(Panel(client.to_context_string()))

    confirm = console.input("\n[bold]Save this client? [y/N]: [/bold]").strip().lower()
    if confirm != "y":
        rprint("[yellow]Cancelled.[/yellow]")
        return

    reg = ClientRegistry()
    try:
        reg.add(client)
        rprint(f"[green]Client '{name}' added to registry.[/green]")
    except ValueError as e:
        rprint(f"[red]Error: {e}[/red]")
        return

    # Optionally create Obsidian profile
    if settings.has_vault:
        create_note = console.input(
            "Create Obsidian client profile? [y/N]: "
        ).strip().lower()
        if create_note == "y":
            try:
                from integrations.obsidian import ObsidianVault
                vault = ObsidianVault()
                path = vault.create_client_profile(client)
                rprint(f"[green]Obsidian profile created: {path}[/green]")
            except Exception as exc:
                rprint(f"[yellow]Could not create Obsidian profile: {exc}[/yellow]")

    rprint(f"\n[bold green]Done! Client '{name}' is ready.[/bold green]")
    rprint(f"Next steps:")
    rprint(f"  jarvis skill run citation-audit --clients {client_id}")
    rprint(f"  jarvis skill run gbp-monitor --clients {client_id}")


if __name__ == "__main__":
    main()
