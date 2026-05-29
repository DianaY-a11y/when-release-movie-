// Real-data adapters for the Compare page and Film Profile drill-in.
// These translate the live scoring outputs (scoreClient) and snapshot data into the
// shapes the wireframe visuals expect. All numbers here trace back to the same
// pipeline the calendar/compare surfaces use — nothing is mocked.

import { absCompNorm, passesCompetitorFilter, scoreClient, type ClientScoreDeps, type CompetitorFilter } from "./scoring/score-client";
import { similarity } from "./scoring/similarity";
import { matchesCategoryFilter } from "./distributors";
import { activeFilmsOn, isoWeekOf } from "./holdovers";
import type { CandidateFilm, CompetitorSlot, WeekendScore, Weights } from "./scoring/types";
import type { DecayCurves, FilmIndexItem, ForwardSchedule, ForwardItem, WeeklyPayload } from "./types";

export type Overlap = "high" | "some" | "none";

// Re-exports the canonical thresholds from similarity.ts so the rest of this file can
// keep using local names while staying in sync with WeekendGrid's red-flag threshold.
import { SIM_THRESHOLDS } from "./scoring/similarity";
const HIGH = SIM_THRESHOLDS.clash;
const SOME = SIM_THRESHOLDS.some;
export const CLASH_SIM = SIM_THRESHOLDS.clash;

export function overlapOf(sim: number): Overlap {
  return sim >= HIGH ? "high" : sim >= SOME ? "some" : "none";
}

export const OVERLAP_STYLE: Record<Overlap, { fill: string; label: string }> = {
  high: { fill: "rgba(183,58,43,0.92)", label: "High overlap with your audience" },
  some: { fill: "rgba(183,58,43,0.40)", label: "Some overlap" },
  none: { fill: "var(--color-soft)", label: "No overlap" },
};

export const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ── Demand strip ────────────────────────────────────────────────────────────
// The genuine seasonality curve: per-ISO-week peer-median opener strength,
// collapsed to a single 52-week strip (same data the heatmap shades by).
export interface DemandPoint {
  week: number; // iso week 1..52
  value: number; // 0..100 (opening_norm)
  grossUsd: number;
  holiday: string | null;
}

export function buildDemand(weekly: WeeklyPayload): DemandPoint[] {
  return [...weekly.weeks]
    .sort((a, b) => a.iso_week - b.iso_week)
    .map((w) => ({
      week: w.iso_week,
      value: Math.round((w.opening_norm ?? 0) * 100),
      grossUsd: w.median_opener_gross_usd,
      holiday: w.holiday,
    }));
}

function medianOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Genre-specific seasonal demand, recomputed from the per-film index: per-ISO-week median
// opening gross for films in `tier` whose genres include ANY of `genres` (OR), then min-max
// normalized across the 52 weeks. Uses the base payload's min-gross floor + excluded years
// so it stays comparable to the precomputed all-genres curve. Returns the plain `buildDemand`
// output when no genre is selected. Sparser than the precomputed payload → noisier.
export function buildDemandForGenres(
  items: FilmIndexItem[],
  tier: "industry" | "indie",
  genres: string[],
  base: WeeklyPayload
): DemandPoint[] {
  if (genres.length === 0) return buildDemand(base);

  const minGross = base.min_opener_gross_usd;
  const excluded = new Set(base.excluded_years);
  const sel = new Set(genres.map((g) => g.toLowerCase()));
  const holidayByIso = new Map(base.weeks.map((w) => [w.iso_week, w.holiday]));

  const grossByIso = new Map<number, number[]>();
  for (const f of items) {
    if (f.tier !== tier) continue;
    if (f.opening_usd == null || f.opening_usd < minGross) continue;
    if (excluded.has(f.year)) continue;
    if (!(f.genres ?? []).some((x) => sel.has(x.toLowerCase()))) continue;
    const arr = grossByIso.get(f.iso_week);
    if (arr) arr.push(f.opening_usd);
    else grossByIso.set(f.iso_week, [f.opening_usd]);
  }

  const medians: number[] = [];
  for (let i = 1; i <= 52; i++) medians.push(medianOf(grossByIso.get(i) ?? []));
  const max = Math.max(...medians, 0);
  const min = Math.min(...medians);
  const span = max - min || 1;

  return medians.map((med, idx) => ({
    week: idx + 1,
    value: Math.round(((med - min) / span) * 100),
    grossUsd: med,
    holiday: holidayByIso.get(idx + 1) ?? null,
  }));
}

