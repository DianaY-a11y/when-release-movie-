"""TMDb API client — synopsis, cast, crew, budget, posters.

API docs: https://developer.themoviedb.org/reference/intro/getting-started

Endpoints used:
  - GET /3/search/movie?query=<title>&year=<year>     — title-based discovery
  - GET /3/movie/{tmdb_id}?append_to_response=credits — full details + cast/crew
  - GET /3/find/{imdb_id}?external_source=imdb_id     — cross-reference when IMDb ID is known
"""

from __future__ import annotations

import urllib.parse
from dataclasses import dataclass, field

from marquee.config import settings
from marquee.fetch import Fetcher

TMDB_BASE = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"


@dataclass
class TMDbRecord:
    tmdb_id: int
    imdb_id: str | None
    title: str
    original_title: str | None
    release_date: str | None       # ISO YYYY-MM-DD
    runtime: int | None
    genres: list[str] = field(default_factory=list)
    overview: str | None = None
    budget: int | None = None
    revenue: int | None = None
    poster_path: str | None = None
    director: str | None = None
    top_cast: list[str] = field(default_factory=list)
    production_companies: list[str] = field(default_factory=list)
    belongs_to_collection: str | None = None  # e.g. "James Bond Collection" → franchise flag
    raw: dict = field(default_factory=dict)

    @property
    def poster_url(self) -> str | None:
        return f"{TMDB_IMAGE_BASE}{self.poster_path}" if self.poster_path else None


def _to_record(d: dict) -> TMDbRecord | None:
    if not d or "id" not in d:
        return None
    credits = d.get("credits") or {}
    cast = credits.get("cast", []) or []
    crew = credits.get("crew", []) or []
    director = next((c.get("name") for c in crew if c.get("job") == "Director"), None)
    top_cast = [c.get("name") for c in cast[:5] if c.get("name")]
    collection = (d.get("belongs_to_collection") or {}).get("name") if d.get("belongs_to_collection") else None

    return TMDbRecord(
        tmdb_id=d["id"],
        imdb_id=d.get("imdb_id"),
        title=d.get("title") or d.get("original_title") or "",
        original_title=d.get("original_title"),
        release_date=d.get("release_date") or None,
        runtime=d.get("runtime") or None,
        genres=[g["name"] for g in (d.get("genres") or []) if g.get("name")],
        overview=d.get("overview") or None,
        budget=d.get("budget") or None,  # TMDb uses 0 for unknown
        revenue=d.get("revenue") or None,
        poster_path=d.get("poster_path"),
        director=director,
        top_cast=top_cast,
        production_companies=[p["name"] for p in (d.get("production_companies") or []) if p.get("name")],
        belongs_to_collection=collection,
        raw=d,
    )


class TMDbClient:
    """Thin TMDb API wrapper. All responses are cached on disk via the Fetcher."""

    def __init__(self, fetcher: Fetcher | None = None):
        if not settings.tmdb_api_key:
            raise RuntimeError("TMDB_API_KEY not configured")
        self._fetcher = fetcher or Fetcher()
        self._owns_fetcher = fetcher is None

    def __enter__(self) -> "TMDbClient":
        return self

    def __exit__(self, *exc) -> None:
        if self._owns_fetcher:
            self._fetcher.__exit__(*exc)

    def _url(self, path: str, **params) -> str:
        params = {**params, "api_key": settings.tmdb_api_key}
        return f"{TMDB_BASE}{path}?{urllib.parse.urlencode(params)}"

    def search_movie(self, title: str, year: int | None = None) -> list[dict]:
        params = {"query": title}
        if year:
            params["year"] = year
        data = self._fetcher.get_json(self._url("/search/movie", **params), namespace="tmdb")
        return data.get("results", []) if isinstance(data, dict) else []

    def get_movie(self, tmdb_id: int) -> TMDbRecord | None:
        data = self._fetcher.get_json(
            self._url(f"/movie/{tmdb_id}", append_to_response="credits"),
            namespace="tmdb",
        )
        return _to_record(data) if isinstance(data, dict) else None

    def find_by_imdb(self, imdb_id: str) -> TMDbRecord | None:
        data = self._fetcher.get_json(
            self._url(f"/find/{imdb_id}", external_source="imdb_id"),
            namespace="tmdb",
        )
        results = (data or {}).get("movie_results") or []
        if not results:
            return None
        return self.get_movie(results[0]["id"])
