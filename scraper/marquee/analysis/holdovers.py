"""Per-tier decay curves for projecting holdovers forward into future weekends.

For each tier (industry-tentpole, industry-midrange, indie/prestige, plus genre buckets
horror/family/drama if we can resolve a film into them), we fit a *retention curve*:

    retention[k] = median across films of (week_k_gross / opening_weekend_gross)

So if `retention[3] = 0.18`, a typical mid-tier film holds 18% of its opening in week 3.
The calendar UI uses these curves to project today's scheduled films forward into
target weekends.

We use medians (not means) because tentpole runaways like The Greatest Showman would
otherwise pull the average up by 5-10x.
"""

from __future__ import annotations

import statistics
from collections import defaultdict

from sqlalchemy import select

from marquee.analysis.weekly import INDIE_DISTRIBUTOR_TOKENS, DEFAULT_EXCLUDED_YEARS
from marquee.db import session_scope
from marquee.models import Film, WeeklyGross

# Tier classification — same as legs.py but extended with genre buckets.
HORROR_KEYWORDS = ("horror",)
FAMILY_KEYWORDS = ("family", "animation", "kids")
DRAMA_KEYWORDS = ("drama",)

MAX_DECAY_WEEKS = 12  # most theatrical runs are spent by week 12


def _film_buckets(distributor: str | None, genres: list[str] | None) -> list[str]:
    """Return all buckets this film contributes to (one film can populate multiple)."""
    buckets: list[str] = []
    d = (distributor or "").lower()
    is_indie = any(tok.lower() in d for tok in INDIE_DISTRIBUTOR_TOKENS)
    buckets.append("indie" if is_indie else "industry")

    genre_lower = " ".join(g.lower() for g in (genres or []))
    if any(k in genre_lower for k in HORROR_KEYWORDS):
        buckets.append("horror")
    if any(k in genre_lower for k in FAMILY_KEYWORDS):
        buckets.append("family")
    if any(k in genre_lower for k in DRAMA_KEYWORDS):
        buckets.append("drama")
    return buckets


def compute_decay_curves(
    excluded_years: frozenset[int] = DEFAULT_EXCLUDED_YEARS,
    max_weeks: int = MAX_DECAY_WEEKS,
) -> dict[str, dict]:
    """Compute median retention curve per bucket.

    Returns: {bucket_name: {"retention": [r1=1.0, r2, r3, ...], "n_films": N}}
    """
    with session_scope() as session:
        # Pull every (film_id → weekly grosses by run_week_number)
        # Plus the film's distributor + genres for bucketing.
        q = (
            select(
                WeeklyGross.film_id,
                WeeklyGross.run_week_number,
                WeeklyGross.gross_usd,
                WeeklyGross.weekend_start,
                Film.distributor,
                Film.genres,
            )
            .join(Film, Film.id == WeeklyGross.film_id)
            .where(WeeklyGross.run_week_number.is_not(None))
            .where(WeeklyGross.gross_usd.is_not(None))
        )
        rows = session.execute(q).all()

    # First gather per-film {week_n: gross}, filtering out excluded years on the *opener week*
    per_film_grosses: dict[int, dict[int, int]] = defaultdict(dict)
    per_film_open_year: dict[int, int] = {}
    per_film_meta: dict[int, tuple[str | None, list[str] | None]] = {}

    for film_id, rwn, gross, weekend_start, distributor, genres in rows:
        if rwn is None:
            continue
        per_film_grosses[film_id][rwn] = int(gross)
        per_film_meta[film_id] = (distributor, list(genres) if genres else None)
        if rwn == 1:
            per_film_open_year[film_id] = weekend_start.year

    # Per-bucket: list of retention vectors. Compute medians at the end.
    bucket_vectors: dict[str, dict[int, list[float]]] = defaultdict(lambda: defaultdict(list))
    # Week-1 film count *per bucket* — the qualifying openers that fall in each bucket.
    bucket_week1: dict[str, int] = defaultdict(int)

    for film_id, grosses in per_film_grosses.items():
        opener = grosses.get(1)
        if not opener or opener < 500_000:  # ignore platform releases (noisy ratios)
            continue
        open_year = per_film_open_year.get(film_id)
        if open_year is None or open_year in excluded_years:
            continue

        distributor, genres = per_film_meta[film_id]
        buckets = _film_buckets(distributor, genres)
        for b in buckets:
            bucket_week1[b] += 1

        for k in range(2, max_weeks + 1):
            if k in grosses:
                ret = grosses[k] / opener
                for b in buckets:
                    bucket_vectors[b][k].append(ret)

    # Median per (bucket, week)
    curves: dict[str, dict] = {}
    for bucket, by_week in bucket_vectors.items():
        retention = [1.0]  # week 1 is opening by definition
        n_films_by_week = {1: bucket_week1[bucket]}
        for k in range(2, max_weeks + 1):
            vals = by_week.get(k, [])
            retention.append(float(statistics.median(vals)) if vals else 0.0)
            n_films_by_week[k] = len(vals)
        curves[bucket] = {
            "retention": retention,
            "n_films_observed": n_films_by_week,
        }
    return curves


def write_decay_json(out_path: str) -> dict:
    import json

    curves = compute_decay_curves()
    payload = {
        "max_weeks": MAX_DECAY_WEEKS,
        "buckets": curves,
    }
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)
    return {"buckets": list(curves.keys()), "path": out_path}
