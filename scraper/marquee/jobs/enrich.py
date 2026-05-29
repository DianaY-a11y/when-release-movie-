"""TMDb + OMDB enrichment for films.

Priority of overlapping fields (genres, MPAA, runtime):
  TMDb  (structured, multilingual) >
  OMDB  (IMDb-backed, reliable for US wide releases) >
  BOM per-film page (already populated by scrape_bom_films)

OMDB gives us the uniquely useful RT/Metacritic scores; TMDb gives us synopsis,
cast, director, production budget, and poster — needed for the cannibalization model.

When TMDB_API_KEY is unset, the job runs OMDB-only and skips TMDb fields.
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
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from marquee.config import settings
from marquee.db import session_scope
from marquee.fetch import Fetcher
from marquee.models import Film, Review
from marquee.parsers.omdb import OMDBClient, OMDBRecord
from marquee.parsers.tmdb import TMDbClient, TMDbRecord

console = Console()


def _release_year(film: Film) -> int | None:
    return film.release_date.year if film.release_date else None


def _apply_tmdb(film: Film, rec: TMDbRecord) -> None:
    if not film.tmdb_id:
        film.tmdb_id = rec.tmdb_id
    if rec.imdb_id and not film.imdb_id:
        film.imdb_id = rec.imdb_id
    if rec.overview and not film.synopsis:
        film.synopsis = rec.overview
    if rec.director and not film.director:
        film.director = rec.director
    if rec.top_cast and not film.top_cast:
        film.top_cast = rec.top_cast
    if rec.budget and not film.production_budget_usd:
        film.production_budget_usd = rec.budget
    if rec.poster_url and not film.poster_url:
        film.poster_url = rec.poster_url
    if rec.belongs_to_collection and film.is_franchise is None:
        film.is_franchise = True
    if rec.genres and not film.genres:
        film.genres = rec.genres
    if rec.runtime and not film.runtime_minutes:
        film.runtime_minutes = rec.runtime


def _apply_omdb(film: Film, rec: OMDBRecord) -> None:
    if rec.imdb_id and not film.imdb_id:
        film.imdb_id = rec.imdb_id
    if rec.rated and not film.mpaa:
        film.mpaa = rec.rated
    if rec.runtime_minutes and not film.runtime_minutes:
        film.runtime_minutes = rec.runtime_minutes
    if rec.genres and not film.genres:
        film.genres = rec.genres
    if rec.director and not film.director:
        film.director = rec.director
    if rec.actors and not film.top_cast:
        film.top_cast = rec.actors[:5]
    if rec.plot and not film.synopsis:
        film.synopsis = rec.plot
    if rec.poster_url and not film.poster_url:
        film.poster_url = rec.poster_url
    if rec.box_office_usd and not film.production_budget_usd:
        # OMDB's BoxOffice is actually domestic gross, not budget — skip mapping to budget.
        pass


def _upsert_review(session, film_id: int, rec: OMDBRecord) -> None:
    if rec.rt_critic is None and rec.metacritic is None and rec.imdb_rating is None:
        return
    stmt = pg_insert(Review).values(
        film_id=film_id,
        rt_critic=rec.rt_critic,
        metacritic=rec.metacritic,
        imdb_rating=rec.imdb_rating,
        imdb_votes=rec.imdb_votes,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["film_id"],
        set_={
            "rt_critic": stmt.excluded.rt_critic,
            "metacritic": stmt.excluded.metacritic,
            "imdb_rating": stmt.excluded.imdb_rating,
            "imdb_votes": stmt.excluded.imdb_votes,
        },
    )
    session.execute(stmt)


def enrich_films(*, only_missing: bool = True, limit: int | None = None) -> dict:
    """Walk films lacking synopsis (or all if only_missing=False) and enrich via TMDb+OMDB."""
    tmdb_enabled = bool(settings.tmdb_api_key)
    omdb_enabled = bool(settings.omdb_api_key)
    if not (tmdb_enabled or omdb_enabled):
        raise RuntimeError("Neither TMDB_API_KEY nor OMDB_API_KEY is configured.")

    with session_scope() as session:
        q = select(Film.id)
        if only_missing:
            q = q.where(Film.synopsis.is_(None))
        ids = [row[0] for row in session.execute(q).all()]
    if limit:
        ids = ids[:limit]
    console.print(
        f"[cyan]Enriching {len(ids)} films[/cyan]  "
        f"(TMDb={'on' if tmdb_enabled else 'off'}, OMDB={'on' if omdb_enabled else 'off'})"
    )

    n_tmdb = n_omdb = n_review = n_fail = 0

    with Fetcher() as fetcher, Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        tmdb = TMDbClient(fetcher) if tmdb_enabled else None
        omdb = OMDBClient(fetcher) if omdb_enabled else None

        task = progress.add_task("films", total=len(ids))

        for film_id in ids:
            try:
                with session_scope() as session:
                    film = session.get(Film, film_id)
                    if not film or not film.title:
                        progress.advance(task)
                        continue
                    year = _release_year(film)

                    # 1. TMDb — prefer find_by_imdb when we already have the ID; else search.
                    tmdb_rec: TMDbRecord | None = None
                    if tmdb is not None:
                        if film.imdb_id:
                            tmdb_rec = tmdb.find_by_imdb(film.imdb_id)
                        if tmdb_rec is None:
                            results = tmdb.search_movie(film.title, year=year)
                            if results:
                                tmdb_rec = tmdb.get_movie(results[0]["id"])
                        if tmdb_rec:
                            _apply_tmdb(film, tmdb_rec)
                            n_tmdb += 1

                    # 2. OMDB — by imdb_id (which TMDb may have just supplied), else by title+year.
                    omdb_rec: OMDBRecord | None = None
                    if omdb is not None:
                        if film.imdb_id:
                            omdb_rec = omdb.by_imdb(film.imdb_id)
                        if omdb_rec is None:
                            omdb_rec = omdb.by_title(film.title, year=year)
                        if omdb_rec:
                            _apply_omdb(film, omdb_rec)
                            n_omdb += 1
                            _upsert_review(session, film.id, omdb_rec)
                            n_review += 1
            except Exception as e:
                n_fail += 1
                console.print(f"[red]✗ {film_id}: {e}[/red]")
            progress.advance(task)

    summary = {
        "attempted": len(ids),
        "tmdb_hits": n_tmdb,
        "omdb_hits": n_omdb,
        "reviews_upserted": n_review,
        "failures": n_fail,
    }
    console.print(summary)
    return summary
