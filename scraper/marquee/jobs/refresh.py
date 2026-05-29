"""Forward-schedule refresh — called by Vercel Cron every 6h and by the manual UI button.

Idempotent and concurrency-safe:
  - Reads scrape_jobs to skip if last_success_at < 1h ago
  - Acquires a Postgres advisory lock so concurrent calls don't race
  - Upserts with ON CONFLICT + content_hash so no-op rows aren't touched
  - Tombstones (is_scheduled=False) rather than deleting rows that drop out of the schedule
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from rich.console import Console
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from marquee.db import advisory_lock, session_scope
from marquee.fetch import Fetcher
from marquee.models import ForwardSchedule, ScrapeJob
from marquee.parsers.the_numbers import SCHEDULE_URL, parse_forward_schedule
from marquee.util import content_hash

console = Console()

SOURCE = "the_numbers_forward"
FRESHNESS_WINDOW = timedelta(hours=1)


def _hash_entry(e) -> str:
    return content_hash(
        {
            "title": e.title,
            "release_date": e.release_date,
            "distributor": e.distributor,
            "is_wide": e.is_wide,
            "format_flags": sorted(e.format_flags or []),
        }
    )


def run_refresh(*, force: bool = False) -> dict:
    """Refresh the forward schedule. Returns a small status dict for the API caller."""
    with session_scope() as session:
        job = session.get(ScrapeJob, SOURCE)
        now = datetime.now(timezone.utc)

        if (
            not force
            and job
            and job.last_success_at
            and (now - job.last_success_at) < FRESHNESS_WINDOW
        ):
            return {
                "status": "skipped",
                "reason": "fresh",
                "last_success_at": job.last_success_at.isoformat(),
            }

        with advisory_lock(session, f"scrape:{SOURCE}") as got_lock:
            if not got_lock:
                return {"status": "skipped", "reason": "another scrape running"}

            if not job:
                job = ScrapeJob(source=SOURCE, status="running", last_run_at=now)
                session.add(job)
            else:
                job.status = "running"
                job.last_run_at = now
                job.error = None
            session.flush()

            try:
                with Fetcher() as fetcher:
                    resp = fetcher.get(SCHEDULE_URL, namespace="the_numbers", force_refresh=force)
                entries = parse_forward_schedule(resp.body)
                console.print(f"[cyan]Parsed {len(entries)} entries[/cyan]")

                seen_ids: set[str] = set()
                updated = 0
                inserted = 0
                unchanged = 0
                for e in entries:
                    seen_ids.add(e.source_id)
                    h = _hash_entry(e)
                    stmt = pg_insert(ForwardSchedule).values(
                        source=SOURCE,
                        source_id=e.source_id,
                        title=e.title,
                        release_date=e.release_date,
                        distributor=e.distributor,
                        format_flags=e.format_flags,
                        content_hash=h,
                        is_scheduled=True,
                    )
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["source", "source_id"],
                        set_={
                            "title": stmt.excluded.title,
                            "release_date": stmt.excluded.release_date,
                            "distributor": stmt.excluded.distributor,
                            "format_flags": stmt.excluded.format_flags,
                            "content_hash": stmt.excluded.content_hash,
                            "is_scheduled": True,
                        },
                        where=(ForwardSchedule.content_hash.is_distinct_from(h)),
                    )
                    result = session.execute(stmt)
                    # rowcount > 0 indicates write happened (insert or actual update)
                    if result.rowcount:
                        # We can't easily distinguish insert vs update here without a returning,
                        # so we just count writes.
                        updated += 1
                    else:
                        unchanged += 1

                # Tombstone rows we didn't see this run (studio pulled them).
                if seen_ids:
                    tombstoned = session.execute(
                        update(ForwardSchedule)
                        .where(
                            ForwardSchedule.source == SOURCE,
                            ForwardSchedule.source_id.notin_(seen_ids),
                            ForwardSchedule.is_scheduled.is_(True),
                        )
                        .values(is_scheduled=False)
                    ).rowcount
                else:
                    tombstoned = 0

                job.status = "idle"
                job.last_success_at = datetime.now(timezone.utc)
                job.items_updated = updated
                return {
                    "status": "ok",
                    "entries_parsed": len(entries),
                    "writes": updated,
                    "unchanged": unchanged,
                    "tombstoned": tombstoned,
                }
            except Exception as e:
                job.status = "failed"
                job.error = str(e)[:1000]
                raise
