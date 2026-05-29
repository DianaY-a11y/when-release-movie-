"""Walk BOM weekend charts from a start date to today and persist.

For each weekend:
  - Upsert/find film stub by bom_id (full enrichment later via per-film + TMDb)
  - Upsert weekly_grosses row (film_id, weekend_start) with ON CONFLICT
  - Upsert weekend_charts aggregate row (industry totals derived from chart)

Idempotent: re-running re-uses the on-disk HTML cache and content_hash-style upserts
on natural keys, so it can be Ctrl-C'd and resumed without dupes.
"""

from __future__ import annotations

from datetime import date, timedelta

from rich.console import Console
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    TextColumn,
    TimeElapsedColumn,
)
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from marquee.db import session_scope
from marquee.fetch import Fetcher
from marquee.models import Film, WeekendChart, WeeklyGross
from marquee.parsers.box_office_mojo import (
    iter_weekend_weeks,
    parse_weekend_page,
    weekend_url,
)
from marquee.util import normalize_title

console = Console()


def _upsert_film_stub(session, bom_id: str, title: str, distributor: str | None) -> Film:
    """Get-or-create a Film by bom_id. Full enrichment happens later."""
    film = session.execute(select(Film).where(Film.bom_id == bom_id)).scalar_one_or_none()
    if film is None:
        film = Film(
            bom_id=bom_id,
            title=title,
            title_normalized=normalize_title(title),
            distributor=distributor,
        )
        session.add(film)
        session.flush()
    else:
        # Backfill missing distributor / title if we now have them
        if not film.distributor and distributor:
            film.distributor = distributor
    return film


def _upsert_weekly_gross(session, *, film_id: int, weekend_start: date, row) -> None:
    """Upsert weekly_grosses row keyed on (film_id, weekend_start)."""
    stmt = pg_insert(WeeklyGross).values(
        film_id=film_id,
        weekend_start=weekend_start,
        week_number=row.weeks_in_release or 1,
        gross_usd=row.gross_usd,
        theaters=row.theaters,
        rank=row.rank,
        pct_change_vs_prev=row.pct_change_vs_prev,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["film_id", "weekend_start"],
        set_={
            "gross_usd": stmt.excluded.gross_usd,
            "theaters": stmt.excluded.theaters,
            "rank": stmt.excluded.rank,
            "pct_change_vs_prev": stmt.excluded.pct_change_vs_prev,
            "week_number": stmt.excluded.week_number,
        },
    )
    session.execute(stmt)


def _upsert_weekend_chart(session, *, weekend_start: date, iso_year: int, iso_week: int, rows: list) -> None:
    """Aggregate industry-level stats for the weekend."""
    total = sum((r.gross_usd or 0) for r in rows)
    top = max((r.gross_usd or 0) for r in rows) if rows else 0
    num_openers = sum(1 for r in rows if r.is_new_this_week)

    stmt = pg_insert(WeekendChart).values(
        weekend_start=weekend_start,
        iso_year=iso_year,
        iso_week=iso_week,
        total_industry_gross_usd=total,
        top_film_gross_usd=top,
        num_wide_openers=num_openers,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["weekend_start"],
        set_={
            "iso_year": stmt.excluded.iso_year,
            "iso_week": stmt.excluded.iso_week,
            "total_industry_gross_usd": stmt.excluded.total_industry_gross_usd,
            "top_film_gross_usd": stmt.excluded.top_film_gross_usd,
            "num_wide_openers": stmt.excluded.num_wide_openers,
        },
    )
    session.execute(stmt)


def scrape_bom_weekends(*, start_year: int = 2015, start_week: int = 1, end_date: date | None = None) -> dict:
    """Walk weekends, fetch + parse + persist. Returns summary stats."""
    end_date = end_date or date.today()
    weeks = list(iter_weekend_weeks(start_year, start_week, end_date))
    console.print(f"[cyan]Scraping {len(weeks)} weekends[/cyan] from {start_year}W{start_week:02d} → {end_date}")

    n_fetched = n_cached = n_rows = n_films = 0
    failures: list[tuple[int, int, str]] = []

    with Fetcher() as fetcher, Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("weekends", total=len(weeks))

        for iso_year, iso_week in weeks:
            url = weekend_url(iso_year, iso_week)
            try:
                resp = fetcher.get(url, namespace="bom_weekend")
            except Exception as e:
                failures.append((iso_year, iso_week, str(e)))
                progress.advance(task)
                continue

            if resp.from_cache:
                n_cached += 1
            else:
                n_fetched += 1

            if resp.status == 404 or not resp.body:
                progress.advance(task)
                continue

            page = parse_weekend_page(resp.body, iso_year=iso_year, iso_week=iso_week)

            with session_scope() as session:
                for row in page.rows:
                    if not row.bom_id or not row.title:
                        continue
                    film = _upsert_film_stub(session, row.bom_id, row.title, row.distributor)
                    _upsert_weekly_gross(
                        session,
                        film_id=film.id,
                        weekend_start=page.weekend_start,
                        row=row,
                    )
                    n_rows += 1
                _upsert_weekend_chart(
                    session,
                    weekend_start=page.weekend_start,
                    iso_year=iso_year,
                    iso_week=iso_week,
                    rows=page.rows,
                )

            progress.advance(task)

    from sqlalchemy import func as f
    with session_scope() as session:
        n_films = session.scalar(select(f.count(Film.id))) or 0

    # Refresh derived run_week_number after the scrape so re-releases get clean week=1.
    from marquee.analysis.derive_runs import derive_run_week_numbers
    derive_run_week_numbers()

    summary = {
        "weekends_total": len(weeks),
        "weekends_fetched_live": n_fetched,
        "weekends_from_cache": n_cached,
        "weekly_rows_upserted": n_rows,
        "distinct_films": n_films,
        "failures": failures,
    }
    console.print(summary)
    return summary
