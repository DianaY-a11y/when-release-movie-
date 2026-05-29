"""Shared utilities."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from typing import Any


def normalize_title(title: str) -> str:
    """Aggressive normalization for fuzzy title matching across sources.

    Lowercase, strip diacritics, drop punctuation, collapse whitespace, drop
    leading articles. We keep the original `title` field intact; this is for
    join keys only.
    """
    s = unicodedata.normalize("NFKD", title)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^(the|a|an)\s+", "", s)
    return s


def content_hash(payload: dict[str, Any]) -> str:
    """Stable SHA-256 of a payload for change detection."""
    canonical = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def parse_money(s: str | None) -> int | None:
    """'$1,234,567' or '1,234,567' -> 1234567. Returns None for '-', '', 'N/A'."""
    if s is None:
        return None
    cleaned = s.strip().replace("$", "").replace(",", "")
    if cleaned in {"", "-", "N/A", "n/a"}:
        return None
    try:
        return int(float(cleaned))
    except ValueError:
        return None


def parse_int(s: str | None) -> int | None:
    if s is None:
        return None
    cleaned = s.strip().replace(",", "")
    if cleaned in {"", "-", "N/A", "n/a"}:
        return None
    try:
        return int(cleaned)
    except ValueError:
        return None
