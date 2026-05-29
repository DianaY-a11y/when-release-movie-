"""Snapshot emitters that the web app reads directly.

Each function writes one JSON file to scraper/data/, which `publish.sh` then copies
into web/public/data/.

Kept thin — these are *materialized views* over the DB, not analytics. The actual
analytics live in their own modules (weekly.py, legs.py, holdovers.py).
"""

from __future__ import annotations

import json
from datetime import date, timedelta

from sqlalchemy import select

from marquee.analysis.weekly import INDIE_DISTRIBUTOR_TOKENS
from marquee.db import session_scope
from marquee.models import Film, ForwardSchedule, Release


def _tier_of(distributor: str | None) -> str:
    if not distributor:
        return "unknown"
    d = distributor.lower()
    return "indie" if any(t.lower() in d for t in INDIE_DISTRIBUTOR_TOKENS) else "industry"


def write_forward_schedule(out_path: str, months_ahead: int = 12) -> dict:
    """Snapshot the forward release schedule joined to Film metadata.

    Only films with a release_date in the next `months_ahead` months. Joined to Film
    so the calendar can render genres / mpaa / poster_url alongside the date.
    """
    cutoff = date.today() + timedelta(days=months_ahead * 31)

    with session_scope() as session:
        rows = session.execute(
            select(
                ForwardSchedule.id,
                ForwardSchedule.title,
                ForwardSchedule.release_date,
                ForwardSchedule.distributor,
                ForwardSchedule.format_flags,
                ForwardSchedule.synopsis,
                ForwardSchedule.film_id,
                Film.genres,
                Film.mpaa,
                Film.poster_url,
                Film.runtime_minutes,
                Film.is_franchise,
            )
            .outerjoin(Film, Film.id == ForwardSchedule.film_id)
            .where(ForwardSchedule.is_scheduled.is_(True))
            .where(ForwardSchedule.release_date >= date.today() - timedelta(days=30))
            .where(ForwardSchedule.release_date <= cutoff)
            .order_by(ForwardSchedule.release_date)
        ).all()

    items: list[dict] = []
    for row in rows:
        (
            fwd_id,
            title,
            release_date,
            distributor,
            format_flags,
            synopsis,
            film_id,
            genres,
            mpaa,
            poster_url,
            runtime_minutes,
            is_franchise,
        ) = row
        _, iso_week, _ = release_date.isocalendar()
        items.append(
            {
                "id": fwd_id,
                "film_id": film_id,
                "title": title,
                "release_date": release_date.isoformat(),
                "iso_week": iso_week,
                "distributor": distributor,
                "tier": _tier_of(distributor),
                "format_flags": list(format_flags) if format_flags else None,
                "synopsis": (synopsis[:500] if synopsis else None),
                "genres": list(genres) if genres else None,
                "mpaa": mpaa,
                "poster_url": poster_url,
                "runtime_minutes": runtime_minutes,
                "is_franchise": is_franchise,
            }
        )

    with open(out_path, "w") as f:
        json.dump({"items": items, "months_ahead": months_ahead}, f, indent=2)
    return {"items": len(items), "path": out_path}


def write_film_index(out_path: str) -> dict:
    """The historical film corpus — id, title, year, distributor, tier, genres, mpaa, multiplier.

    Used for: comparable-films lookups, similarity feature vectors, calendar holdovers.
    Scope: any film with weekly data (the set we tagged + can score).
    """
    with session_scope() as session:
        rows = session.execute(
            select(
                Film.id,
                Film.title,
                Film.release_date,
                Film.distributor,
                Film.genres,
                Film.mpaa,
                Film.runtime_minutes,
                Film.production_budget_usd,
                Film.is_franchise,
                Film.poster_url,
                Release.open_weekend_gross_usd,
                Release.total_domestic_gross_usd,
                Release.peak_theaters,
            )
            .outerjoin(Release, Release.film_id == Film.id)
            .where(Film.release_date.is_not(None))
        ).all()

    items: list[dict] = []
    for row in rows:
        (
            fid,
            title,
            release_date,
            distributor,
            genres,
            mpaa,
            runtime_minutes,
            budget,
            is_franchise,
            poster_url,
            opening,
            total,
            peak_theaters,
        ) = row
        mult = None
        if opening and total and opening > 0:
            mult = float(total) / float(opening)
        items.append(
            {
                "id": fid,
                "title": title,
                "year": release_date.year,
                "release_date": release_date.isoformat(),
                "iso_week": release_date.isocalendar()[1],
                "distributor": distributor,
                "tier": _tier_of(distributor),
                "genres": list(genres) if genres else None,
                "mpaa": mpaa,
                "runtime_minutes": runtime_minutes,
                "budget_usd": budget,
                "is_franchise": is_franchise,
                "poster_url": poster_url,
                "opening_usd": int(opening) if opening else None,
                "total_domestic_usd": int(total) if total else None,
                "peak_theaters": peak_theaters,
                "multiplier": round(mult, 2) if mult else None,
            }
        )

    with open(out_path, "w") as f:
        json.dump({"items": items}, f, indent=2)
    return {"items": len(items), "path": out_path}
