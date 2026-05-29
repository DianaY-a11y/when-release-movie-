// Client-side scoring. This is the single source of truth for the live UI — both the
// calendar grid and the compare cards call scoreClient with identical inputs, so the
// numbers they show always agree.
//
// Differs from the server `score()` (still used by the backtest) in one deliberate way:
// the competition term uses an ABSOLUTE sigmoid (raw / (raw + midpoint)) rather than a
// min-max normalized value. Absolute competition means filtering to a sparse studio
// actually shifts the colors/scores, instead of every weekend getting re-stretched
// across the full gradient. Opening + legs stay min-max normalized across the scored set.

import { activeFilmsOn, isoWeekOf, nextWeekendFridays } from "@/lib/holdovers";
import { matchesCategoryFilter } from "@/lib/distributors";
import { similarity } from "./similarity";
import type { CandidateFilm, CompetitorSlot, WeekendScore, Weights } from "./types";
import type {
  DecayCurves,
  ForwardSchedule,
  LegsPayload,
  WeeklyPayload,
} from "@/lib/types";

// Where raw competition_index maps to 0.5 on the absolute 0..1 scale. Auto-tuned per
// candidate: midpoint = median raw competition_index across the next 52 weekends of the
// forward schedule. A candidate that competes broadly (high similarity to many releases)
// sees a higher midpoint, so the gradient stays balanced rather than washing out red.
// Fallback used only when the forward schedule is empty.
export const DEFAULT_MIDPOINT = 1.0;

export function absCompNorm(raw: number, midpoint: number = DEFAULT_MIDPOINT): number {
  return raw / (raw + midpoint);
}

// Raw competition_index for a single weekend — the sigmoid input. Lifted out so
// computeMidpoint can call it without going through scoreClient.
function rawCompetitionIndex(
  film: CandidateFilm,
  weekendIso: string,
  forward: ForwardSchedule,
  decay: DecayCurves
): number {
  const competitors = activeFilmsOn(weekendIso, forward.items, decay);
  let sum = 0;
  for (const c of competitors) {
    const sim = similarity(film, {
      tier: c.film.tier,
      mpaa: c.film.mpaa,
      genres: c.film.genres,
    });
    const share = c.week_n === 1 ? 1 : c.retention;
    sum += sim * share;
  }
  return sum;
}

// Auto-tuned midpoint for a candidate film. Computes the raw competition_index across
// the next 52 weekends of the unfiltered forward schedule and returns the median —
// this is the value of raw that should map to 0.5 (neutral) on the color gradient.
export function computeMidpoint(film: CandidateFilm, deps: {
  forward: ForwardSchedule;
  decay: DecayCurves;
}): number {
  const next52 = nextWeekendFridays(52).map((f) => f.date);
  const raws = next52.map((d) => rawCompetitionIndex(film, d, deps.forward, deps.decay));
  if (raws.length === 0) return DEFAULT_MIDPOINT;
  const sorted = [...raws].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  // Guard against degenerate cases (empty schedule, all-zero similarities).
  return med > 0 ? med : DEFAULT_MIDPOINT;
}

