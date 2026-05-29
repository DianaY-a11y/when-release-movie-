"""Batch-tag films from the fixed tag vocabularies via Claude.

Cost shape (Haiku 4.5, ~7k films):
  - System prompt + vocab cached → ~3000 tokens, 5-min TTL. Caching gives ~90% input discount.
  - Per-call user payload: ~150 input tokens, ~80 output tokens.
  - Estimate: ~$1 total across the corpus.

Why per-film (not batched per call): keeps the response shape trivially parseable and
avoids re-prompting the entire batch on a single parse failure. Concurrency=8 keeps
throughput high without tripping rate limits.

Output: writes `film_tags` JSON to `data/film_tags.json` keyed by film_id.
"""

from __future__ import annotations

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

import anthropic
from rich.console import Console
from rich.progress import Progress
from sqlalchemy import select

from marquee.analysis.tag_vocab import AUDIENCE_TAGS, GENRE_TAGS
from marquee.config import settings
from marquee.db import session_scope
from marquee.models import Film, ForwardSchedule, Release, WeeklyGross

console = Console()

MODEL = "claude-haiku-4-5-20251001"
MAX_CONCURRENCY = 8

SYSTEM_PROMPT = f"""You are a film-marketing analyst tagging films from a fixed vocabulary.

You will receive one film's metadata and must return ONLY a JSON object of the form:
{{"genre_tags": [...], "audience_tags": [...]}}

Pick ALL tags that apply. Be inclusive when uncertain (a slasher film can be both
"slasher" and "supernatural-horror" if it features a supernatural killer). Pick 2-6
genre tags and 2-5 audience tags per film. Do not invent tags — only use tags from
the closed vocabularies below.

GENRE TAGS (closed vocabulary):
{json.dumps(GENRE_TAGS)}

AUDIENCE TAGS (closed vocabulary):
{json.dumps(AUDIENCE_TAGS)}

Return only the JSON object, no preamble, no markdown fences."""


@dataclass
class FilmForTagging:
    film_id: int
    title: str
    year: int | None
    distributor: str | None
    synopsis: str | None
    bom_genres: list[str] | None


def _films_to_tag(only_missing_set: set[int]) -> list[FilmForTagging]:
    """Pull the set of films that we want tagged.

    Priority pool (everything in the product surface):
      - forward_schedule films (~400)
      - films in Release table (theatrical-tracked, ~1100)
      - films appearing in any WeeklyGross row (~all 6929 via the join, but Release
        is a superset for our purposes)

    We use Release ∪ ForwardSchedule for v1 — covers everything the UI needs.
    """
    with session_scope() as session:
        # Any film that appears in weekly_grosses (i.e. ever played theatrically in our window)
        weekly_film_ids = set(
            r[0] for r in session.execute(select(WeeklyGross.film_id).distinct()).all()
        )
        fwd_film_ids = set(
            r[0]
            for r in session.execute(
                select(ForwardSchedule.film_id).where(ForwardSchedule.film_id.is_not(None)).distinct()
            ).all()
        )
        target_ids = (weekly_film_ids | fwd_film_ids) - only_missing_set

        if not target_ids:
            return []

        rows = session.execute(
            select(
                Film.id,
                Film.title,
                Film.release_date,
                Film.distributor,
                Film.synopsis,
                Film.genres,
            ).where(Film.id.in_(target_ids))
        ).all()

    out: list[FilmForTagging] = []
    for fid, title, rdate, distributor, synopsis, genres in rows:
        out.append(
            FilmForTagging(
                film_id=fid,
                title=title,
                year=rdate.year if rdate else None,
                distributor=distributor,
                synopsis=synopsis,
                bom_genres=list(genres) if genres else None,
            )
        )
    return out


def _user_payload(film: FilmForTagging) -> str:
    parts = [f"Title: {film.title}"]
    if film.year:
        parts.append(f"Year: {film.year}")
    if film.distributor:
        parts.append(f"Distributor: {film.distributor}")
    if film.bom_genres:
        parts.append(f"BOM genres: {', '.join(film.bom_genres)}")
    if film.synopsis:
        # Cap synopsis length to keep tokens tight
        parts.append(f"Synopsis: {film.synopsis[:600]}")
    return "\n".join(parts)


def _tag_one(client: anthropic.Anthropic, film: FilmForTagging) -> dict:
    """Single-film tag call. Returns {"film_id", "genre_tags", "audience_tags", "error"?}."""
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=400,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": _user_payload(film)}],
        )
        text = "".join(block.text for block in resp.content if hasattr(block, "text"))
        # Strip any accidental markdown fences. The opening fence line (``` or ```json)
        # is dropped whole, so there's no need to strip a leading "json" token — doing so
        # with str.lstrip would wrongly peel any leading j/s/o/n characters off the body.
        text = text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else ""
            if text.rstrip().endswith("```"):
                text = text.rstrip()[:-3]
            text = text.strip()
        data = json.loads(text)
        return {
            "film_id": film.film_id,
            "genre_tags": [t for t in data.get("genre_tags", []) if t in GENRE_TAGS],
            "audience_tags": [t for t in data.get("audience_tags", []) if t in AUDIENCE_TAGS],
        }
    except Exception as e:
        return {"film_id": film.film_id, "error": str(e)[:200]}


def tag_films(
    out_path: str = "data/film_tags.json",
    only_missing: bool = True,
    limit: int | None = None,
) -> dict:
    """Tag films and write the result to JSON.

    If `only_missing=True`, films already in the output JSON are skipped (resumable).
    """
    existing: dict[str, dict] = {}
    if only_missing and os.path.exists(out_path):
        try:
            existing = json.load(open(out_path))
            console.print(f"[dim]resuming: {len(existing)} films already tagged[/dim]")
        except Exception:
            existing = {}

    already = {int(k) for k in existing.keys()}
    films = _films_to_tag(only_missing_set=already)
    if limit:
        films = films[:limit]
    console.print(f"tagging {len(films)} films (model={MODEL}, concurrency={MAX_CONCURRENCY})")

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    results = dict(existing)  # preserve existing

    save_every = 50
    n_done = 0

    with Progress() as progress:
        task = progress.add_task("tagging", total=len(films))
        with ThreadPoolExecutor(max_workers=MAX_CONCURRENCY) as ex:
            futures = {ex.submit(_tag_one, client, f): f for f in films}
            for fut in as_completed(futures):
                r = fut.result()
                results[str(r["film_id"])] = r
                n_done += 1
                progress.advance(task)
                if n_done % save_every == 0:
                    _save(results, out_path)

    _save(results, out_path)
    errors = sum(1 for r in results.values() if "error" in r)
    return {
        "total": len(results),
        "errors": errors,
        "path": out_path,
    }


def _save(results: dict, out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(results, f)
    os.replace(tmp, out_path)
