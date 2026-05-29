"""Enrich forward_schedule rows via OMDB title+year lookup.

For each forward release that doesn't yet have a linked Film row:
  - Search OMDB by title + release year
  - If found, get/create the Film by imdb_id
  - Apply OMDB metadata (genres, MPAA, runtime, plot, poster, IMDb rating)
  - Update forward_schedule.film_id

Idempotent: re-running only touches rows still missing a film_id.
"""

from __future__ import annotations

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

from marquee.config import settings
from marquee.db import session_scope
from marquee.fetch import Fetcher
from marquee.jobs.enrich import _apply_omdb, _upsert_review
from marquee.models import Film, ForwardSchedule
from marquee.parsers.omdb import OMDBClient
from marquee.util import normalize_title

console = Console()


def _get_or_create_film(session, *, omdb_rec, fwd: ForwardSchedule) -> Film:
    """Find or create a Film, deduping by IMDb ID first then normalized title + year.

    OMDB occasionally returns no IMDb ID. Matching on imdb_id alone then means every
    such row creates a brand-new Film — a NULL imdb_id never trips the unique
    constraint — so the same movie can be inserted repeatedly across reruns. Fall back
    to (title_normalized, release year) so those rows still dedup.
    """
    film = None
    norm = normalize_title(omdb_rec.title or fwd.title)
    if omdb_rec.imdb_id:
        film = session.execute(
            select(Film).where(Film.imdb_id == omdb_rec.imdb_id)
        ).scalar_one_or_none()
    if film is None and norm:
        cand = select(Film).where(Film.title_normalized == norm)
        if fwd.release_date is not None:
            cand = cand.where(
                func.extract("year", Film.release_date) == fwd.release_date.year
            )
        # .first() (not scalar_one_or_none) so a rare same-title/same-year collision
        # reuses an existing row instead of raising.
        film = session.execute(cand).scalars().first()
    if film is None:
        film = Film(
            imdb_id=omdb_rec.imdb_id,
            title=omdb_rec.title or fwd.title,
            title_normalized=norm,
            distributor=fwd.distributor,
            release_date=fwd.release_date,
        )
        session.add(film)
        session.flush()
    elif omdb_rec.imdb_id and not film.imdb_id:
        # Matched by title but now have an IMDb id — backfill it.
        film.imdb_id = omdb_rec.imdb_id
    _apply_omdb(film, omdb_rec)
    return film


def enrich_forward_schedule(*, only_missing: bool = True, limit: int | None = None) -> dict:
    """Walk forward_schedule rows lacking film_id and enrich via OMDB title+year."""
    if not settings.omdb_api_key:
        raise RuntimeError("OMDB_API_KEY not configured")

    with session_scope() as session:
        q = select(ForwardSchedule).where(ForwardSchedule.is_scheduled.is_(True))
        if only_missing:
            q = q.where(ForwardSchedule.film_id.is_(None))
        q = q.order_by(ForwardSchedule.release_date)
        rows: list[ForwardSchedule] = list(session.execute(q).scalars())
    if limit:
        rows = rows[:limit]
    console.print(f"[cyan]Enriching {len(rows)} forward releases via OMDB[/cyan]")

    n_matched = n_unmatched = n_fail = 0
    with Fetcher() as fetcher, Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        omdb = OMDBClient(fetcher)
        task = progress.add_task("forward", total=len(rows))

        for fwd in rows:
            try:
                year = fwd.release_date.year if fwd.release_date else None
                rec = omdb.by_title(fwd.title, year=year)
                # Fallback: try without year (some films missing from OMDB by year)
                if rec is None and year is not None:
                    rec = omdb.by_title(fwd.title)
                if rec is None:
                    n_unmatched += 1
                    progress.advance(task)
                    continue

                with session_scope() as session:
                    fresh = session.get(ForwardSchedule, fwd.id)
                    if fresh is None:
                        progress.advance(task)
                        continue
                    film = _get_or_create_film(session, omdb_rec=rec, fwd=fresh)
                    fresh.film_id = film.id
                    _upsert_review(session, film.id, rec)
                n_matched += 1
            except Exception as e:
                console.print(f"[red]✗ {fwd.title}: {e}[/red]")
                n_fail += 1
            progress.advance(task)

    summary = {
        "attempted": len(rows),
        "matched": n_matched,
        "unmatched": n_unmatched,
        "failed": n_fail,
    }
    console.print(summary)
    return summary