// ── Competitive field ───────────────────────────────────────────────────────
export interface Competitor {
  id: number;
  name: string;
  week: number; // iso week of release
  date: string;
  overlap: Overlap;
  sim: number;
  prominence: number; // 0..~1.5 — proxy for scale of release
  tier: string;
  distributor: string | null;
}

// Forward-schedule entries carry no opening projection, so approximate a film's
// market weight from distributor tier, franchise status and release breadth.
function prominence(f: ForwardItem): number {
  let p = f.tier === "industry" ? 1 : f.tier === "indie" ? 0.6 : 0.35;
  if (f.is_franchise) p *= 1.4;
  const flags = (f.format_flags || []).map((x) => x.toLowerCase());
  if (flags.some((x) => x.includes("limited"))) p *= 0.45;
  if (flags.some((x) => x.includes("wide") || x.includes("imax"))) p *= 1.25;
  return Math.min(1.5, p);
}

export function buildCompetitors(
  film: CandidateFilm,
  forward: ForwardItem[],
  maxItems = 60
): Competitor[] {
  return forward
    .map((f) => {
      const sim = similarity(film, { tier: f.tier, mpaa: f.mpaa, genres: f.genres });
      return {
        id: f.id,
        name: f.title,
        week: f.iso_week,
        date: f.release_date,
        overlap: overlapOf(sim),
        sim,
        prominence: prominence(f),
        tier: f.tier,
        distributor: f.distributor,
      };
    })
    // Keep the readable field: anything that competes for our audience, or any
    // sizeable wide release. Drops the long tail of tiny unknown-tier limiteds.
    .filter((c) => c.overlap !== "none" || c.prominence >= 0.6)
    .sort((a, b) => b.prominence - a.prominence)
    .slice(0, maxItems);
}

// ── Candidate windows (shortlist) ───────────────────────────────────────────
export interface SubScores {
  demand: number;
  openness: number;
  lowClash: number;
  comps: number;
}

export interface CandidateModel {
  date: string; // ISO
  label: string;
  week: number;
  sub: SubScores; // all 0..100, higher = more favorable
  raw: { demandUsd: number; pressure: number; clash: number };
  inWindow: { title: string; weekN: number; overlap: Overlap }[];
  flags: { tone: "good" | "warn" | "note"; text: string }[];
}

export const SUB_LABELS: { key: keyof SubScores; label: string; hint: string }[] = [
  { key: "demand", label: "Demand", hint: "Peer-median opener strength for the week" },
  { key: "openness", label: "Openness", hint: "Inverse of total competitive pressure" },
  { key: "lowClash", label: "Low clash", hint: "Inverse of same-audience overlap" },
  { key: "comps", label: "Comp record", hint: "Peer-median legs (multiplier) in this window" },
];

function clashNormFromSlots(slots: CompetitorSlot[], midpoint: number): number {
  const raw = slots
    .filter((s) => s.similarity >= CLASH_SIM)
    .reduce((sum, s) => sum + s.contribution, 0);
  return absCompNorm(raw, midpoint);
}

