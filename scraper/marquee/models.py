"""SQLAlchemy models.

Design notes:
- `(source, source_id)` is the natural key for every externally-sourced row, enabling clean
  ON CONFLICT upserts that work even before we've reconciled across sources.
- `content_hash` is a stable digest of the substantive fields; upserts compare it and skip
  no-op writes so `updated_at` is a meaningful "this row actually changed" signal.
- `films` is the canonical entity. External rows reference it by `film_id` once matched;
  unmatched rows can sit with `film_id IS NULL` until reconciliation runs.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    JSON,
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Film(Base):
    __tablename__ = "films"

    id: Mapped[int] = mapped_column(primary_key=True)
    tmdb_id: Mapped[Optional[int]] = mapped_column(BigInteger, unique=True, index=True)
    imdb_id: Mapped[Optional[str]] = mapped_column(String(20), unique=True, index=True)
    bom_id: Mapped[Optional[str]] = mapped_column(String(50), unique=True, index=True)
    the_numbers_id: Mapped[Optional[str]] = mapped_column(String(50), unique=True, index=True)

    title: Mapped[str] = mapped_column(String(500), index=True)
    title_normalized: Mapped[str] = mapped_column(String(500), index=True)
    release_date: Mapped[Optional[date]] = mapped_column(Date, index=True)

    distributor: Mapped[Optional[str]] = mapped_column(String(200))
    studio: Mapped[Optional[str]] = mapped_column(String(200))
    mpaa: Mapped[Optional[str]] = mapped_column(String(10))
    runtime_minutes: Mapped[Optional[int]] = mapped_column(Integer)
    genres: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String))
    director: Mapped[Optional[str]] = mapped_column(String(300))
    top_cast: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String))
    synopsis: Mapped[Optional[str]] = mapped_column(Text)
    production_budget_usd: Mapped[Optional[int]] = mapped_column(BigInteger)

    is_franchise: Mapped[Optional[bool]] = mapped_column()
    poster_url: Mapped[Optional[str]] = mapped_column(String(500))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    releases: Mapped[list["Release"]] = relationship(back_populates="film", cascade="all, delete")
    weekly_grosses: Mapped[list["WeeklyGross"]] = relationship(
        back_populates="film", cascade="all, delete"
    )


class Release(Base):
    """One row per (film, release_date). Films can re-release; usually one row per film."""

    __tablename__ = "releases"

    id: Mapped[int] = mapped_column(primary_key=True)
    film_id: Mapped[int] = mapped_column(ForeignKey("films.id", ondelete="CASCADE"), index=True)
    release_date: Mapped[date] = mapped_column(Date, index=True)

    peak_theaters: Mapped[Optional[int]] = mapped_column(Integer)
    open_weekend_gross_usd: Mapped[Optional[int]] = mapped_column(BigInteger)
    total_domestic_gross_usd: Mapped[Optional[int]] = mapped_column(BigInteger)
    weeks_in_release: Mapped[Optional[int]] = mapped_column(Integer)
    is_wide: Mapped[bool] = mapped_column(default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    film: Mapped[Film] = relationship(back_populates="releases")

    __table_args__ = (UniqueConstraint("film_id", "release_date", name="uq_release_film_date"),)


class WeeklyGross(Base):
    """Per-week performance from BOM. Feeds decay-curve fitting and holdover projections."""

    __tablename__ = "weekly_grosses"

    id: Mapped[int] = mapped_column(primary_key=True)
    film_id: Mapped[int] = mapped_column(ForeignKey("films.id", ondelete="CASCADE"), index=True)
    weekend_start: Mapped[date] = mapped_column(Date, index=True)
    week_number: Mapped[int] = mapped_column(Integer)  # raw from BOM — total release-history weeks
    # Derived by us: weeks since the start of this contiguous chart run. Resets to 1 when a
    # film re-emerges after a 4+ week gap (re-releases, expanded re-runs). Use this for
    # decay-curve fitting; BOM's `week_number` is polluted by historical re-releases
    # (e.g. Jaws 1975 → 2024 re-release shows BOM week_number = 2,585).
    run_week_number: Mapped[Optional[int]] = mapped_column(Integer)
    gross_usd: Mapped[Optional[int]] = mapped_column(BigInteger)
    theaters: Mapped[Optional[int]] = mapped_column(Integer)
    rank: Mapped[Optional[int]] = mapped_column(Integer)
    pct_change_vs_prev: Mapped[Optional[float]] = mapped_column(Numeric(8, 4))

    film: Mapped["Film"] = relationship(back_populates="weekly_grosses")

    __table_args__ = (
        UniqueConstraint("film_id", "weekend_start", name="uq_weekly_film_weekend"),
        Index("ix_weekly_weekend_start", "weekend_start"),
    )


class WeekendChart(Base):
    """Industry-level aggregate per weekend. Feeds the heatmap + consistency analysis."""

    __tablename__ = "weekend_charts"

    weekend_start: Mapped[date] = mapped_column(Date, primary_key=True)
    iso_year: Mapped[int] = mapped_column(Integer, index=True)
    iso_week: Mapped[int] = mapped_column(Integer, index=True)
    total_industry_gross_usd: Mapped[Optional[int]] = mapped_column(BigInteger)
    top_film_gross_usd: Mapped[Optional[int]] = mapped_column(BigInteger)
    num_wide_openers: Mapped[Optional[int]] = mapped_column(Integer)
    is_holiday: Mapped[bool] = mapped_column(default=False)
    holiday_name: Mapped[Optional[str]] = mapped_column(String(200))
    school_break_flag: Mapped[Optional[bool]] = mapped_column()
    notes: Mapped[Optional[str]] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Review(Base):
    """RT / Metacritic / IMDb scores per film, from OMDB."""

    __tablename__ = "reviews"

    film_id: Mapped[int] = mapped_column(ForeignKey("films.id", ondelete="CASCADE"), primary_key=True)
    rt_critic: Mapped[Optional[int]] = mapped_column(Integer)
    rt_audience: Mapped[Optional[int]] = mapped_column(Integer)
    metacritic: Mapped[Optional[int]] = mapped_column(Integer)
    imdb_rating: Mapped[Optional[float]] = mapped_column(Numeric(3, 1))
    imdb_votes: Mapped[Optional[int]] = mapped_column(Integer)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ForwardSchedule(Base):
    """Announced future wide releases — refreshed every 6h via Vercel Cron."""

    __tablename__ = "forward_schedule"

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(50))  # 'the_numbers'
    source_id: Mapped[str] = mapped_column(String(100))

    film_id: Mapped[Optional[int]] = mapped_column(ForeignKey("films.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(500))
    release_date: Mapped[date] = mapped_column(Date, index=True)
    distributor: Mapped[Optional[str]] = mapped_column(String(200))
    format_flags: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String))
    genres: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String))
    synopsis: Mapped[Optional[str]] = mapped_column(Text)

    is_scheduled: Mapped[bool] = mapped_column(default=True)  # tombstone on removal
    content_hash: Mapped[Optional[str]] = mapped_column(String(64))

    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (UniqueConstraint("source", "source_id", name="uq_fwd_source"),)


class ScrapeJob(Base):
    """Per-source freshness marker. One row per logical job; used for cron coordination."""

    __tablename__ = "scrape_jobs"

    source: Mapped[str] = mapped_column(String(100), primary_key=True)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="idle")  # idle | running | failed
    items_updated: Mapped[Optional[int]] = mapped_column(Integer)
    error: Mapped[Optional[str]] = mapped_column(Text)


class Embedding(Base):
    """Film embeddings for cannibalization (audience-overlap) similarity."""

    __tablename__ = "embeddings"

    film_id: Mapped[int] = mapped_column(
        ForeignKey("films.id", ondelete="CASCADE"), primary_key=True
    )
    model: Mapped[str] = mapped_column(String(100), primary_key=True)
    vector: Mapped[list[float]] = mapped_column(JSON)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
