// Holdout-style backtest using Spearman rank correlation.
//
// For each indie-tier film released in 2022-2024 (with opening_usd recorded):
//   1. Build a CandidateFilm from its metadata + LLM tags.
//   2. Score every weekend in ±12 weeks of its ACTUAL release date,
//      using a synthesized forward schedule of same-year peers (excluding the film).
//   3. Compute Spearman ρ between our aggregated_score and the historical peer
//      median opener for those ISO weeks (from weekly_indie).
//
// Limitations (surfaced in UI):
//   - peer median is computed across 2015-25 incl. the film's own year (not a strict holdout).
//   - opening_norm dominates the score by construction → ρ has a built-in positive bias.
//     The backtest's job is to show that legs + competition discount don't actively destroy
//     this ranking, not to claim independent predictive power.

import {
  scoreClient,
  normalizeWeights,
  type ClientScoreDeps,
} from "@/lib/scoring/score-client";
import { PRESETS, presetForGenres, type PresetKey } from "@/lib/scoring/presets";
import type {
  FilmIndex,
  FilmIndexItem,
  FilmTags,
  ForwardItem,
  ForwardSchedule,
} from "@/lib/types";
import type { CandidateFilm } from "@/lib/scoring/types";

// Backtest needs the live scorer's deps plus the historical film index + LLM tags
// for selecting eligible films and decorating the candidate profile. Same shape the
// live UI uses; nothing custom.
export type ScoreDeps = ClientScoreDeps & {
  filmIndex: FilmIndex;
  filmTags: FilmTags;
};

export type BacktestFilm = {
  film_id: number;
  title: string;
  year: number;
  iso_week: number;
  release_date: string;
  distributor: string | null;
  opening_usd: number;
  rho: number;
  n_candidates: number;
  recommended_iso_week: number;
  recommended_label: string;
  preset: string;
};

export type PresetStats = {
  preset: PresetKey;
  n_films: number;
  median_rho: number;
  weights: { opening: number; legs: number; competition: number };
};

export type BacktestResult = {
  films: BacktestFilm[];
  summary: {
    n_films: number;
    median_rho: number;
    mean_rho: number;
    pct_positive: number;
    pct_strong: number; // |ρ| ≥ 0.5
  };
  // Per-preset breakdown — each film is scored with the weights its genre auto-assigns,
  // so we can see if any preset's weights underperform the overall median.
  per_preset: PresetStats[];
};

function indexToForward(f: FilmIndexItem): ForwardItem {
  return {
    id: f.id,
    film_id: f.id,
    title: f.title,
    release_date: f.release_date,
    iso_week: f.iso_week,
    distributor: f.distributor,
    tier: f.tier,
    format_flags: null,
    synopsis: null,
    genres: f.genres,
    mpaa: f.mpaa,
    poster_url: f.poster_url,
    runtime_minutes: f.runtime_minutes,
    is_franchise: f.is_franchise,
  };
}