export function labelOf(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function toCandidate(row: WeekendScore, midpoint: number): CandidateModel {
  const clashNorm = clashNormFromSlots(row.competition_top, midpoint);
  const sub: SubScores = {
    demand: Math.round(row.components.opening_norm * 100),
    openness: Math.round((1 - row.components.competition_norm) * 100),
    lowClash: Math.round((1 - clashNorm) * 100),
    comps: Math.round(row.components.legs_norm * 100),
  };
  const inWindow = row.competition_top
    .filter((s) => s.similarity >= SOME)
    .slice(0, 5)
    .map((s) => ({ title: s.title, weekN: s.week_n, overlap: overlapOf(s.similarity) }));

  const flags: CandidateModel["flags"] = [];
  const topClash = row.competition_top.find((s) => s.similarity >= HIGH);
  if (sub.lowClash < 45 && topClash) {
    flags.push({
      tone: "warn",
      text: `Same-audience clash — ${topClash.title}${
        topClash.week_n === 1 ? " opens here" : ` still in market (wk ${topClash.week_n})`
      }.`,
    });
  } else if (sub.openness >= 70) {
    flags.push({ tone: "good", text: "Open lane — little competition for your audience." });
  }
  if (sub.demand >= 70) {
    flags.push({ tone: "note", text: "Strong seasonal demand for openers this week." });
  } else if (sub.demand < 40) {
    flags.push({ tone: "warn", text: "Soft demand window — a counterprogramming play." });
  }
  if (sub.comps >= 70) {
    flags.push({ tone: "good", text: "Comparable films legged out well around this week." });
  }

  return {
    date: row.weekend_date,
    label: labelOf(row.weekend_date),
    week: row.iso_week,
    sub,
    raw: {
      demandUsd: row.peer_median_opening_usd,
      pressure: Math.round(row.components.competition_norm * 100),
      clash: Math.round(clashNorm * 100),
    },
    inWindow,
    flags: flags.slice(0, 3),
  };
}

// ── Congestion curve (V1 field) ─────────────────────────────────────────────
// Collapses the whole competitive field into per-week magnitudes instead of
// enumerating every title: `total` is the overlap-weighted competition (low-
// similarity films contribute little), `clash` isolates same-audience pressure.
export interface CongestionPoint {
  week: number;
  date: string;
  total: number; // 0..100 — all competition, weighted by similarity
  clash: number; // 0..100 — same-audience competition only
}

export function congestionSeries(scored: WeekendScore[], midpoint: number): CongestionPoint[] {
  const byWeek = new Map<number, CongestionPoint>();
  for (const r of scored) {
    if (byWeek.has(r.iso_week)) continue;
    const clashRaw = r.competition_top
      .filter((s) => s.similarity >= CLASH_SIM)
      .reduce((sum, s) => sum + s.contribution, 0);
    byWeek.set(r.iso_week, {
      week: r.iso_week,
      date: r.weekend_date,
      total: Math.round(r.components.competition_norm * 100),
      clash: Math.round(absCompNorm(clashRaw, midpoint) * 100),
    });
  }
  return [...byWeek.values()].sort((a, b) => a.week - b.week);
}

// Count-based congestion bands for the landscape graph:
//   total = the whole upcoming field that week (every release in the curated universe),
//           NOT weighted by similarity — pure "how busy is this weekend".
//   clash = the same-audience subset: releases passing the active filter AND similar to
//           the candidate (similarity ≥ CLASH_SIM).
// Both are share-weighted counts (an opener = 1, a holdover = its retention) on the SAME
// scale — normalized by the busiest week's total — so the dark band always nests inside
// the light one. Computed straight from the forward schedule so the light band sees the
// full field, not just the top-N stored on each scored row.
export function congestionBands(
  candidate: CandidateFilm,
  weekends: string[],
  forward: ForwardSchedule,
  decay: DecayCurves,
  filter: CompetitorFilter | null
): CongestionPoint[] {
  const byWeek = new Map<number, { date: string; total: number; clash: number }>();
  for (const date of weekends) {
    const isoW = isoWeekOf(date);
    if (byWeek.has(isoW)) continue;
    let total = 0;
    let clash = 0;
    for (const c of activeFilmsOn(date, forward.items, decay)) {
      const share = c.week_n === 1 ? 1 : c.retention;
      // Light band: the entire curated theatrical field (similarity- and genre-agnostic).
      if (matchesCategoryFilter(c.film.distributor, "all")) total += share;
      // Dark band: same-audience competition within the user's active filter.
      if (passesCompetitorFilter(c.film, filter)) {
        const sim = similarity(candidate, {
          tier: c.film.tier,
          mpaa: c.film.mpaa,
          genres: c.film.genres,
        });
        if (sim >= CLASH_SIM) clash += share;
      }
    }
    byWeek.set(isoW, { date, total, clash });
  }
  const entries = [...byWeek.entries()].sort((a, b) => a[0] - b[0]);
  const maxTotal = Math.max(1, ...entries.map(([, v]) => v.total));
  return entries.map(([week, v]) => ({
    week,
    date: v.date,
    total: Math.round((v.total / maxTotal) * 100),
    clash: Math.round((v.clash / maxTotal) * 100),
  }));
}

// The films that make up the dark "same-audience" band — the direct competitors worth
// naming as cells on the curve. Same threshold (similarity ≥ CLASH_SIM) as the band itself,
// so the cells and the shading always agree.
export interface DirectComp {
  id: number;
  name: string;
  week: number;
  sim: number;
  distributor: string | null;
}

// Computed straight from the full forward schedule (not the prominence-capped competitor
// list) so low-budget indie horror — high similarity but small release — still surfaces as a
// cell. These are the openers that constitute the dark band; their holdover tails decay
// forward without a cell of their own.
// Display-only breakdown of why a competitor scores the way it does against your film.
// Mirrors similarity() for forward-schedule films (which carry no LLM tags, so the LLM
// weight folds into genre — genre effectively weighs 0.70).
const MPAA_ORDER = ["G", "PG", "PG-13", "R", "NC-17"];
function jaccard(a: string[], b: string[]): number {
  const A = new Set(a.map((x) => x.toLowerCase()));
  const B = new Set((b || []).map((x) => x.toLowerCase()));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}
function mpaaAdj(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const i = MPAA_ORDER.indexOf(a);
  const j = MPAA_ORDER.indexOf(b);
  if (i < 0 || j < 0) return 0;
  return Math.abs(i - j) === 1 ? 0.5 : 0;
}

export interface SimPart {
  label: string;
  raw: number; // 0..1 match on this dimension
  points: number; // weighted contribution to the total
  max: number; // max possible points for this dimension
}
export interface SimDetail {
  total: number;
  overlap: Overlap;
  parts: SimPart[];
}

export function competitorSimDetail(film: CandidateFilm, item: ForwardItem): SimDetail {
  const g = jaccard(film.genres, item.genres || []);
  const m = mpaaAdj(film.mpaa, item.mpaa);
  const t = item.tier === "unknown" ? 0 : item.tier === film.tier ? 1 : 0.5;
  const parts: SimPart[] = [
    { label: "Genre overlap", raw: g, points: 0.7 * g, max: 0.7 },
    { label: "MPAA proximity", raw: m, points: 0.15 * m, max: 0.15 },
    { label: "Distributor tier", raw: t, points: 0.15 * t, max: 0.15 },
  ];
  const total = parts.reduce((s, p) => s + p.points, 0);
  return { total, overlap: overlapOf(total), parts };
}

// Same predicate scoreClient uses to restrict the competitive set, applied to a forward
// item — so the named cells on the curve match the filtered competition band exactly.
export function matchesCompetitorFilter(f: ForwardItem, filt: CompetitorFilter | null): boolean {
  if (!filt) return true;
  if (filt.category && !matchesCategoryFilter(f.distributor, filt.category)) return false;
  if (filt.mpaa && f.mpaa !== filt.mpaa) return false;
  if (filt.distributors && filt.distributors.length > 0 && !filt.distributors.includes(f.distributor ?? "")) return false;
  return true;
}

export function directCompetitors(
  film: CandidateFilm,
  forward: ForwardItem[],
  competitorFilter: CompetitorFilter | null = null
): DirectComp[] {
  return forward
    .filter((f) => matchesCompetitorFilter(f, competitorFilter))
    .map((f) => ({ f, sim: similarity(film, { tier: f.tier, mpaa: f.mpaa, genres: f.genres }) }))
    .filter((x) => x.sim >= CLASH_SIM)
    .sort((a, b) => a.f.iso_week - b.f.iso_week)
    .map(({ f, sim }) => ({
      id: f.id,
      name: f.title,
      week: f.iso_week,
      sim,
      distributor: f.distributor,
    }));
}

// Auto-suggest a starting shortlist: the strongest distinct weekends by aggregate.
export function suggestShortlist(scored: WeekendScore[], n = 3): string[] {
  const ranked = [...scored].sort((a, b) => b.aggregated_score - a.aggregated_score);
  const out: string[] = [];
  for (const r of ranked) {
    if (out.length >= n) break;
    // Spread picks out so they aren't three adjacent weekends.
    if (out.every((d) => Math.abs(isoWeekOf(d) - r.iso_week) >= 3)) {
      out.push(r.weekend_date);
    }
  }
  return out.sort();
}

// Re-run the full live scorer over a weekend set (backs the shortlist sub-scores).
// Pass the candidate's midpoint so this call shares the same calibration as every other
// scoreClient call in the same render — colors and aggregates stay consistent.
export function scoreWeekends(
  film: CandidateFilm,
  weekends: string[],
  weights: Weights,
  deps: ClientScoreDeps,
  baselineTier: "industry" | "indie",
  competitorFilter: CompetitorFilter | null = null,
  midpoint?: number
): WeekendScore[] {
  return scoreClient(film, weekends, weights, deps, { baselineTier, competitorFilter, midpoint });
}
