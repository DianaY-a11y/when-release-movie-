"""One-shot historical backfill — chains all the scrape jobs in order.

Pipeline:
  1. BOM weekend charts: 2015-01 → today (industry-wide weekly grosses + film stubs)
  2. BOM per-film pages for every wide release discovered in step 1
  3. TMDb + OMDB enrichment (skipped without keys; OMDB-only is fine)

Each step is independently idempotent — re-running skips already-completed work.
"""

from __future__ import annotations

from datetime import date

from rich.console import Console

from marquee.config import settings
from marquee.jobs.enrich import enrich_films
from marquee.jobs.scrape_bom_films import scrape_bom_films
from marquee.jobs.scrape_bom_weekends import scrape_bom_weekends

console = Console()


def run_backfill(*, years: int = 10, skip_bom: bool = False, skip_tmdb: bool = False) -> dict:
    today = date.today()
    start_year = today.year - years + 1

    results: dict = {}

    if not skip_bom:
        console.rule("[bold cyan]Step 1/3 — BOM weekend charts")
        results["bom_weekends"] = scrape_bom_weekends(start_year=start_year, start_week=1)

        console.rule("[bold cyan]Step 2/3 — BOM per-film pages")
        results["bom_films"] = scrape_bom_films(only_missing=True)
    else:
        console.print("[yellow]skipping BOM steps[/yellow]")

    console.rule("[bold cyan]Step 3/3 — TMDb + OMDB enrichment")
    if not settings.tmdb_api_key and not settings.omdb_api_key:
        console.print("[yellow]Both TMDB_API_KEY and OMDB_API_KEY are empty — skipping enrichment.[/yellow]")
        results["enrichment"] = {"skipped": True}
    elif skip_tmdb and not settings.omdb_api_key:
        results["enrichment"] = {"skipped": True}
    else:
        results["enrichment"] = enrich_films(only_missing=True)

    console.print(results)
    return results
