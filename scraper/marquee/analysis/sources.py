"""Lightweight EDA over the scraped tables.

The point is to surface convention surprises that would otherwise turn into
silent user-visible bugs (cf. the IMAX-format-flag incident). After each scrape,
running this command should take ~30 seconds to print and ~10 seconds to skim.

What's "low cardinality" worth dumping in full vs. truncating to a top-N:
  - ≤ 25 distinct values  → dump all
  - > 25                  → top 10 + ellipsis with `… N more`
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any, Sequence

from rich.console import Console
from rich.table import Table
from sqlalchemy import func, select

from marquee.db import session_scope
from marquee.models import (
    Embedding,
    Film,
    ForwardSchedule,
    Release,
    Review,
    ScrapeJob,
    WeekendChart,
    WeeklyGross,
)

console = Console()
FULL_DUMP_MAX = 25


@dataclass
class FieldStat:
    name: str
    kind: str  # "categorical" | "categorical_array" | "numeric" | "date" | "boolean"
    null_count: int
    distinct: int | None = None
    top: list[tuple[Any, int]] | None = None
    numeric: dict[str, float] | None = None  # min, p50, p99, max, mean
    date_range: tuple[str, str] | None = None


def _fmt_value(v: Any) -> str:
    if v is None or v == "":
        return "∅"
    if isinstance(v, list):
        return "{" + ", ".join(map(str, v)) + "}" if v else "{}"
    return str(v)


def _print_field(stat: FieldStat, total_rows: int) -> None:
    null_pct = (stat.null_count / total_rows * 100) if total_rows else 0
    null_hint = f"  NULL {stat.null_count} ({null_pct:.1f}%)" if stat.null_count else ""
    header = f"[bold cyan]{stat.name}[/bold cyan]  [dim]{stat.kind}[/dim]"
    if stat.distinct is not None:
        header += f"  distinct={stat.distinct}"
    console.print(header + null_hint)

    if stat.numeric:
        n = stat.numeric
        console.print(
            f"    range {n['min']:,.0f} → {n['max']:,.0f}  "
            f"mean {n['mean']:,.0f}  p50 {n['p50']:,.0f}  p99 {n['p99']:,.0f}"
        )
    elif stat.date_range:
        console.print(f"    range {stat.date_range[0]} → {stat.date_range[1]}")
    elif stat.top is not None:
        if stat.distinct is not None and stat.distinct <= FULL_DUMP_MAX:
            for val, cnt in stat.top:
                console.print(f"    {_fmt_value(val):30}  {cnt:>6}")
        else:
            shown = stat.top[:10]
            for val, cnt in shown:
                console.print(f"    {_fmt_value(val):30}  {cnt:>6}")
            extra = (stat.distinct or 0) - len(shown)
            if extra > 0:
                console.print(f"    [dim]… {extra} more[/dim]")
    console.print()


# ----- collectors --------------------------------------------------------


def _categorical(session, table, column) -> FieldStat:
    rows = session.execute(
        select(column, func.count()).where(column.is_not(None)).group_by(column).order_by(func.count().desc())
    ).all()
    null_count = session.scalar(select(func.count()).select_from(table).where(column.is_(None))) or 0
    return FieldStat(
        name=column.key,
        kind="categorical",
        null_count=null_count,
        distinct=len(rows),
        top=[(v, c) for v, c in rows],
    )


def _categorical_array(session, table, column) -> FieldStat:
    """Cardinality of UNNESTed array values (e.g. genres, format_flags)."""
    counter: Counter = Counter()
    rows = session.execute(select(column)).all()
    null_count = 0
    for (arr,) in rows:
        if arr is None:
            null_count += 1
            continue
        if not arr:
            counter[tuple()] = counter.get(tuple(), 0) + 1
            continue
        # Track the full flag combination (matters for the IMAX-style bug)
        counter[tuple(arr)] += 1
    sorted_top = counter.most_common()
    return FieldStat(
        name=column.key,
        kind="categorical_array",
        null_count=null_count,
        distinct=len(counter),
        top=[(list(k), v) for k, v in sorted_top],
    )


def _numeric(session, table, column) -> FieldStat:
    """Range + p50/p99/mean via percentile_cont."""
    row = session.execute(
        select(
            func.min(column),
            func.max(column),
            func.avg(column),
            func.percentile_cont(0.5).within_group(column.asc()),
            func.percentile_cont(0.99).within_group(column.asc()),
            func.count().filter(column.is_(None)),
        )
    ).one()
    mn, mx, mean, p50, p99, nulls = row
    if mn is None and mx is None:
        return FieldStat(name=column.key, kind="numeric", null_count=int(nulls or 0))
    return FieldStat(
        name=column.key,
        kind="numeric",
        null_count=int(nulls or 0),
        numeric={
            "min": float(mn),
            "max": float(mx),
            "mean": float(mean),
            "p50": float(p50),
            "p99": float(p99),
        },
    )


def _date_range(session, column) -> FieldStat:
    row = session.execute(
        select(func.min(column), func.max(column), func.count().filter(column.is_(None)))
    ).one()
    mn, mx, nulls = row
    if mn is None:
        return FieldStat(name=column.key, kind="date", null_count=int(nulls or 0))
    return FieldStat(
        name=column.key,
        kind="date",
        null_count=int(nulls or 0),
        date_range=(str(mn), str(mx)),
    )


def _boolean(session, table, column) -> FieldStat:
    rows = session.execute(
        select(column, func.count()).group_by(column).order_by(func.count().desc())
    ).all()
    return FieldStat(
        name=column.key,
        kind="boolean",
        null_count=0,
        distinct=len(rows),
        top=[(v, c) for v, c in rows],
    )


# ----- table audits ------------------------------------------------------


def _audit_table(session, name: str, table, fields: Sequence[FieldStat]) -> None:
    total = session.scalar(select(func.count()).select_from(table)) or 0
    console.rule(f"[bold]{name}[/bold]  [dim]({total:,} rows)[/dim]", align="left")
    for f in fields:
        _print_field(f, total)


def run_sources_audit() -> None:
    with session_scope() as session:
        # forward_schedule — categorical-heavy
        _audit_table(
            session,
            "forward_schedule",
            ForwardSchedule,
            [
                _categorical_array(session, ForwardSchedule, ForwardSchedule.format_flags),
                _categorical(session, ForwardSchedule, ForwardSchedule.distributor),
                _date_range(session, ForwardSchedule.release_date),
                _boolean(session, ForwardSchedule, ForwardSchedule.is_scheduled),
            ],
        )

        # films — mixed
        _audit_table(
            session,
            "films",
            Film,
            [
                _categorical(session, Film, Film.mpaa),
                _categorical_array(session, Film, Film.genres),
                _categorical(session, Film, Film.distributor),
                _numeric(session, Film, Film.runtime_minutes),
                _date_range(session, Film.release_date),
            ],
        )

        # releases — numeric-heavy
        _audit_table(
            session,
            "releases",
            Release,
            [
                _date_range(session, Release.release_date),
                _numeric(session, Release, Release.peak_theaters),
                _numeric(session, Release, Release.open_weekend_gross_usd),
                _numeric(session, Release, Release.total_domestic_gross_usd),
                _boolean(session, Release, Release.is_wide),
            ],
        )

        # weekly_grosses — large numeric
        _audit_table(
            session,
            "weekly_grosses",
            WeeklyGross,
            [
                _date_range(session, WeeklyGross.weekend_start),
                _numeric(session, WeeklyGross, WeeklyGross.week_number),
                _numeric(session, WeeklyGross, WeeklyGross.gross_usd),
                _numeric(session, WeeklyGross, WeeklyGross.theaters),
            ],
        )

        # weekend_charts — small + dense
        _audit_table(
            session,
            "weekend_charts",
            WeekendChart,
            [
                _date_range(session, WeekendChart.weekend_start),
                _numeric(session, WeekendChart, WeekendChart.iso_year),
                _numeric(session, WeekendChart, WeekendChart.total_industry_gross_usd),
                _numeric(session, WeekendChart, WeekendChart.num_wide_openers),
            ],
        )

        # reviews — sparse
        _audit_table(
            session,
            "reviews",
            Review,
            [
                _numeric(session, Review, Review.rt_critic),
                _numeric(session, Review, Review.metacritic),
                _numeric(session, Review, Review.imdb_rating),
            ],
        )

        # scrape_jobs — state
        rows = session.execute(
            select(ScrapeJob.source, ScrapeJob.status, ScrapeJob.last_success_at, ScrapeJob.items_updated)
        ).all()
        console.rule(f"[bold]scrape_jobs[/bold]  [dim]({len(rows)} rows)[/dim]", align="left")
        t = Table(show_header=True, header_style="bold cyan", box=None, padding=(0, 2))
        t.add_column("source")
        t.add_column("status")
        t.add_column("last_success_at")
        t.add_column("items_updated", justify="right")
        for r in rows:
            t.add_row(
                str(r.source),
                str(r.status),
                str(r.last_success_at or "—"),
                str(r.items_updated if r.items_updated is not None else "—"),
            )
        console.print(t)
        console.print()

        # embeddings — quick existence check
        n_emb = session.scalar(select(func.count()).select_from(Embedding)) or 0
        console.rule(f"[bold]embeddings[/bold]  [dim]({n_emb:,} rows)[/dim]", align="left")
        if n_emb == 0:
            console.print("    [dim]none yet — populated when cannibalization model runs[/dim]\n")
