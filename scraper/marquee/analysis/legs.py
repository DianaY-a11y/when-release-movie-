"""Legs analytics — multiplier comps and competitive clearance rate.

Two products feed the UI:

1. **Competitive clearance rate** per ISO week — for each week W, the typical
   second-weekend decline of films that opened in W-1. Low rate (gentle drop) means
   prior-week openers are still hogging screens and attention; high rate (steep drop)
   means the field clears, which is friendly to a new release looking for legs.

2. **High-multiplier comparables** — films whose total domestic ÷ opening weekend is
   high, indicating the film had legs (held the audience for weeks). The UI uses
   these as "your peer set" when the user picks a candidate weekend, filtered by
   tier + genre + MPAA.

Multiplier = total_domestic_gross / open_weekend_gross. Typical ranges:
  - 1.5–2.5: front-loaded (tentpoles, horror)
  - 2.5–3.5: typical wide release
  - 3.5+:   legs / word-of-mouth driven  
"""

from __future__ import annotations

import statistics
from dataclasses import asdict, dataclass

from sqlalchemy import and_, select

from marquee.analysis.weekly import INDIE_DISTRIBUTOR_TOKENS, DEFAULT_EXCLUDED_YEARS
from marquee.db import session_scope
from marquee.models import Film, Release, WeekendChart, WeeklyGross

# Films below this opening floor produce noisy multipliers (Lord of War 2x → small
# absolute numbers tell us nothing). Anything that opened to >$1M is multiplier-
# meaningful even for indie/prestige films.
MULTIPLIER_MIN_OPENING_USD = 1_000_000

HIGH_MULTIPLIER_THRESHOLD = 3.0  # 3x+ = "legs" film


def _tier_of(distributor: str | None) -> str:
    if not distributor:
        return "unknown"
    d = distributor.lower()
    for tok in INDIE_DISTRIBUTOR_TOKENS:
        if tok.lower() in d:
            return "indie"
    return "industry"


def competitive_clearance_rate_by_week(
    excluded_years: frozenset[int] = DEFAULT_EXCLUDED_YEARS,
) -> dict[int, dict]:
    """For each ISO week W, average week-2 % decline of films that opened in W-1.

    Returns {iso_week: {avg_drop, n_observations}}. Drop is negative pct (-0.45 = -45%).
    """
    with session_scope() as session:
        # Pair (opener row, second-week row) for the same film
        opener = WeeklyGross.__table__.alias("opener")
        second = WeeklyGross.__table__.alias("second")

        q = (
            select(
                opener.c.weekend_start.label("opener_weekend"),
                second.c.pct_change_vs_prev.label("week2_drop"),
            )
            .select_from(opener)
            .join(
                second,
                and_(
                    second.c.film_id == opener.c.film_id,
                    second.c.run_week_number == 2,
                ),
            )
            .where(opener.c.run_week_number == 1)
            .where(second.c.pct_change_vs_prev.is_not(None))
        )

        rows = session.execute(q).all()

    # Map opener_weekend → iso_week of the *target* week (= opener week + 1)
    by_target_week: dict[int, list[float]] = {}
    for opener_weekend, drop in rows:
        if opener_weekend.year in excluded_years:
            continue
        # Target week is the ISO week of the second weekend, which is opener_weekend + 7d
        from datetime import timedelta

        target = opener_weekend + timedelta(days=7)
        _, target_iso_week, _ = target.isocalendar()
        by_target_week.setdefault(target_iso_week, []).append(float(drop))

    out: dict[int, dict] = {}
    for week in range(1, 53):
        drops = by_target_week.get(week, [])
        if not drops:
            out[week] = {"avg_drop": None, "n_observations": 0, "clearance_score": None}
            continue
        avg = statistics.fmean(drops)
        # Clearance score: 0..1, higher = friendlier (steeper drops = field clears).
        # avg is negative; -0.7 (steep) → score 1, 0 (no drop) → score 0.
        clearance = max(0.0, min(1.0, -avg))
        out[week] = {
            "avg_drop": avg,
            "n_observations": len(drops),
            "clearance_score": clearance,
        }
    return out


@dataclass
class MultiplierComp:
    film_id: int
    title: str
    year: int
    iso_week: int
    distributor: str | None
    tier: str
    genres: list[str] | None
    mpaa: str | None
    opening_usd: int
    total_usd: int
    multiplier: float


def high_multiplier_films(
    excluded_years: frozenset[int] = DEFAULT_EXCLUDED_YEARS,
    min_opening: int = MULTIPLIER_MIN_OPENING_USD,
) -> list[MultiplierComp]:
    """All films with multiplier >= HIGH_MULTIPLIER_THRESHOLD. Sorted by multiplier desc."""
    with session_scope() as session:
        q = (
            select(
                Film.id,
                Film.title,
                Film.distributor,
                Film.genres,
                Film.mpaa,
                Release.release_date,
                Release.open_weekend_gross_usd,
                Release.total_domestic_gross_usd,
            )
            .join(Release, Release.film_id == Film.id)
            .where(Release.open_weekend_gross_usd.is_not(None))
            .where(Release.open_weekend_gross_usd >= min_opening)
            .where(Release.total_domestic_gross_usd.is_not(None))
        )
        rows = session.execute(q).all()

    comps: list[MultiplierComp] = []
    for film_id, title, distributor, genres, mpaa, rdate, opening, total in rows:
        if rdate is None or rdate.year in excluded_years:
            continue
        if opening <= 0:
            continue
        mult = float(total) / float(opening)
        if mult < HIGH_MULTIPLIER_THRESHOLD:
            continue
        _, iso_week, _ = rdate.isocalendar()
        comps.append(
            MultiplierComp(
                film_id=film_id,
                title=title,
                year=rdate.year,
                iso_week=iso_week,
                distributor=distributor,
                tier=_tier_of(distributor),
                genres=list(genres) if genres else None,
                mpaa=mpaa,
                opening_usd=int(opening),
                total_usd=int(total),
                multiplier=mult,
            )
        )
    comps.sort(key=lambda c: c.multiplier, reverse=True)
    return comps


def write_legs_json(out_path: str) -> dict:
    """Emit the combined legs payload."""
    import json

    clearance = competitive_clearance_rate_by_week()
    comps = high_multiplier_films()

    payload = {
        "min_opening_usd": MULTIPLIER_MIN_OPENING_USD,
        "high_multiplier_threshold": HIGH_MULTIPLIER_THRESHOLD,
        "clearance_by_week": clearance,
        "high_multiplier_films": [asdict(c) for c in comps],
    }
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)
    return {
        "weeks_with_clearance": sum(1 for v in clearance.values() if v["n_observations"] > 0),
        "high_multiplier_films": len(comps),
        "path": out_path,
    }
