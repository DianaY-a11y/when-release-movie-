"""OMDB API client — IMDb-backed metadata + RT/Metacritic scores.

Free tier: 1000 requests/day. We cache responses to disk so re-runs are free.

Endpoints used:
  - by_title:    GET ?t=<title>&y=<year>&apikey=KEY
  - by_imdb:     GET ?i=<imdbID>&apikey=KEY

We prefer by_imdb when we have an IMDb ID (more reliable); fall back to by_title+year
otherwise.
"""

from __future__ import annotations

import re
import urllib.parse
from dataclasses import dataclass

from marquee.config import settings
from marquee.fetch import Fetcher

OMDB_BASE = "https://www.omdbapi.com"


@dataclass
class OMDBRecord:
    title: str | None
    year: int | None
    imdb_id: str | None
    rated: str | None             # MPAA
    runtime_minutes: int | None
    genres: list[str]
    director: str | None
    actors: list[str]
    plot: str | None
    rt_critic: int | None
    metacritic: int | None
    imdb_rating: float | None
    imdb_votes: int | None
    box_office_usd: int | None
    production: str | None
    poster_url: str | None
    raw: dict


def _parse_runtime_minutes(s: str | None) -> int | None:
    if not s:
        return None
    m = re.match(r"(\d+)\s*min", s.strip(), re.IGNORECASE)
    return int(m.group(1)) if m else None


def _parse_rt(ratings: list) -> int | None:
    if not ratings:
        return None
    for r in ratings:
        if r.get("Source") == "Rotten Tomatoes":
            v = r.get("Value", "").strip("%")
            try:
                return int(v)
            except ValueError:
                return None
    return None


def _parse_money_usd(s: str | None) -> int | None:
    if not s or s == "N/A":
        return None
    cleaned = s.replace("$", "").replace(",", "").strip()
    try:
        return int(float(cleaned))
    except ValueError:
        return None


def _nval(s):
    return None if s in (None, "N/A", "", "n/a") else s


def _to_record(d: dict) -> OMDBRecord | None:
    if not d or d.get("Response") != "True":
        return None

    def _int(v):
        v = _nval(v)
        if v is None:
            return None
        try:
            return int(str(v).replace(",", ""))
        except ValueError:
            return None

    return OMDBRecord(
        title=_nval(d.get("Title")),
        year=_int(d.get("Year", "").split("–")[0] if d.get("Year") else None),
        imdb_id=_nval(d.get("imdbID")),
        rated=_nval(d.get("Rated")),
        runtime_minutes=_parse_runtime_minutes(d.get("Runtime")),
        genres=[g.strip() for g in (d.get("Genre") or "").split(",") if g.strip()],
        director=_nval(d.get("Director")),
        actors=[a.strip() for a in (d.get("Actors") or "").split(",") if a.strip()],
        plot=_nval(d.get("Plot")),
        rt_critic=_parse_rt(d.get("Ratings") or []),
        metacritic=_int(d.get("Metascore")),
        imdb_rating=(float(d["imdbRating"]) if _nval(d.get("imdbRating")) else None),
        imdb_votes=_int(d.get("imdbVotes")),
        box_office_usd=_parse_money_usd(d.get("BoxOffice")),
        production=_nval(d.get("Production")),
        poster_url=_nval(d.get("Poster")),
        raw=d,
    )


class OMDBClient:
    """Thin wrapper over the OMDB JSON API. Reuses the global Fetcher's cache."""

    def __init__(self, fetcher: Fetcher | None = None):
        if not settings.omdb_api_key:
            raise RuntimeError("OMDB_API_KEY not configured")
        self._fetcher = fetcher or Fetcher()
        self._owns_fetcher = fetcher is None

    def __enter__(self) -> "OMDBClient":
        return self

    def __exit__(self, *exc) -> None:
        if self._owns_fetcher:
            self._fetcher.__exit__(*exc)

    def _build(self, **params) -> str:
        params = {**params, "apikey": settings.omdb_api_key}
        return f"{OMDB_BASE}/?{urllib.parse.urlencode(params)}"

    def by_imdb(self, imdb_id: str) -> OMDBRecord | None:
        url = self._build(i=imdb_id, plot="short")
        data = self._fetcher.get_json(url, namespace="omdb")
        return _to_record(data) if isinstance(data, dict) else None

    def by_title(self, title: str, year: int | None = None) -> OMDBRecord | None:
        params = {"t": title, "plot": "short"}
        if year:
            params["y"] = year
        url = self._build(**params)
        data = self._fetcher.get_json(url, namespace="omdb")
        return _to_record(data) if isinstance(data, dict) else None
