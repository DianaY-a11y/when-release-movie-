# Slate Setter

**A release-week decision tool for theatrical distribution teams.**

Slate Setter helps an internal studio team reason about *when* to open a film. It takes a
film profile (genre, rating, distributor tier, AI-derived audience tags) and lays its
**competitive and seasonal landscape** across the upcoming year — so a distribution team can
find open windows, compare candidate weekends, and defend a date with evidence.

It is deliberately a **thinking tool, not an oracle.** It does not pick a single "best
date." It surfaces the landscape and the tradeoffs and lets domain experts apply the
judgment the model can't have (talent availability, festival strategy, marketing spend,
competitive intel).

---

## Table of contents

1. [Product design](#product-design)
2. [The four surfaces](#the-four-surfaces)
3. [The scoring model](#the-scoring-model)
4. [System architecture](#system-architecture)
5. [The data pipeline](#the-data-pipeline)
6. [Web app internals](#web-app-internals)
7. [Running it](#running-it)
8. [Design decisions & tradeoffs](#design-decisions--tradeoffs)
9. [Known limitations](#known-limitations)

---

## Product design

### The core thesis: insight over recommendation

A "best time to release" tool has a gravitational pull toward becoming a magic 8-ball. But the
users here are experts — a recommendation engine they can't see into is something they'll
distrust and resent. So every surface is built on a few principles:

- **Show the landscape, not the verdict.** Lead with the competitive field and seasonal demand;
  let a good window become *visually obvious* rather than asserted.
- **Aggregate the noise, name the signal.** The slate has hundreds of upcoming titles; only a
  handful actually compete for any given film's audience. The landscape collapses the whole
  field into an overlap-weighted curve and names only the direct competitors.
- **Decompose every score.** Wherever a number appears, the components behind it are
  inspectable (the radar, the drill-in bars, the hover math). Insight lives in the breakdown.
- **Comparison over prescription.** Experts decide between a few finalists. The Compare surface
  puts candidate weekends side by side and spells out the tradeoff in words — no composite rank.
- **Show your work.** A dedicated Backtest surface validates the model against a decade of real
  releases and is candid about the limits of that validation.

### Who it's for

An internal theatrical-distribution / release-planning team at a studio. The mental model
assumes the user is a domain expert pressure-testing or discovering a release window, not a
layperson who needs to be told the answer.

---

## The four surfaces

The app is one product with four navigation surfaces, each with a distinct job. They share a
single **active film** and a single **compare shortlist**, so they hand off rather than overlap.

| Surface | Route | Job | Requires a film? |
|---|---|---|---|
| **Landscape** | `/` | Explore the field & seasonality; find white space; build a shortlist | No (seasonality works film-free; competition layer needs a film) |
| **Compare** | `/compare` | Weigh up to 4 shortlisted weekends side by side | Yes |
| **Film Profile** | `/film-profile` | Upload / edit the film; see its closest historical analogs | Creates one if none |
| **Backtest** | `/backtest` | Validate the scoring model against real history | No |

### Landscape (`/`)

The planning surface. A unified filter panel (scoring **weights**, genre **preset**, and
**Type / Studio / Rating** filters) drives two interchangeable views of the next 8–52 weeks:

- **Grid** — a calendar of weekends, each cell colored by score. "Color by" can be peer-median
  opener strength (film-free seasonality), competition pressure, or combined fit.
- **Graph** (`CongestionGraph`) — the competitive landscape as a single chart: **seasonal
  demand** on top, and below it the **whole slate's competition collapsed into an
  overlap-weighted curve**. A light band is total similarity-weighted competition; a dark band
  is *same-audience* clash; troughs in the dark band are the white space. Only **direct
  competitors** (similarity ≥ `SIM_THRESHOLDS.clash` = 0.45) get named as cells at their opening
  week, with a holdover tail trailing right. The chart is **zoomable** via a drag-bar scrubber,
  weeks are clickable to add to the comparison set, and named competitor cells open a detail
  modal.

**Curated distributor universe.** The Type filter has two buttons: **All** restricts to a
curated 22-distributor universe — A24, Universal, Disney, Warner Bros, Paramount, Sony, MGM,
Lionsgate, 20th Century Fox, Neon, Focus Features, Searchlight, Angel Studios, Vertical
Entertainment, Bleecker Street, Magnolia Pictures, Ketchup Entertainment, Black Bear Pictures,
Icon Film Distribution, Godzilla Kingdom Inc., BBE, CNV. **Indie / Prestige** further narrows
to the 7-distributor prestige subset (A24, Neon, Focus Features, Searchlight, Bleecker Street,
Magnolia Pictures, Black Bear Pictures). Films from distributors outside the universe
(Fathom Entertainment, Netflix, Kino Lorber, Iconic Releasing, Roadside Attractions, etc.) are
excluded from every Type button. See `lib/distributors.ts`. This filter only applies to
upcoming releases; historical peer-median signals (`weekly_indie.json`, `weekly_industry.json`)
use the scraper's original distributor definitions.

Below the chart sits **LandscapeInsights** — the comparable-titles scatter (similar films
plotted by release week × opening gross, sized by similarity) plus a radar **drill-in** for a
focused weekend. A **CandidateBar** ("Comparing · chips · N/4 · Clear · Compare →") summarizes
the shortlist on both grid and graph views.

### Compare (`/compare`)

The selected weekends (max 4) scored live with the same engine and laid out as columns:

- a row per sub-criterion (**Demand, Openness, Low clash, Comp record**) as score bars,
- a **radar** per weekend so the shape of each tradeoff reads at a glance,
- a per-weekend **analysis card** with a descriptive prose summary and the named films competing
  for the same audience that weekend.

Cards are removable (`×`); there is intentionally **no composite ranking** — the tool surfaces
tradeoffs, the distribution team makes the call. `/compare` is a thin route that redirects to
the home page anchored at `#compare-weekends`, where the comparison surface lives inline below
the Landscape view.

### Film Profile (`/film-profile`)

The film input and reference. With no film selected, it *is* the upload surface (drag a
one-sheet → AI extraction, or fill fields manually + generate an AI audience profile). With a
film selected, it shows the profile summary, comp stats (count, median opening, median
multiple), the **similar-films opening-gross scatter**, and a table of closest analogs. An
inline editor lets you edit or re-upload.

### Backtest (`/backtest`)

Model validation. Replays the **live scoring engine** (the same `scoreClient` that powers the
Landscape grid and the Compare cards) against real indie films from 2022–2024: for each, it
scores every weekend ±12 weeks of the actual release against that film's real same-year peers,
then measures **Spearman rank correlation (ρ)** between the model's weekend ranking and how
those weeks historically performed. Each film is scored using its **genre-assigned preset
weights** — the same logic the live UI applies — so the per-preset breakdown surfaces whether
any preset's weights underperform. Reports median ρ, % positive, % strong (|ρ| ≥ 0.5), a ρ
histogram, and per-preset stats, with explicit caveats about built-in bias.

---

## The scoring model

Everything keys off one similarity function and one per-weekend aggregate.

### Similarity — `lib/scoring/similarity.ts`

`similarity(film, other) ∈ [0, 1]` blends:

| Feature | Weight | Notes |
|---|---|---|
| Genre (Jaccard) | 0.35 | Box-office genre overlap |
| MPAA proximity | 0.15 | Exact = 1.0, one step away (e.g. R↔PG-13) = 0.5 |
| Distributor tier | 0.15 | Same = 1.0, indie↔major = 0.5, unknown = 0 |
| LLM tags | 0.35 | Jaccard of audience + genre tags |

Forward-schedule competitors rarely have LLM tags, so when `other` has none, the LLM weight
**folds back into genre** (genre effectively weighs 0.70) instead of silently zeroing 35%.

**Centralized thresholds.** Bucket thresholds live in `SIM_THRESHOLDS` (`similarity.ts`):
`clash = 0.45` (the red-flag highlight + same-audience band threshold) and `some = 0.28` (a
softer "competitor worth surfacing" cutoff). The calendar grid, the CongestionGraph, the
side-panel red-flag highlight, and the radar sub-scores all read from this single source.

### Per-weekend aggregate — `lib/scoring/score-client.ts`

For each candidate weekend:

- **opening_norm** — peer-median opening-weekend gross for that ISO week & tier (seasonality).
- **legs_norm** — peer-median multiplier (total ÷ opening) for comparable films near that week.
- **competition** — sum over every film still in release of `similarity × share`, then mapped
  through an **auto-tuned absolute sigmoid**:

  ```
  raw         = Σ over active films  sim(film, c) · share(c)
  midpoint    = median raw competition_index across the next 52 weekends
  competition = raw / (raw + midpoint)        # 0..1, absolute (not min-max)
  ```

  `share` = 1 if `c` opens that weekend, else its **holdover retention** (a film that opened
  earlier still occupies attention, decayed by a per-genre/tier curve — see `lib/holdovers.ts`).

  The midpoint is computed **per candidate film** by `computeMidpoint(film, deps)`: a niche
  candidate sees a lower midpoint (so a few similar films still register as crowded), a
  broadly-competing candidate sees a higher one (so the gradient doesn't wash out red). This is
  an upgrade over the previous fixed `COMP_MIDPOINT = 1.0` constant.

- **aggregated_score** = `w_open · opening_norm + w_legs · legs_norm − w_comp · competition`.

The **same-audience clash** band (and the "direct competitor" cells) re-sums only the
contributions of films with `similarity ≥ SIM_THRESHOLDS.clash`.

### One scorer, on purpose

`score-client.ts` is the single source of truth — it powers the live UI, the CongestionGraph
clash band, the radar sub-scores, **and** the backtest. The backtest imports `scoreClient`
directly (it's pure JS and runs fine in Node), so validation runs against the exact model
shipping to users. There is intentionally no parallel server scorer to drift out of sync.

`baseline_tier` always tracks the candidate's tier (`film.tier`). The Type / Studio / Rating
filters narrow the visible competitor set; they never re-baseline which historical peer median
the candidate is judged against.

---

## System architecture

```
┌─────────────────────────┐   marquee analyze ...     ┌──────────────────────┐
│  scraper/ (Python)       │   →  scraper/data/*.json  │  publish.sh          │
│  "marquee" CLI           │ ────────────────────────► │  copies snapshots    │
│  Box Office Mojo · The   │                           │  → web/public/data/  │
│  Numbers · TMDb · OMDB   │                           │  + meta.json         │
│  → Postgres              │                           └──────────┬───────────┘
└─────────────────────────┘                                      │
                                          read at request time   │  (static JSON)
                                                                 ▼
                              ┌───────────────────────────────────────────────┐
                              │  web/ (Next.js 16 · React 19 · Tailwind v4)     │
                              │                                                 │
                              │  Server components ── load snapshots ──┐        │
                              │                                        ▼        │
                              │  Client components ◄── deps props ── render     │
                              │    · active film (localStorage)                 │
                              │    · scoreClient() in-browser                   │
                              │    · /api/* for heavy / secret work             │
                              └───────────────────────────────────────────────┘
```

The split is deliberate: **the scraper owns truth and history** (heavy, batch, Postgres) and
emits **immutable JSON snapshots**; the **web app is read-only over those snapshots** and does
all film-specific scoring at the edge/in the browser. The web app never touches Postgres.

---

## The data pipeline

The `scraper/` package ("marquee") ingests public data into Postgres, then derives the JSON
snapshots the web app reads.

**Sources**

| Source | Pulled | Refresh |
|---|---|---|
| Box Office Mojo | 10-yr weekend charts + per-film weekly grosses | One-shot historical backfill |
| The Numbers | Forward US wide-release schedule | Every 6h (cron) |
| TMDb | Synopsis, genres, cast, budget, posters | On enrichment |
| OMDB | Rotten Tomatoes + Metacritic | On enrichment |

It's idempotent (`(source, source_id)` + `content_hash` gate writes), cache-first (raw HTML
cached so re-parsing doesn't re-hit sources), concurrency-safe (Postgres advisory locks), and
polite (1 req/s jittered, backoff).

**Snapshots** (`marquee analyze ...` → `scraper/data/`, copied by `publish.sh` →
`web/public/data/`):

| File | Powers |
|---|---|
| `weekly_industry.json` / `weekly_indie.json` | Seasonal demand, peer-median openers, legs |
| `legs.json` | Per-week multipliers + high-multiplier comp films |
| `decay_curves.json` | Per genre/tier holdover retention curves |
| `forward_schedule.json` | Upcoming releases (the competitive field) |
| `film_index.json` | Historical film library (for comps + backtest) |
| `film_tags.json` | LLM genre/audience tags per library film |
| `embeddings.json` | (optional) feature vectors |
| `meta.json` | Freshness timestamp (written by `publish.sh`) |

The web app reads these at **request time** from `public/data/` (`lib/data/load.ts`), so a
`publish.sh` re-run is picked up without a rebuild.

---

## Web app internals

**Stack:** Next.js 16 (App Router, Turbopack), React 19, Tailwind v4, TypeScript. ⚠️ This is a
newer Next.js than common training data — see `web/AGENTS.md`; read the bundled docs under
`node_modules/next/dist/docs/` before changing routing/rendering conventions.

**Routes**

```
/              Landscape   → Calendar (grid / graph) + Compare (inline at #compare-weekends)
/compare       redirects   → /#compare-weekends
/film-profile  Film Profile→ upload / edit + analogs
/backtest      Backtest    → ρ validation
/calendar, /film            legacy redirects
```

**State & data flow**

- **Active film** lives in `localStorage` (`lib/film-store.ts`) behind a React context
  (`lib/film-context.tsx`, `FilmProvider` in the root layout). Because the film is client-only,
  **scoring happens in the browser** via `scoreClient` — server components can't know it.
- **Snapshots** are loaded by server components/route handlers and passed down as `deps` props
  (`ClientScoreDeps`) to client components. The heavy `film_index` + `film_tags` (~1.6 MB) stay
  server-side behind `/api/comparable` rather than shipping to every browser.
- **Compare shortlist** is a context (`lib/compare-selection.tsx`, max 4) shared across views so
  the grid `＋`, the graph clicks, and the drill-in "Add to shortlist" all build one set.

**API routes** (`app/api/*`)

| Route | Does |
|---|---|
| `/api/comparable` | Top-N library analogs for a film (keeps the big snapshots server-side) |
| `/api/profile` | Claude (Haiku) turns a synopsis into genre/audience tags + a profile blurb |
| `/api/extract` | Parses an uploaded PDF/DOCX/TXT one-sheet into film fields |

There is intentionally **no `/api/score`** — scoring is done client-side via `scoreClient`,
and the backtest imports the same function directly. One engine, one source of truth.

**Shared model & viz layer**

- `lib/wireframe-data.ts` — the adapters that turn raw scorer output into view shapes:
  `buildDemand`, `buildCompetitors`, `directCompetitors`, `congestionSeries`, `toCandidate`
  (the four 0–100 sub-scores), `competitorSimDetail` (the modal's breakdown).
- `components/wireframe/useModel.ts` — `useWireframeModel(deps)`: scores the next 52 Fridays
  once and exposes demand / competitors / candidates / comparables to every surface.
- `components/wireframe/Radar.tsx`, `components/wireframe/insights.tsx`
  (`CompScatter`, `DrillIn`), `components/CandidateBar.tsx` — shared so Landscape, Compare, and
  Film Profile render identical pieces from one source of truth.

**Charts & design system**

Bespoke visualizations are **hand-rolled with SVG/divs** in an editorial palette
(`--color-paper / ink / muted / line / accent`, Geist fonts) rather than a charting library, to
keep full control of the look and interactions (the congestion curve, radar, scatter, zoom
brush, hover column). `recharts` is available for anything standard.

---

## Running it

**Web app** (the part you'll usually run):

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

The app renders against whatever snapshots are in `web/public/data/`. Pick or upload a film
from the header selector to light up the film-specific layers.

**Refreshing data** (requires the scraper set up with Postgres + API keys — see
`scraper/README.md`):

```bash
cd scraper
marquee refresh          # update forward schedule
marquee analyze all      # regenerate snapshots into scraper/data/
./publish.sh             # copy snapshots into web/public/data/ + write meta.json
```

`web/.env.local` needs `ANTHROPIC_API_KEY` for the AI profile/extract routes.

---

## Design decisions & tradeoffs

- **Insight-first, recommendation-last.** The congestion curve replaced an earlier "wall of
  pills" because enumerating 40 non-competing films *was the noise*; the curve aggregates
  magnitude and names only same-audience threats. Compare deliberately omits a composite rank.
- **One scoring engine.** `scoreClient` is the single source of truth — it powers the live UI
  *and* the backtest. The backtest's published ρ measures the model actually shipping to users,
  not a parallel server version that drifts out of sync.
- **Auto-tuned competition midpoint.** The absolute sigmoid's midpoint is computed
  per-candidate as the median raw `competition_index` across the next 52 weekends, so the color
  gradient adapts to how competitive a candidate's genre is rather than washing out the same
  way for everyone.
- **Curated distributor universe.** Forward-release filtering uses a hand-picked 22-distributor
  universe (`lib/distributors.ts`) instead of the scraper's open-ended distributor field, so
  the slate visible on the calendar matches the slate a planner cares about. Historical
  peer-median signals keep the scraper's original definitions — past data is past data.
- **Browser-side scoring.** Because the film profile is private/local, scoring runs client-side;
  only the heavy historical library stays server-side behind `/api/comparable`.
- **Prominence/overlap heuristics.** Forward-schedule films lack opening projections and LLM
  tags, so "release scale" is approximated from tier + franchise + format, and similarity folds
  the LLM weight into genre when the other film has no tags. These are explicit, documented
  approximations — see the footnote on the CongestionGraph.
- **Snapshots over a live DB.** The web app is stateless over immutable JSON — trivially
  cacheable, deployable, and decoupled from the scrape cadence.

---

## Known limitations

- **Backtest bias.** The score is dominated by opening strength and is validated *against*
  historical opening strength, so ρ has a built-in positive bias; the peer median isn't a strict
  holdout. The backtest shows the legs + competition terms don't *break* the ranking, not that
  the model has independent predictive power.
- **Forward competitors are thin.** Upcoming releases have no box-office projection and usually
  no LLM tags, limiting how precisely "scale" and "overlap" can be estimated.
- **Single-film, single-user.** The film library is per-browser `localStorage`; there's no
  multi-user or multi-title slate planning yet.
- **Editing creates a new profile.** Saving an edit on the Film Profile page currently writes a
  new library entry and makes it active rather than updating in place.

---

## Future steps

The current split is deliberate: a **Postgres-backed Python pipeline** (`scraper/`) does the
heavy scraping/analysis and emits immutable JSON snapshots; `publish.sh` copies those into the
web app, which is **stateless over static files**. That's the right shape for a read-mostly tool
refreshed in batches. Here's how I'd evolve the data + server layers as it grows.

### Data

- **Schedule the refresh.** Move `marquee refresh && analyze all && publish` onto a nightly cron
  / GitHub Action so the snapshots stay current without a human running it.
- **Promote per-user state off `localStorage`.** Saved films, shortlists, and weight/filter
  presets are browser-local today. To share them across devices and teammates, persist them in a
  table (the pipeline already runs a Postgres — reuse it) behind a thin auth layer. This also
  unblocks shareable scenario links and "editing updates in place" instead of forking a profile.

### Server

- **Add a small persistence API** for films/scenarios (CRUD over the shared Postgres) once state
  moves server-side. Keep candidate **scoring client-side** — the film profile is private and the
  math is cheap — unless we want server-rendered shareable links, in which case scenarios get
  persisted and scored on read.


### On scale (and why CAP barely matters here)

This is an **internal tool for a handful of analysts**, not a public service, so the classic
CAP / distributed-systems tradeoffs don't drive the design. A **single managed Postgres in one
region** is more than enough; we'd favor consistency + operational simplicity over availability,
partition tolerance, or global scale. The data is read-mostly and refreshed in batches, so
staleness is acceptable and there are essentially no concurrent-write conflicts to reconcile —
no need for multi-region replication, eventual-consistency caches, or sharding. If usage ever
broadened to a public/high-traffic surface, *then* availability and caching strategy would
become first-class concerns.
