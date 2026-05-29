"""Enrich wide-release films with per-film BOM metadata.

Identifies films that hit ≥2000 theaters at peak (our wide-release threshold from the
agreed scope) and fetches their `/release/rl<id>/` pages to populate genre, MPAA,
runtime, release date, opening/widest theaters, and total grosses.

Skips films that already have an MPAA value (the cheap "have we enriched this?" flag),
unless --force is passed.
"""

from __future__ import annotations

from typing import Sequence

from rich.console import Console
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    TextColumn,
    TimeElapsedColumn,
)
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from marquee.db import session_scope
from marquee.fetch import Fetcher
from marquee.models import Film, Release, WeeklyGross
from marquee.parsers.box_office_mojo import film_url, parse_film_page

console = Console()

WIDE_PEAK_THEATERS = 2000


def _wide_film_bom_ids(session, *, only_missing: bool) -> Sequence[str]:
    """Return bom_ids for films whose peak theater count exceeded the wide threshold."""
    peak = (
        select(WeeklyGross.film_id, func.max(WeeklyGross.theaters).label("peak"))
        .group_by(WeeklyGross.film_id)
        .having(func.max(WeeklyGross.theaters) >= WIDE_PEAK_THEATERS)
        .subquery()
    )
    q = (
        select(Film.bom_id)
        .join(peak, peak.c.film_id == Film.id)
        .where(Film.bom_id.is_not(None))
    )
    if only_missing:
        q = q.where(Film.mpaa.is_(None))
    return [row[0] for row in session.execute(q).all()]


def scrape_bom_films(*, only_missing: bool = True, limit: int | None = None) -> dict:
    """Walk wide films, fetch their per-film page, persist metadata + totals."""
    with session_scope() as session:
        bom_ids = _wide_film_bom_ids(session, only_missing=only_missing)
    if limit:
        bom_ids = bom_ids[:limit]
    console.print(f"[cyan]Enriching {len(bom_ids)} wide-release films[/cyan]")

    n_ok = n_skip = n_fail = 0
    failures: list[tuple[str, str]] = []

    with Fetcher() as fetcher, Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("films", total=len(bom_ids))

        for bom_id in bom_ids:
            try:
                resp = fetcher.get(film_url(bom_id), namespace="bom_film")
                if resp.status == 404 or not resp.body:
                    n_skip += 1
                    progress.advance(task)
                    continue
                page = parse_film_page(resp.body, bom_id=bom_id)

                with session_scope() as session:
                    film = session.execute(
                        select(Film).where(Film.bom_id == bom_id)
                    ).scalar_one_or_none()
                    if film is None:
                        n_skip += 1
                        progress.advance(task)
                        continue

                    # Patch Film with whatever we got — never overwrite with None.
                    if page.title and not film.title:
                        film.title = page.title
                    if page.distributor:
                        film.distributor = page.distributor
                    if page.mpaa:
                        film.mpaa = page.mpaa
                    if page.runtime_minutes:
                        film.runtime_minutes = page.runtime_minutes
                    if page.genres:
                        film.genres = page.genres
                    if page.release_date and not film.release_date:
                        film.release_date = page.release_date

                    # Upsert the Release row.
                    if page.release_date:
                        stmt = pg_insert(Release).values(
                            film_id=film.id,
                            release_date=page.release_date,
                            peak_theaters=page.widest_release_theaters,
                            open_weekend_gross_usd=page.open_weekend_gross_usd,
                            total_domestic_gross_usd=page.total_domestic_gross_usd,
                            is_wide=(page.widest_release_theaters or 0) >= WIDE_PEAK_THEATERS,
                        )
                        stmt = stmt.on_conflict_do_update(
                            index_elements=["film_id", "release_date"],
                            set_={
                                "peak_theaters": stmt.excluded.peak_theaters,
                                "open_weekend_gross_usd": stmt.excluded.open_weekend_gross_usd,
                                "total_domestic_gross_usd": stmt.excluded.total_domestic_gross_usd,
                                "is_wide": stmt.excluded.is_wide,
                            },
                        )
                        session.execute(stmt)

                n_ok += 1
            except Exception as e:
                failures.append((bom_id, repr(e)[:200]))
                n_fail += 1
            progress.advance(task)

    summary = {
        "attempted": len(bom_ids),
        "enriched": n_ok,
        "skipped": n_skip,
        "failed": n_fail,
        "failures_preview": failures[:5],
    }
    console.print(summary)
    return summary
