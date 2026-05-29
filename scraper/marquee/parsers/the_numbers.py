"""The Numbers parsers.

The forward release schedule lives at /movies/release-schedule and is a single table:
  - Month-header rows have 1 cell: 'May 2026'
  - Film rows have 4 cells: [date|empty, 'Title(Wide|Limited)', distributor, gross]
  - The date cell is empty for films sharing the same date as the row above.

We track running month/day state while iterating.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Iterable

from dateutil import parser as dateutil_parser
from selectolax.parser import HTMLParser

TN_BASE = "https://www.the-numbers.com"
SCHEDULE_URL = f"{TN_BASE}/movies/release-schedule"

MONTH_HEADER_RE = re.compile(r"^([A-Z][a-z]+)\s+(\d{4})$")
RELEASE_TYPE_RE = re.compile(r"^(.*?)\((Wide|Limited|Re-issue|IMAX|3D)\)\s*$", re.IGNORECASE)


@dataclass
class ScheduleEntry:
    source_id: str       # derived from /movie/<slug> URL, stable across scrapes
    title: str
    release_date: date
    is_wide: bool
    distributor: str | None
    format_flags: list[str]  # e.g. ['Wide'], ['IMAX', 'Wide']
    url: str | None


def _normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _split_title_and_format(raw: str) -> tuple[str, list[str], bool]:
    """'Backrooms(Wide)' → ('Backrooms', ['Wide'], True). Handles multiple flags."""
    raw = _normalize_text(raw)
    flags: list[str] = []
    is_wide = False
    # Strip trailing (Flag)(Flag)... iteratively
    title = raw
    while True:
        m = RELEASE_TYPE_RE.match(title)
        if not m:
            break
        title = m.group(1).strip()
        flag = m.group(2).title()
        flags.insert(0, flag)
        if flag.lower() == "wide":
            is_wide = True
    return title, flags, is_wide


def _source_id_from_href(href: str) -> str:
    """`/movie/Backrooms-(2026)` → 'Backrooms-(2026)'."""
    return href.rsplit("/", 1)[-1]


def parse_forward_schedule(html: str) -> list[ScheduleEntry]:
    """Parse the release-schedule page into a flat list of entries."""
    tree = HTMLParser(html)
    table = tree.css_first("table")
    if not table:
        return []

    entries: list[ScheduleEntry] = []
    current_year: int | None = None
    current_month: int | None = None
    current_day: int | None = None

    for tr in table.css("tr"):
        cells = tr.css("td")
        if not cells:
            continue

        # Month header row
        if len(cells) == 1:
            text = _normalize_text(cells[0].text(strip=True))
            m = MONTH_HEADER_RE.match(text)
            if m:
                try:
                    parsed = dateutil_parser.parse(text + " 1")
                    current_month = parsed.month
                    current_year = parsed.year
                    current_day = None
                except Exception:
                    pass
            continue

        if len(cells) < 3:
            continue

        date_cell = _normalize_text(cells[0].text(strip=True))
        title_cell = cells[1]
        distrib_cell = cells[2]

        # New date specified — parse "May 29" given current_year
        if date_cell:
            if current_year is None:
                continue
            try:
                d = dateutil_parser.parse(f"{date_cell} {current_year}")
                current_month = d.month
                current_day = d.day
            except Exception:
                continue

        if current_year is None or current_month is None or current_day is None:
            continue

        try:
            release_date = date(current_year, current_month, current_day)
        except ValueError:
            continue

        title_link = title_cell.css_first("a")
        if not title_link:
            continue
        raw_title = _normalize_text(title_cell.text(strip=True))
        href = title_link.attributes.get("href", "")
        title, flags, is_wide = _split_title_and_format(raw_title)
        if not title or not href:
            continue

        entries.append(
            ScheduleEntry(
                source_id=_source_id_from_href(href),
                title=title,
                release_date=release_date,
                is_wide=is_wide,
                distributor=_normalize_text(distrib_cell.text(strip=True)) or None,
                format_flags=flags,
                url=f"{TN_BASE}{href}",
            )
        )

    return entries


def filter_wide(entries: Iterable[ScheduleEntry]) -> list[ScheduleEntry]:
    return [e for e in entries if e.is_wide]