function dateAddWeeks(dateIso: string, weeks: number): string {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function rank(arr: number[]): number[] {
  const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = Array(arr.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

function spearman(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

const WINDOW = 12;
const TARGET_YEARS = new Set([2022, 2023, 2024]);

export function runBacktest(deps: ScoreDeps): BacktestResult {
  const indieWeekByIso = new Map(deps.weeklyIndie.weeks.map((w) => [w.iso_week, w]));

  const eligible = deps.filmIndex.items.filter(
    (f) =>
      f.tier === "indie" &&
      TARGET_YEARS.has(f.year) &&
      f.opening_usd !== null &&
      f.opening_usd > 0 &&
      f.iso_week > 0
  );

  const filmsResult: BacktestFilm[] = [];

  for (const film of eligible) {
    const tags = deps.filmTags[String(film.id)];
    if (!tags?.genre_tags || !tags?.audience_tags) continue;

    const candidate: CandidateFilm = {
      title: film.title,
      tier: "indie",
      mpaa: film.mpaa,
      genres: film.genres ?? [],
      genre_tags: tags.genre_tags,
      audience_tags: tags.audience_tags,
    };

    // Forward = same-year peers within ±WINDOW weeks of actual release, excluding this film.
    const peers = deps.filmIndex.items.filter(
      (f) =>
        f.id !== film.id &&
        f.year === film.year &&
        Math.abs(f.iso_week - film.iso_week) <= WINDOW
    );
    const syntheticForward: ForwardSchedule = {
      items: peers.map(indexToForward),
      months_ahead: 6,
    };

    const backtestDeps: ClientScoreDeps = {
      forward: syntheticForward,
      decay: deps.decay,
      legs: deps.legs,
      weeklyIndustry: deps.weeklyIndustry,
      weeklyIndie: deps.weeklyIndie,
    };

    // Candidate weekends: every Friday ±WINDOW weeks of film.release_date.
    const weekends: string[] = [];
    for (let delta = -WINDOW; delta <= WINDOW; delta++) {
      weekends.push(dateAddWeeks(film.release_date, delta));
    }

    // Each film is scored with its own genre-assigned preset weights — same logic the
    // live UI applies. Per-preset rho aggregation reveals whether any preset's weights
    // underperform the overall.
    const presetKey: PresetKey = presetForGenres(candidate.genres, candidate.genre_tags);
    const presetWeights = normalizeWeights(PRESETS[presetKey].weights);

    // Fix #2: baseline tracks the candidate's tier. The backtest only ranks indie films,
    // so this is always "indie" — but pinning it to film.tier keeps the contract identical
    // to the live UI.
    const result = scoreClient(candidate, weekends, presetWeights, backtestDeps, {
      baselineTier: candidate.tier,
    });

    const scores: number[] = [];
    const realized: number[] = [];
    for (const w of result) {
      const wk = indieWeekByIso.get(w.iso_week);
      if (!wk || wk.n_years < 3) continue;
      scores.push(w.aggregated_score);
      realized.push(wk.median_opener_gross_usd);
    }
    if (scores.length < 5) continue;

    const rho = spearman(scores, realized);
    const best = result.reduce((a, b) =>
      b.aggregated_score > a.aggregated_score ? b : a
    );

    filmsResult.push({
      film_id: film.id,
      title: film.title,
      year: film.year,
      iso_week: film.iso_week,
      release_date: film.release_date,
      distributor: film.distributor,
      opening_usd: film.opening_usd ?? 0,
      rho,
      n_candidates: scores.length,
      recommended_iso_week: best.iso_week,
      recommended_label: best.label,
      preset: presetKey,
    });
  }

  filmsResult.sort((a, b) => b.rho - a.rho);

  const rhos = filmsResult.map((f) => f.rho);
  const sorted = [...rhos].sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const mean = rhos.length === 0 ? 0 : rhos.reduce((a, b) => a + b, 0) / rhos.length;

  // Per-preset stats.
  const presetGroups = new Map<PresetKey, BacktestFilm[]>();
  for (const f of filmsResult) {
    const k = f.preset as PresetKey;
    if (!presetGroups.has(k)) presetGroups.set(k, []);
    presetGroups.get(k)!.push(f);
  }
  const per_preset: PresetStats[] = [];
  for (const [preset, films] of presetGroups) {
    const rhos = films.map((f) => f.rho).sort((a, b) => a - b);
    const med = rhos.length % 2 === 1
      ? rhos[(rhos.length - 1) / 2]
      : (rhos[rhos.length / 2 - 1] + rhos[rhos.length / 2]) / 2;
    per_preset.push({
      preset,
      n_films: films.length,
      median_rho: med,
      weights: PRESETS[preset].weights,
    });
  }
  per_preset.sort((a, b) => b.median_rho - a.median_rho);

  return {
    films: filmsResult,
    per_preset,
    summary: {
      n_films: filmsResult.length,
      median_rho: median,
      mean_rho: mean,
      pct_positive: rhos.length === 0 ? 0 : rhos.filter((r) => r > 0).length / rhos.length,
      pct_strong: rhos.length === 0 ? 0 : rhos.filter((r) => Math.abs(r) >= 0.5).length / rhos.length,
    },
  };
}

let cached: BacktestResult | null = null;
export function getBacktest(deps: ScoreDeps): BacktestResult {
  if (cached) return cached;
  cached = runBacktest(deps);
  return cached;
}
