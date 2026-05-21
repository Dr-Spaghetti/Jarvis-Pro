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
from core.registry import (
    Client,
    ClientBilling,
    ClientContact,
    CitationsConfig,
    ClientRegistry,
    GBPConfig,
    LocalFalconConfig,
    YextConfig,
)
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
    client_id = prompt("Client ID (slug)", default=suggested_id)
    industry = prompt("Industry (e.g. law-firm, home-services, medical)")
    business_type = prompt("Business type (e.g. Personal Injury Law Firm)")
    primary_keyword = prompt("Primary keyword (e.g. 'plumber las vegas')")

    console.print("\n[bold]Location[/bold]")
    city = prompt("City")
    state = prompt("State (2-letter)")
    website = prompt("Website URL")

    console.print("\n[bold]Keywords[/bold]")
    secondary_raw = prompt("Secondary keywords (comma-separated)", default="")
    secondary_keywords = [k.strip() for k in secondary_raw.split(",") if k.strip()]

    console.print("\n[bold]Contact[/bold]")
    contact_name = prompt("Contact name")
    contact_email = prompt("Contact email")
    contact_phone = prompt("Contact phone")

    console.print("\n[bold]Billing[/bold]")
    plan = prompt("Plan (retainer/monthly/project)", default="monthly")
    monthly_usd = float(prompt("Monthly USD", default="0") or "0")

    console.print("\n[bold]GBP[/bold]")
    gbp_url = prompt("GBP Profile URL")
    gbp_place_id = prompt("GBP Place ID (ChIJ...)")
    gbp_category = prompt("GBP Primary Category")

    console.print("\n[bold]Local Falcon[/bold]")
    lf_location_raw = prompt("Location ID(s) (comma-separated)", default="")
    lf_locations = [x.strip() for x in lf_location_raw.split(",") if x.strip()]
    lf_grid = prompt("Default grid", default="7x7")
    lf_radius = int(prompt("Default radius (miles)", default="5") or "5")

    console.print("\n[bold]Yext & Other Listings[/bold]")
    yext_id = prompt("Yext account ID")
    brightlocal_id = prompt("BrightLocal campaign ID")

    console.print("\n[bold]Citations[/bold]")
    citations_raw = prompt(
        "Target directories (comma-separated)",
        default="yelp,bbb,google",
    )
    citation_dirs = [d.strip() for d in citations_raw.split(",") if d.strip()]

    console.print("\n[bold]Tags & Notes[/bold]")
    tags_raw = prompt("Tags (comma-separated, e.g. 'legal,philadelphia')", default="")
    tags = [t.strip() for t in tags_raw.split(",") if t.strip()]
    notes = prompt("Notes")

    client = Client(
        id=client_id,
        name=name,
        industry=industry,
        business_type=business_type,
        primary_keyword=primary_keyword,
        secondary_keywords=secondary_keywords,
        city=city,
        state=state,
        website=website,
        tags=tags,
        notes=notes,
        billing=ClientBilling(plan=plan, monthly_usd=monthly_usd),
        contact=ClientContact(name=contact_name, email=contact_email, phone=contact_phone),
        gbp=GBPConfig(place_id=gbp_place_id, profile_url=gbp_url, primary_category=gbp_category),
        local_falcon=LocalFalconConfig(
            location_ids=lf_locations,
            default_grid=lf_grid,
            default_radius_miles=lf_radius,
        ),
        yext=YextConfig(account_id=yext_id, brightlocal_id=brightlocal_id),
        citations=CitationsConfig(target_directories=citation_dirs),
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

    if settings.has_vault:
        create_note = console.input("Create Obsidian client profile? [y/N]: ").strip().lower()
        if create_note == "y":
            try:
                from integrations.obsidian import ObsidianVault
                vault = ObsidianVault()
                path = vault.create_client_profile(client)
                rprint(f"[green]Obsidian profile created: {path}[/green]")
            except Exception as exc:
                rprint(f"[yellow]Could not create Obsidian profile: {exc}[/yellow]")

    rprint(f"\n[bold green]Done! Client '{name}' is ready.[/bold green]")
    rprint(f"\nNext steps:")
    rprint(f"  jarvis skill run citation-audit --clients {client_id}")
    rprint(f"  jarvis skill run gbp-monitor --clients {client_id}")
    rprint(f"  jarvis skill run keyword-hygiene --clients {client_id}")


if __name__ == "__main__":
    main()
