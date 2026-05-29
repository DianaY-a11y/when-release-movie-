"""Marquee scraper CLI.

    marquee db init           — create tables
    marquee backfill          — one-shot historical (run locally)
    marquee refresh           — forward schedule (cron-callable, idempotent)
"""

from __future__ import annotations

import click
from rich.console import Console

from marquee.db import init_schema

console = Console()


@click.group()
def main() -> None:
    """Marquee data pipeline."""


@main.group()
def db() -> None:
    """Database management."""


@db.command("init")
def db_init() -> None:
    """Create all tables (idempotent — uses CREATE IF NOT EXISTS)."""
    init_schema()
    console.print("[green]✓[/green] Schema initialized.")


@main.command("backfill")
@click.option("--years", default=10, show_default=True, help="Years of history to pull.")
@click.option("--skip-bom", is_flag=True, help="Skip BOM (use cached only).")
@click.option("--skip-tmdb", is_flag=True, help="Skip TMDb enrichment.")
def backfill(years: int, skip_bom: bool, skip_tmdb: bool) -> None:
    """Run the full historical backfill (BOM weekend charts → per-film → TMDb → OMDB)."""
    from marquee.jobs.backfill import run_backfill

    run_backfill(years=years, skip_bom=skip_bom, skip_tmdb=skip_tmdb)


@main.command("scrape-bom-weekends")
@click.option("--start-year", default=2015, show_default=True)
@click.option("--start-week", default=1, show_default=True)
def scrape_bom_weekends_cmd(start_year: int, start_week: int) -> None:
    """Scrape BOM weekend charts from start through today."""
    from marquee.jobs.scrape_bom_weekends import scrape_bom_weekends

    scrape_bom_weekends(start_year=start_year, start_week=start_week)


@main.command("scrape-bom-films")
@click.option("--force", is_flag=True, help="Re-enrich films that already have MPAA.")
@click.option("--limit", type=int, default=None, help="Cap the number of films (for testing).")
def scrape_bom_films_cmd(force: bool, limit: int | None) -> None:
    """Enrich wide-release films with per-film BOM metadata (genre, MPAA, runtime, totals)."""
    from marquee.jobs.scrape_bom_films import scrape_bom_films

    scrape_bom_films(only_missing=not force, limit=limit)


@main.command("enrich")
@click.option("--force", is_flag=True, help="Re-enrich films that already have a synopsis.")
@click.option("--limit", type=int, default=None, help="Cap films (for testing).")
def enrich_cmd(force: bool, limit: int | None) -> None:
    """Enrich films with TMDb (synopsis/cast/poster) + OMDB (RT/Metacritic)."""
    from marquee.jobs.enrich import enrich_films

    enrich_films(only_missing=not force, limit=limit)


@main.command("enrich-forward")
@click.option("--force", is_flag=True, help="Re-enrich forward rows that already have a film_id.")
@click.option("--limit", type=int, default=None, help="Cap entries (for testing).")
def enrich_forward_cmd(force: bool, limit: int | None) -> None:
    """Enrich forward_schedule rows via OMDB title+year. Creates/links Film rows."""
    from marquee.jobs.enrich_forward import enrich_forward_schedule

    enrich_forward_schedule(only_missing=not force, limit=limit)


@main.group()
def analyze() -> None:
    """Analysis layer — derive insights from the scraped data."""


@analyze.command("weekly")
@click.option("--out", default="data/weekly.json", show_default=True, help="JSON output path.")
def analyze_weekly_cmd(out: str) -> None:
    """Compute by-ISO-week historical performance + dump JSON for the frontend."""
    import os
    from marquee.analysis.weekly import write_weekly_json

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    result = write_weekly_json(out)
    console.print(result)


@analyze.command("sources")
def analyze_sources_cmd() -> None:
    """Dev EDA: dump cardinality + distributions of every scraped table.

    Run this after each backfill to spot convention surprises before they become user bugs.
    """
    from marquee.analysis.sources import run_sources_audit

    run_sources_audit()


@analyze.command("derive-runs")
def analyze_derive_runs_cmd() -> None:
    """Populate weekly_grosses.run_week_number — within-this-release-run week counter.

    BOM's raw `week_number` counts total release-history weeks across all-time, so re-releases
    (e.g. Jaws 2024 re-release shows BOM week_number = 2,585). This derivation resets to 1
    on each new chart run, which is what decay-curve modeling needs.
    """
    from marquee.analysis.derive_runs import derive_run_week_numbers

    result = derive_run_week_numbers()
    console.print(result)


@main.command("refresh")
def refresh() -> None:
    """Refresh the forward release schedule. Idempotent; safe to call concurrently."""
    from marquee.jobs.refresh import run_refresh

    run_refresh()


if __name__ == "__main__":
    main()
