# Marquee scraper

Python pipeline that ingests box-office and release-schedule data from public sources into Postgres.

## Sources

| Source | What we pull | Refresh |
|---|---|---|
| Box Office Mojo | 10-year weekend charts + per-film weekly grosses | One-shot historical, run locally |
| The Numbers | Forward US wide-release schedule | Every 6h via Vercel Cron |
| TMDb (API) | Synopsis, genres, cast, director, budget, posters | On enrichment |
| OMDB (API) | Rotten Tomatoes + Metacritic scores | On enrichment |

## Quickstart

```bash
# Setup
uv venv && source .venv/bin/activate
uv pip install -e ".[dev]"
cp .env.example .env  # fill in credentials

# Initialize schema
marquee db init

# One-shot historical backfill (~2 hours, polite rate)
marquee backfill --years 10

# Refresh forward schedule (fast, idempotent — also runs on cron)
marquee refresh
```

## Architecture notes

- **Fetcher vs parser are separate.** Every HTTP response is cached to `cache/` as raw HTML keyed by URL. Re-running the parser does not re-hit the source.
- **Idempotent upserts.** Every row has `(source, source_id)` as a composite unique key; `content_hash` gates writes so unchanged rows aren't touched.
- **Concurrency-safe.** Postgres advisory locks prevent two scrapes from racing.
- **Freshness-aware.** `scrape_jobs` tracks `last_success_at` per source; jobs no-op if recent.
- **Polite by default.** 1 req/sec jittered, identifiable User-Agent, exponential backoff on errors.
