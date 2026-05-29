"""By-ISO-week historical performance — dual track (industry + indie/prestige).

For each ISO week 1-52 we compute, separately per tier:
  - **Strength**: median opening-weekend gross of films opening that week (across years)
  - **Consistency**: coefficient of variation across years
  - **Normalization**: min-max scaled across the 52 weeks → 0..1, the heatmap fill value
  - **Context**: top openers that ever opened that week (for the hover-card)
  - **Holiday**: hand-curated label for weeks that move box office

Two tiers, two outputs:
  - `weekly_industry.json`  — all distributors
  - `weekly_indie.json`     — A24, Neon, Focus, Bleecker, Roadside, Searchlight (incl. Fox-era)

We exclude 2020 and 2021 from the per-week aggregates (theaters closed/partially closed).
CPI adjustment is out of scope for the POC — the 10-year window is short enough that
within-tier ordering is what matters, not absolute dollars.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, asdict
from datetime import date

from sqlalchemy import func, or_, select

from marquee.db import session_scope
from marquee.models import Film, WeekendChart, WeeklyGross

DEFAULT_EXCLUDED_YEARS = frozenset({2020, 2021})

# Per-tier minimum opening-weekend gross to count toward the curve.
# Industry: $300K filters out the long tail of single-theater bookings.
# Indie: $50K — prestige distributors (A24, Neon, Searchlight) platform-release a
# large share of their slate; using the industry floor leaves indie weeks with 1-2
# films total and creates a noise-dominated curve. The floor still excludes Oscar-
# qualifying one-screen runs.
MIN_OPENER_GROSS_BY_TIER = {
    "industry": 300_000,
    "indie": 50_000,
}
MIN_OPENER_GROSS = MIN_OPENER_GROSS_BY_TIER["industry"]  # kept for back-compat default

# Indie/prestige tier — strict spec list. Distributor strings on BOM use variant forms
# (Neon vs NEON, Bleecker Street Media, Searchlight Pictures post-Disney). We match
# case-insensitively against substrings of these tokens.
INDIE_DISTRIBUTOR_TOKENS = (
    "A24",
    "Neon",
    "Focus Features",
    "Bleecker Street",
    "Roadside Attractions",
    "Searchlight",  # matches "Fox Searchlight" and "Searchlight Pictures"
)


# Hand-curated holiday windows beyond simple federal-holidays — these are the ones
# that move box office. Maps ISO week → human label.
HOLIDAY_WEEKS: dict[int, str] = {
    1: "New Year's",
    7: "Valentine's Day",
    8: "Presidents Day",
    11: "Spring Break (early)",
    12: "Spring Break (peak)",
    13: "Spring Break (late)",
    14: "Easter (variable)",
    15: "Easter (variable)",
    18: "Pre-Memorial Day",
    21: "Memorial Day",
    26: "Pre-July 4th",
    27: "July 4th",
    32: "Mid-Summer (peak)",
    35: "Labor Day",
    43: "Pre-Halloween",
    44: "Halloween",
    47: "Thanksgiving",
    48: "Post-Thanksgiving",
    50: "Pre-Christmas",
    51: "Christmas",
    52: "New Year's Eve",
}


@dataclass
class WeekSummary:
    iso_week: int
    label: str
    n_years: int
    median_opener_gross_usd: int
    mean_opener_gross_usd: int
    stdev_opener_gross_usd: int
    cv: float | None
    opening_norm: float  # 0..1, min-max scaled across all 52 weeks in this tier
    rank_pct: float | None
    holiday: str | None
    meaningful_openers_count: int  # how many films/year/week passed MIN_OPENER_GROSS
    top_films: list[dict]


def _label(iso_week: int) -> str:
    return f"Week {iso_week}"


def _indie_filter():
    """SQL filter for indie/prestige distributors — case-insensitive substring match."""
    return or_(*(Film.distributor.ilike(f"%{tok}%") for tok in INDIE_DISTRIBUTOR_TOKENS))


def _openers_per_iso_week(
    session,
    *,
    distributor_filter,  # None = all; callable returning a clause = filter applied
    min_gross: int,
    excluded_years: frozenset[int],
) -> dict[int, list[tuple[int, int, str, int]]]:
    """Return per-ISO-week list of (iso_year, gross, title, film_id) for opening-weekend films."""
    q = (
        select(
            WeekendChart.iso_week,
            WeekendChart.iso_year,
            WeeklyGross.gross_usd,
            Film.title,
            Film.id.label("film_id"),
            Film.distributor,
        )
        .join(WeeklyGross, WeeklyGross.weekend_start == WeekendChart.weekend_start)
        .join(Film, Film.id == WeeklyGross.film_id)
        .where(WeeklyGross.run_week_number == 1)
        .where(WeeklyGross.gross_usd >= min_gross)
    )
    if distributor_filter is not None:
        q = q.where(distributor_filter())

    by_week: dict[int, list[tuple[int, int, str, int]]] = {}
    for week, year, gross, title, film_id, _ in session.execute(q).all():
        if year in excluded_years:
            continue
        by_week.setdefault(week, []).append((year, int(gross), title, film_id))
    return by_week


def compute_weekly_performance(
    *,
    tier: str = "industry",  # "industry" or "indie"
    excluded_years: frozenset[int] = DEFAULT_EXCLUDED_YEARS,
    min_gross: int | None = None,
) -> list[WeekSummary]:
    """Build WeekSummary per ISO week for one tier."""
    distributor_filter = _indie_filter if tier == "indie" else None
    if min_gross is None:
        min_gross = MIN_OPENER_GROSS_BY_TIER[tier]

    with session_scope() as session:
        openers = _openers_per_iso_week(
            session,
            distributor_filter=distributor_filter,
            min_gross=min_gross,
            excluded_years=excluded_years,
        )

    # First pass: per-week median of opening grosses (across years)
    per_week_medians: dict[int, float] = {}
    summaries_partial: dict[int, dict] = {}

    for week in range(1, 53):
        rows = openers.get(week, [])
        if not rows:
            continue
        # Group by year → median opener gross *within* that year+week → then median across years.
        # This treats each year as one observation so a flood-of-openers year doesn't dominate.
        per_year: dict[int, list[int]] = {}
        for year, gross, _, _ in rows:
            per_year.setdefault(year, []).append(gross)
        year_medians = [statistics.median(gs) for gs in per_year.values()]
        median = statistics.median(year_medians)
        mean = statistics.fmean(year_medians)
        stdev = statistics.pstdev(year_medians) if len(year_medians) > 1 else 0
        cv = (stdev / mean) if mean > 0 else None

        top_films_sorted = sorted(rows, key=lambda r: r[1], reverse=True)
        top_films = [
            {"title": t, "year": y, "gross_usd": g, "film_id": fid}
            for y, g, t, fid in top_films_sorted[:10]
        ]

        per_week_medians[week] = median
        summaries_partial[week] = {
            "n_years": len(per_year),
            "median": median,
            "mean": mean,
            "stdev": stdev,
            "cv": cv,
            "meaningful_openers_count": len(rows),
            "top_films": top_films,
        }

    # Min-max normalize medians across the 52 weeks → opening_norm
    if per_week_medians:
        lo, hi = min(per_week_medians.values()), max(per_week_medians.values())
        span = hi - lo if hi > lo else 1.0
    else:
        lo, span = 0.0, 1.0

    sorted_medians = sorted(per_week_medians.values())

    def _rank_pct(v: float) -> float | None:
        if not sorted_medians:
            return None
        below = sum(1 for m in sorted_medians if m < v)
        return below / len(sorted_medians)

    summaries: list[WeekSummary] = []
    for week in sorted(summaries_partial.keys()):
        sp = summaries_partial[week]
        median = sp["median"]
        summaries.append(
            WeekSummary(
                iso_week=week,
                label=_label(week),
                n_years=sp["n_years"],
                median_opener_gross_usd=int(median),
                mean_opener_gross_usd=int(sp["mean"]),
                stdev_opener_gross_usd=int(sp["stdev"]),
                cv=sp["cv"],
                opening_norm=(median - lo) / span,
                rank_pct=_rank_pct(median),
                holiday=HOLIDAY_WEEKS.get(week),
                meaningful_openers_count=sp["meaningful_openers_count"],
                top_films=sp["top_films"],
            )
        )
    return summaries


def write_weekly_json(out_path: str, *, tier: str = "industry") -> dict:
    """Compute one tier and dump to disk."""
    import json

    summaries = compute_weekly_performance(tier=tier)
    payload = {
        "tier": tier,
        "excluded_years": sorted(DEFAULT_EXCLUDED_YEARS),
        "min_opener_gross_usd": MIN_OPENER_GROSS_BY_TIER[tier],
        "weeks": [asdict(s) for s in summaries],
    }
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)
    return {"tier": tier, "weeks": len(summaries), "path": out_path}


def write_both_tracks(out_dir: str) -> dict:
    """Emit weekly_industry.json and weekly_indie.json side-by-side."""
    import os

    os.makedirs(out_dir, exist_ok=True)
    results = []
    for tier in ("industry", "indie"):
        path = os.path.join(out_dir, f"weekly_{tier}.json")
        results.append(write_weekly_json(path, tier=tier))
    return {"tracks": results}
