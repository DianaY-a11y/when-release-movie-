"""Box Office Mojo parsers.

We target two page types:
  - Weekend chart:   /weekend/{YYYY}W{WW}/  → top ~30 films, opener+holdover combined
  - Per-film page:   /release/rl{ID}/        → full per-week curve for one film

BOM is owned by IMDb/Amazon and uses Amazon's UI framework. Class names are unstable;
we lean on table structure (column position) rather than class selectors so the parser
survives cosmetic redesigns.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterator

from selectolax.parser import HTMLParser

from marquee.util import parse_int, parse_money

WEEKEND_HEADER_RE = re.compile(r"(\d{4})\s+Weekend\s+(\d{1,2})", re.IGNORECASE)
BOM_FILM_HREF_RE = re.compile(r"/release/(rl\d+)")
BOM_BASE = "https://www.boxofficemojo.com"


# -------------------------------------------------------------------- weekend chart


@dataclass
class WeekendRow:
    rank: int | None
    last_week_rank: int | None
    title: str
    bom_id: str | None
    gross_usd: int | None
    pct_change_vs_prev: float | None
    theaters: int | None
    theater_change: int | None
    per_theater_avg_usd: int | None
    total_gross_usd: int | None
    weeks_in_release: int | None
    distributor: str | None
    is_new_this_week: bool
    is_estimated: bool


@dataclass
class WeekendPage:
    iso_year: int
    iso_week: int
    weekend_start: date  # Friday of that ISO week
    rows: list[WeekendRow]


def _iso_week_friday(iso_year: int, iso_week: int) -> date:
    """Return the Friday of the given ISO week. ISO Monday=1, Friday=5."""
    return date.fromisocalendar(iso_year, iso_week, 5)


def _pct(s: str) -> float | None:
    """'+19%' or '-32.4%' → 0.19 / -0.324. '-' → None."""
    s = s.strip()
    if not s or s == "-":
        return None
    s = s.replace("%", "").replace("+", "")
    try:
        return float(s) / 100.0
    except ValueError:
        return None


def _bool(s: str) -> bool:
    return s.strip().lower() == "true"


def parse_weekend_page(html: str, *, iso_year: int, iso_week: int) -> WeekendPage:
    """Parse a BOM weekend chart page into structured rows.

    `iso_year`/`iso_week` are passed in (rather than parsed from the page) because
    we already know them from the URL — defending against header changes.
    """
    tree = HTMLParser(html)
    table = tree.css_first("table")
    rows: list[WeekendRow] = []
    if table is None:
        return WeekendPage(iso_year=iso_year, iso_week=iso_week,
                           weekend_start=_iso_week_friday(iso_year, iso_week), rows=rows)

    # Skip header row
    for tr in table.css("tr")[1:]:
        cells = tr.css("td")
        if len(cells) < 11:
            # Defensive: skip malformed rows
            continue

        title_cell = cells[2]
        link = title_cell.css_first("a")
        href = link.attributes.get("href") if link else None
        bom_id = None
        if href:
            m = BOM_FILM_HREF_RE.search(href)
            if m:
                bom_id = m.group(1)

        rows.append(
            WeekendRow(
                rank=parse_int(cells[0].text(strip=True)),
                last_week_rank=parse_int(cells[1].text(strip=True)),
                title=title_cell.text(strip=True),
                bom_id=bom_id,
                gross_usd=parse_money(cells[3].text(strip=True)),
                pct_change_vs_prev=_pct(cells[4].text(strip=True)),
                theaters=parse_int(cells[5].text(strip=True)),
                theater_change=parse_int(cells[6].text(strip=True)),
                per_theater_avg_usd=parse_money(cells[7].text(strip=True)),
                total_gross_usd=parse_money(cells[8].text(strip=True)),
                weeks_in_release=parse_int(cells[9].text(strip=True)),
                distributor=cells[10].text(strip=True) or None,
                is_new_this_week=_bool(cells[11].text(strip=True)) if len(cells) > 11 else False,
                is_estimated=_bool(cells[12].text(strip=True)) if len(cells) > 12 else False,
            )
        )

    return WeekendPage(
        iso_year=iso_year,
        iso_week=iso_week,
        weekend_start=_iso_week_friday(iso_year, iso_week),
        rows=rows,
    )


def weekend_url(iso_year: int, iso_week: int) -> str:
    return f"{BOM_BASE}/weekend/{iso_year}W{iso_week:02d}/"


def iter_weekend_weeks(
    start_year: int, start_week: int, end_date: date
) -> Iterator[tuple[int, int]]:
    """Yield (iso_year, iso_week) from start through end_date inclusive (one weekend per ISO week)."""
    cur = _iso_week_friday(start_year, start_week)
    while cur <= end_date:
        y, w, _ = cur.isocalendar()
        yield y, w
        cur += timedelta(days=7)


# -------------------------------------------------------------------- per-film page


@dataclass
class FilmPage:
    """Metadata + totals scraped from a /release/rl<id>/ page.

    The daily perf table is not parsed here — the weekend-chart pipeline already
    captures per-film weekly grosses with cleaner structure. The film page is
    used for metadata (genres, MPAA, runtime, dates) and the total domestic gross.
    """

    bom_id: str
    title: str | None
    distributor: str | None
    mpaa: str | None
    runtime_minutes: int | None
    genres: list[str]
    release_date: date | None  # first date of the theatrical run
    end_date: date | None      # last date of the theatrical run, if listed
    open_weekend_gross_usd: int | None
    open_theaters: int | None
    widest_release_theaters: int | None
    total_domestic_gross_usd: int | None
    total_international_gross_usd: int | None
    total_worldwide_gross_usd: int | None


def film_url(bom_id: str) -> str:
    return f"{BOM_BASE}/release/{bom_id}/"


def _parse_runtime(s: str) -> int | None:
    """'2 hr 24 min' / '95 min' → minutes."""
    if not s:
        return None
    s = s.strip()
    h_match = re.search(r"(\d+)\s*hr", s)
    m_match = re.search(r"(\d+)\s*min", s)
    hours = int(h_match.group(1)) if h_match else 0
    minutes = int(m_match.group(1)) if m_match else 0
    total = hours * 60 + minutes
    return total or None


def _parse_release_range(s: str) -> tuple[date | None, date | None]:
    """'Dec 17, 2014-Apr 2, 2015' → (date(2014,12,17), date(2015,4,2))."""
    if not s:
        return None, None
    from dateutil import parser as dateutil_parser

    parts = re.split(r"\s*[-–]\s*", s, maxsplit=1)
    start = end = None
    try:
        start = dateutil_parser.parse(parts[0].strip()).date()
    except Exception:
        pass
    if len(parts) == 2:
        try:
            end = dateutil_parser.parse(parts[1].strip()).date()
        except Exception:
            pass
    return start, end


def _collect_summary_pairs(html_tree) -> dict[str, str]:
    """Extract label→value from the `.mojo-summary-values` block.

    Layout: a container div whose direct children are field divs, each containing
    a label span and one or more value spans. We use iter() because selectolax
    doesn't implement the :scope CSS selector.
    """
    pairs: dict[str, str] = {}
    container = html_tree.css_first(".mojo-summary-values")
    if not container:
        return pairs
    for div in container.iter():
        if div.tag != "div":
            continue
        spans = div.css("span")
        if len(spans) < 2:
            continue
        label = spans[0].text(strip=True)
        value_text = " ".join(s.text(strip=True) for s in spans[1:])
        pairs[label] = value_text
    return pairs


def _parse_opening_from_div(div) -> tuple[int | None, int | None]:
    """Pull (gross, theaters) from the Opening div by targeting the .money span directly.

    Layout: <div><span>Opening</span><span><span class="money">$X</span><br>N theaters</span></div>
    """
    if div is None:
        return None, None
    money_el = div.css_first(".money")
    gross = parse_money(money_el.text(strip=True)) if money_el else None
    # Theaters text appears after the money span — fall back to regex on the value span text.
    spans = div.css("span")
    theaters = None
    if len(spans) >= 2:
        # Spans[1] is the value wrapper; its full text includes money + theaters concatenated.
        # Build a "trailing" string by stripping the money text from the value text.
        value_text = spans[1].text(strip=True)
        if money_el:
            value_text = value_text.replace(money_el.text(strip=True), "", 1)
        m = re.search(r"([\d,]+)\s*theaters", value_text)
        if m:
            theaters = parse_int(m.group(1))
    return gross, theaters


def parse_film_page(html: str, *, bom_id: str) -> FilmPage:
    tree = HTMLParser(html)

    h1 = tree.css_first("h1")
    title = h1.text(strip=True) if h1 else None

    # Distributor often duplicates "See full company information" suffix — strip it.
    summary = _collect_summary_pairs(tree)

    distributor = summary.get("Distributor")
    if distributor:
        distributor = re.sub(r"\s*See full company information\s*$", "", distributor).strip()

    # Opening needs targeted DOM access because gross + theaters are nested without separators.
    opening_div = None
    container = tree.css_first(".mojo-summary-values")
    if container:
        for div in container.iter():
            if div.tag != "div":
                continue
            spans = div.css("span")
            if spans and spans[0].text(strip=True) == "Opening":
                opening_div = div
                break
    open_gross, open_theaters = _parse_opening_from_div(opening_div)
    release_date, end_date = _parse_release_range(summary.get("Release Date", ""))
    mpaa = summary.get("MPAA")
    runtime = _parse_runtime(summary.get("Running Time", ""))
    genres_raw = summary.get("Genres", "")
    # Split on commas/newlines only — splitting on whitespace would shred multi-word
    # genres like "Science Fiction" into separate tokens.
    genres = [g.strip() for g in re.split(r"[,\n]", genres_raw) if g.strip()] if genres_raw else []

    widest_match = re.search(r"([\d,]+)\s*theaters", summary.get("Widest Release", ""))
    widest = parse_int(widest_match.group(1)) if widest_match else None

    # Domestic / International / Worldwide grosses live in the performance summary table.
    perf = tree.css_first(".mojo-performance-summary-table")
    domestic = international = worldwide = None
    if perf:
        text = perf.text(strip=True)
        d = re.search(r"Domestic[^$]*\$([\d,]+)", text)
        i = re.search(r"International[^$]*\$([\d,]+)", text)
        w = re.search(r"Worldwide[^$]*\$([\d,]+)", text)
        domestic = parse_money("$" + d.group(1)) if d else None
        international = parse_money("$" + i.group(1)) if i else None
        worldwide = parse_money("$" + w.group(1)) if w else None

    return FilmPage(
        bom_id=bom_id,
        title=title,
        distributor=distributor,
        mpaa=mpaa,
        runtime_minutes=runtime,
        genres=genres,
        release_date=release_date,
        end_date=end_date,
        open_weekend_gross_usd=open_gross,
        open_theaters=open_theaters,
        widest_release_theaters=widest,
        total_domestic_gross_usd=domestic,
        total_international_gross_usd=international,
        total_worldwide_gross_usd=worldwide,
    )
