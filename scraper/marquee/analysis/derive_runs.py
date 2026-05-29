"""Derive run_week_number for weekly_grosses.

A film's "run" is a contiguous chart presence. Re-releases / re-runs get a fresh
week_number-from-1 sequence — what decay-curve modeling actually needs.

Gap threshold: 4 weeks. Films drop out for 1–2 weeks and reappear all the time
(small theater counts, premium-screening weekends); that's the same run. A film
absent for >4 weeks and then re-appearing is a new release event.

Idempotent: re-running just refreshes the column.
"""

from __future__ import annotations

from rich.console import Console
from sqlalchemy import text

from marquee.db import session_scope

console = Console()

GAP_DAYS = 28  # 4-week gap = start of a new release run

DERIVE_SQL = f"""
WITH ordered AS (
    SELECT
        id,
        film_id,
        weekend_start,
        LAG(weekend_start) OVER (PARTITION BY film_id ORDER BY weekend_start) AS prev_start
    FROM weekly_grosses
),
flagged AS (
    SELECT
        id, film_id, weekend_start,
        CASE
          WHEN prev_start IS NULL
            OR (weekend_start - prev_start) > {GAP_DAYS}
          THEN 1 ELSE 0
        END AS is_new_run
    FROM ordered
),
with_run_id AS (
    SELECT
        id, film_id, weekend_start,
        SUM(is_new_run) OVER (PARTITION BY film_id ORDER BY weekend_start) AS run_id
    FROM flagged
),
numbered AS (
    SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY film_id, run_id ORDER BY weekend_start) AS rwn
    FROM with_run_id
)
UPDATE weekly_grosses wg
SET run_week_number = n.rwn
FROM numbered n
WHERE wg.id = n.id
"""


def derive_run_week_numbers() -> dict:
    """Populate run_week_number across all weekly_grosses rows."""
    with session_scope() as session:
        # Stats before
        before = session.execute(
            text("SELECT COUNT(*), COUNT(run_week_number) FROM weekly_grosses")
        ).one()

        session.execute(text(DERIVE_SQL))
        session.commit()

        after = session.execute(
            text(
                "SELECT MAX(run_week_number), MAX(week_number), "
                "  COUNT(*) FILTER (WHERE run_week_number != week_number) "
                "FROM weekly_grosses"
            )
        ).one()

        return {
            "rows_total": before[0],
            "rows_populated_before": before[1],
            "max_run_week_number": after[0],
            "max_raw_week_number": after[1],
            "rows_where_differs": after[2],
        }
