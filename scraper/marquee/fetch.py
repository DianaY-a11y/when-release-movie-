"""Polite HTTP fetch layer with on-disk cache + rate limiting + retry.

Design:
- Fetcher and parser are separate. Every HTTP response is cached to disk keyed by URL.
- Re-running parsers never re-hits the network — critical for fast parser iteration.
- 1 req/sec (configurable) jittered, identifiable UA, robots.txt respected.
- Retries on 429/5xx with exponential backoff. 404 is a hard miss (cached as empty).
"""

from __future__ import annotations

import hashlib
import random
import time
import urllib.parse
import urllib.robotparser
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from marquee.config import settings


class FetchError(Exception):
    """Raised when a fetch fails after retries."""


@dataclass
class CachedResponse:
    url: str
    status: int
    body: str
    from_cache: bool


def _cache_path(url: str, namespace: str) -> Path:
    """Stable on-disk path for a given URL within a namespace (e.g. 'bom_weekend')."""
    key = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
    safe = urllib.parse.quote(url, safe="")[:120]
    root = settings.cache_dir / namespace
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{key}__{safe}.html"


class Fetcher:
    """Throttled, cached HTTP client. One instance per scrape run.

    Usage:
        with Fetcher() as f:
            resp = f.get("https://www.boxofficemojo.com/weekend/chart/?...", namespace="bom_weekend")
    """

    def __init__(self, *, allow_cache: bool = True):
        self._client = httpx.Client(
            headers={"User-Agent": settings.user_agent},
            http2=True,
            timeout=httpx.Timeout(30.0, connect=10.0),
            follow_redirects=True,
        )
        self._last_request_at: float = 0.0
        self._allow_cache = allow_cache
        self._robots: dict[str, urllib.robotparser.RobotFileParser] = {}

    def __enter__(self) -> "Fetcher":
        return self

    def __exit__(self, *exc) -> None:
        self._client.close()

    def _robots_allows(self, url: str) -> bool:
        """Check robots.txt for the URL's host.

        Per RFC 9309: 404 on robots.txt = no restrictions, fully allowed.
        Python's urllib.robotparser handles this correctly when fetched via urlopen,
        but only if read() actually succeeds. We use httpx for the fetch so we know
        the status code and can set allow_all/disallow_all explicitly.
        """
        parts = urllib.parse.urlsplit(url)
        host = f"{parts.scheme}://{parts.netloc}"
        if host not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            rp.set_url(f"{host}/robots.txt")
            try:
                resp = httpx.get(
                    f"{host}/robots.txt",
                    headers={"User-Agent": settings.user_agent},
                    timeout=10.0,
                    follow_redirects=True,
                )
                if resp.status_code == 404:
                    rp.allow_all = True  # spec: no robots.txt = all allowed
                elif resp.status_code in (401, 403):
                    rp.disallow_all = True
                elif resp.status_code >= 400:
                    rp.allow_all = True  # other server errors: be permissive
                else:
                    # Parse only if it looks like text/plain robots.txt, not an HTML 404 stand-in
                    ctype = resp.headers.get("content-type", "")
                    body = resp.text
                    if "text/plain" in ctype or (body and not body.lstrip().startswith("<")):
                        rp.parse(body.splitlines())
                    else:
                        rp.allow_all = True
                rp.modified()  # mark last_checked so can_fetch trusts our state
            except Exception:
                rp.allow_all = True  # cautious permissive on transport errors
                rp.modified()
            self._robots[host] = rp
        return self._robots[host].can_fetch(settings.user_agent, url)

    def _throttle(self) -> None:
        """Enforce REQUEST_DELAY_SECONDS between live requests, jittered ±25%."""
        if self._last_request_at == 0.0:
            return
        base = settings.request_delay_seconds
        jitter = base * 0.25 * (2 * random.random() - 1)
        target = self._last_request_at + base + jitter
        now = time.monotonic()
        if now < target:
            time.sleep(target - now)

    @retry(
        retry=retry_if_exception_type((httpx.HTTPError, FetchError)),
        wait=wait_exponential(multiplier=2, min=2, max=60),
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def _do_get(self, url: str) -> httpx.Response:
        self._throttle()
        resp = self._client.get(url)
        self._last_request_at = time.monotonic()
        # Retry on transient failures
        if resp.status_code in {429, 500, 502, 503, 504}:
            raise FetchError(f"{resp.status_code} on {url}")
        return resp

    def get(
        self,
        url: str,
        *,
        namespace: str,
        force_refresh: bool = False,
    ) -> CachedResponse:
        """Fetch URL with on-disk caching. `namespace` groups cache files by source."""
        path = _cache_path(url, namespace)
        if self._allow_cache and not force_refresh and path.exists():
            body = path.read_text(encoding="utf-8")
            return CachedResponse(url=url, status=200, body=body, from_cache=True)

        if not self._robots_allows(url):
            raise FetchError(f"robots.txt disallows {url}")

        resp = self._do_get(url)
        if resp.status_code == 404:
            # Cache empty body for 404 so we don't keep retrying.
            path.write_text("", encoding="utf-8")
            return CachedResponse(url=url, status=404, body="", from_cache=False)
        if resp.status_code >= 400:
            raise FetchError(f"HTTP {resp.status_code} on {url}")

        path.write_text(resp.text, encoding="utf-8")
        return CachedResponse(url=url, status=resp.status_code, body=resp.text, from_cache=False)

    def get_json(self, url: str, *, namespace: str, force_refresh: bool = False) -> dict | list:
        """Same as .get but parses JSON. Used for TMDb/OMDB API responses."""
        import json

        resp = self.get(url, namespace=namespace, force_refresh=force_refresh)
        if not resp.body:
            return {}
        return json.loads(resp.body)


def iter_cached(namespace: str) -> Iterator[Path]:
    """Yield every cached file in a namespace — useful for offline reparsing."""
    root = settings.cache_dir / namespace
    if not root.exists():
        return
    yield from sorted(root.glob("*.html"))
