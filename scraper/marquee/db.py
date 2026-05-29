"""DB session + advisory-lock helper."""

from __future__ import annotations

import hashlib
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from marquee.config import settings
from marquee.models import Base

_engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False, future=True)


def get_engine():
    return _engine


def init_schema() -> None:
    """Create all tables. For the POC we skip Alembic until schema settles."""
    Base.metadata.create_all(_engine)


@contextmanager
def session_scope() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _lock_key(name: str) -> int:
    """Stable 32-bit signed int from a lock name, for pg_advisory_lock."""
    digest = hashlib.sha256(name.encode("utf-8")).digest()
    val = int.from_bytes(digest[:4], "big", signed=True)
    return val


@contextmanager
def advisory_lock(session: Session, name: str) -> Iterator[bool]:
    """Try to acquire a Postgres advisory lock for the scope of this block.

    Yields True if acquired (caller owns the work), False if another worker is already running.
    Released automatically when the connection closes; we also release explicitly on exit.
    """
    key = _lock_key(name)
    acquired = session.execute(
        text("SELECT pg_try_advisory_lock(:k)"), {"k": key}
    ).scalar_one()
    try:
        yield bool(acquired)
    finally:
        if acquired:
            session.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