export function normalizeWeights(w: Weights): Weights {
  const total = w.opening + w.legs + w.competition;
  if (total === 0) return { opening: 0.4, legs: 0.4, competition: 0.2 };
  return {
    opening: w.opening / total,
    legs: w.legs / total,
    competition: w.competition / total,
  };
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function minMaxNorm(xs: number[]): number[] {
  if (xs.length === 0) return [];
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  if (max === min) return xs.map(() => 0.5);
  return xs.map((x) => (x - min) / (max - min));
}

function weekendLabel(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  return d.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export type ClientScoreDeps = {
  forward: ForwardSchedule;
  decay: DecayCurves;
  legs: LegsPayload;
  weeklyIndustry: WeeklyPayload;
  weeklyIndie: WeeklyPayload;
};

// Re-exported from types.ts so callers have one stop. Built from the UI filters in
// WeekendGrid / CompareView / useModel.
export type { CompetitorFilter } from "./types";
import type { CompetitorFilter } from "./types";

export type ScoreClientOptions = {
  // Which weekly payload drives peer median + legs baseline. Always the candidate
  // film's tier — narrowing the visible competitor set via UI filters never changes
  // which peer median the candidate is judged against.
  baselineTier: "industry" | "indie";
  // Restricts which films count as competitors (mirrors the calendar filters).
  competitorFilter?: CompetitorFilter | null;
  // Auto-tuned competition midpoint. If omitted, computed internally. Pass it to share
  // a single value across multiple scoreClient calls + downstream wireframe helpers.
  midpoint?: number;
};

export function scoreClient(
  film: CandidateFilm,
  weekends: string[],
  rawWeights: Weights,
  deps: ClientScoreDeps,
  opts: ScoreClientOptions
): WeekendScore[] {
  const weights = normalizeWeights(rawWeights);
  const tierPayload = opts.baselineTier === "indie" ? deps.weeklyIndie : deps.weeklyIndustry;
  const weekByIso = new Map(tierPayload.weeks.map((w) => [w.iso_week, w]));
  const filt = opts.competitorFilter ?? null;
  const midpoint = opts.midpoint ?? computeMidpoint(film, deps);

  const rows: WeekendScore[] = [];
  const rawOpening: number[] = [];
  const rawLegs: number[] = [];

  for (const weekendIso of weekends) {
    const isoW = isoWeekOf(weekendIso);
    const wk = weekByIso.get(isoW);
    const peerMedianOpening = wk?.median_opener_gross_usd ?? 0;

    // Peer median multiplier — films in the same (baseline) tier opening within ±2 ISO weeks.
    const nearWeek = (w: number) => Math.min(Math.abs(w - isoW), 52 - Math.abs(w - isoW)) <= 2;
    const mults = deps.legs.high_multiplier_films
      .filter((f) => f.tier === opts.baselineTier && nearWeek(f.iso_week))
      .map((f) => f.multiplier);
    const peerMedianMult = median(mults);

    const competitors = activeFilmsOn(weekendIso, deps.forward.items, deps.decay).filter((c) => {
      if (!filt) return true;
      // Distributor category gate (universe / studio / prestige).
      if (filt.category && !matchesCategoryFilter(c.film.distributor, filt.category)) {
        return false;
      }
      if (filt.mpaa && c.film.mpaa !== filt.mpaa) return false;
      if (
        filt.distributors &&
        filt.distributors.length > 0 &&
        !filt.distributors.includes(c.film.distributor ?? "")
      ) {
        return false;
      }
      return true;
    });

    const slots: CompetitorSlot[] = competitors.map((c) => {
      // Forward-schedule films carry genres/mpaa/tier but (almost) never LLM tags, so we
      // score competitor similarity on those fields alone — matches the data we have.
      const sim = similarity(film, {
        tier: c.film.tier,
        mpaa: c.film.mpaa,
        genres: c.film.genres,
      });
      const share = c.week_n === 1 ? 1 : c.retention;
      return {
        film_id: c.film.film_id ?? c.film.id,
        title: c.film.title,
        tier: c.film.tier,
        mpaa: c.film.mpaa,
        distributor: c.film.distributor,
        is_franchise: c.film.is_franchise,
        week_n: c.week_n,
        retention: c.retention,
        similarity: sim,
        contribution: sim * share,
      };
    });
    const compIndexRaw = slots.reduce((s, x) => s + x.contribution, 0);

    rawOpening.push(peerMedianOpening);
    rawLegs.push(peerMedianMult ?? 0);

    rows.push({
      weekend_date: weekendIso,
      iso_week: isoW,
      label: weekendLabel(weekendIso),
      peer_median_opening_usd: peerMedianOpening,
      peer_median_multiplier: peerMedianMult,
      competition_index: compIndexRaw,
      competition_top: slots.sort((a, b) => b.contribution - a.contribution).slice(0, 30),
      comparable_films: [], // filled separately (server, per-film) — not filter-dependent
      components: { opening_norm: 0, legs_norm: 0, competition_norm: 0 },
      aggregated_score: 0,
    });
  }

  const openN = minMaxNorm(rawOpening);
  const legsN = minMaxNorm(rawLegs);
  for (let i = 0; i < rows.length; i++) {
    const o = openN[i];
    const l = legsN[i];
    // competition_norm holds the ABSOLUTE sigmoid value (not min-max), with the midpoint
    // auto-tuned per candidate. This is what makes filters visibly shift the score.
    const cAbs = absCompNorm(rows[i].competition_index, midpoint);
    rows[i].components = { opening_norm: o, legs_norm: l, competition_norm: cAbs };
    rows[i].aggregated_score =
      weights.opening * o + weights.legs * l - weights.competition * cAbs;
  }
  return rows;
}
