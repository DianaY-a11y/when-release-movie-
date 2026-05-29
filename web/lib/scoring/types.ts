// Shared types for the scoring engine. The engine itself lives in score-client.ts and
// runs entirely client-side; the backtest reuses it in Node via the same import.

export type CandidateFilm = {
  title: string;
  tier: "industry" | "indie";
  mpaa: string | null;
  genres: string[];
  genre_tags: string[];
  audience_tags: string[];
  synopsis?: string | null;
  audience_profile?: string | null;
};

export type Weights = {
  opening: number;
  legs: number;
  competition: number;
};

export type ComparableFilm = {
  film_id: number;
  title: string;
  year: number;
  iso_week: number;
  distributor: string | null;
  opening_usd: number | null;
  total_domestic_usd: number | null;
  multiplier: number | null;
  similarity: number;
};

export type CompetitorSlot = {
  film_id: number | null;
  title: string;
  tier: string;
  mpaa: string | null;
  distributor: string | null;
  is_franchise: boolean | null;
  week_n: number;
  retention: number;
  similarity: number;
  contribution: number;
};

export type WeekendScore = {
  weekend_date: string;
  iso_week: number;
  label: string;
  peer_median_opening_usd: number;
  peer_median_multiplier: number | null;
  competition_index: number;
  competition_top: CompetitorSlot[];
  comparable_films: ComparableFilm[];
  components: {
    opening_norm: number;
    legs_norm: number;
    competition_norm: number;
  };
  aggregated_score: number;
};

import type { CategoryFilter } from "@/lib/distributors";

export type CompetitorFilter = {
  // Distributor category gate — restricts the competitive set to the curated universe
  // ("all"), or to a subset (majors / indie–prestige). Null = no category constraint
  // (used by the backtest, which builds its own peer set).
  category?: CategoryFilter | null;
  mpaa?: string | null;
  // Specific picked distributor names. Empty / undefined = no constraint.
  distributors?: string[];
};

