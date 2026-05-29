// Pairwise film similarity for the candidate vs. library / competitor films.
// Spec features: genre, MPAA, distributor-tier, budget-tier.
// budget_usd and is_franchise are null across the snapshot so we drop them and
// lean on the LLM tag layer (genre_tags + audience_tags) as a soft re-rank.

import type { CandidateFilm } from "./types";

export type FilmLike = {
  tier: "industry" | "indie" | "unknown";
  mpaa: string | null;
  genres: string[] | null;
  genre_tags?: string[];
  audience_tags?: string[];
};

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const A = new Set(a.map((x) => x.toLowerCase()));
  const B = new Set(b.map((x) => x.toLowerCase()));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Similarity-score thresholds shared across the app. Centralized here so the calendar
// "real threat" highlight, the CongestionGraph clash band, and the side-panel red
// flag all use the same numeric definition of "this competitor matters."
export const SIM_THRESHOLDS = {
  // High enough that this competitor genuinely splits the candidate's audience —
  // the red-flag threshold for both visual highlights and the clash sub-score.
  clash: 0.45,
  // Some overlap — worth surfacing as a competitor on the curve / list but not as a
  // direct head-to-head threat.
  some: 0.28,
} as const;

// MPAA adjacency — exact match = 1.0, one step away = 0.5, otherwise 0.
const MPAA_ORDER = ["G", "PG", "PG-13", "R", "NC-17"];
function mpaaScore(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const i = MPAA_ORDER.indexOf(a);
  const j = MPAA_ORDER.indexOf(b);
  if (i < 0 || j < 0) return 0;
  return Math.abs(i - j) === 1 ? 0.5 : 0;
}

const WEIGHTS = {
  genre: 0.35,
  mpaa: 0.15,
  tier: 0.15,
  llm: 0.35,
};

export function similarity(candidate: CandidateFilm, other: FilmLike): number {
  const genre = jaccard(candidate.genres, other.genres || []);
  const mpaa = mpaaScore(candidate.mpaa, other.mpaa);

  // Tier: same → 1.0, indie↔industry → 0.5 (they still compete for the same eyeballs;
  // an indie horror and a Warner Bros. horror genuinely contest the same horror tribe),
  // unknown tier → 0.
  let tier: number;
  if (other.tier === "unknown") tier = 0;
  else if (candidate.tier === other.tier) tier = 1;
  else tier = 0.5;

  // LLM tag layer is sparse — film_tags.json covers historical library films well but
  // many forward-schedule entries (especially industry tentpoles like Evil Dead Burn)
  // have no tags. When the other film has no LLM tags at all, redistribute the LLM
  // weight back into genre so missing data doesn't silently zero out 35% of the formula.
  const hasLLM =
    (other.genre_tags && other.genre_tags.length > 0) ||
    (other.audience_tags && other.audience_tags.length > 0);

  if (hasLLM) {
    const llmGenre = jaccard(candidate.genre_tags, other.genre_tags || []);
    const llmAud = jaccard(candidate.audience_tags, other.audience_tags || []);
    const llm = (llmGenre + llmAud) / 2;
    return (
      WEIGHTS.genre * genre +
      WEIGHTS.mpaa * mpaa +
      WEIGHTS.tier * tier +
      WEIGHTS.llm * llm
    );
  }

  // No LLM tags on other → roll LLM weight into genre.
  const genreOnly = WEIGHTS.genre + WEIGHTS.llm; // 0.70
  return genreOnly * genre + WEIGHTS.mpaa * mpaa + WEIGHTS.tier * tier;
}
