// Shared types — mirror of the JSON snapshots emitted by the Python scraper.

export type Tier = "industry" | "indie";

export type WeekSummary = {
  iso_week: number;
  label: string;
  n_years: number;
  median_opener_gross_usd: number;
  mean_opener_gross_usd: number;
  stdev_opener_gross_usd: number;
  cv: number | null;
  opening_norm: number; // 0..1
  rank_pct: number | null;
  holiday: string | null;
  meaningful_openers_count: number;
  top_films: {
    title: string;
    year: number;
    gross_usd: number;
    film_id: number;
  }[];
};

export type WeeklyPayload = {
  tier: Tier;
  excluded_years: number[];
  min_opener_gross_usd: number;
  weeks: WeekSummary[];
};

export type ClearanceEntry = {
  avg_drop: number | null;
  n_observations: number;
  clearance_score: number | null; // 0..1, higher = field clears faster
};

export type MultiplierComp = {
  film_id: number;
  title: string;
  year: number;
  iso_week: number;
  distributor: string | null;
  tier: "industry" | "indie" | "unknown";
  genres: string[] | null;
  mpaa: string | null;
  opening_usd: number;
  total_usd: number;
  multiplier: number;
};

export type LegsPayload = {
  min_opening_usd: number;
  high_multiplier_threshold: number;
  clearance_by_week: Record<string, ClearanceEntry>;
  high_multiplier_films: MultiplierComp[];
};

export type DecayCurves = {
  max_weeks: number;
  buckets: Record<
    string,
    { retention: number[]; n_films_observed: Record<string, number> }
  >;
};

export type ForwardItem = {
  id: number;
  film_id: number | null;
  title: string;
  release_date: string; // ISO date
  iso_week: number;
  distributor: string | null;
  tier: "industry" | "indie" | "unknown";
  format_flags: string[] | null;
  synopsis: string | null;
  genres: string[] | null;
  mpaa: string | null;
  poster_url: string | null;
  runtime_minutes: number | null;
  is_franchise: boolean | null;
};

export type ForwardSchedule = {
  items: ForwardItem[];
  months_ahead: number;
};

export type FilmIndexItem = {
  id: number;
  title: string;
  year: number;
  release_date: string;
  iso_week: number;
  distributor: string | null;
  tier: "industry" | "indie" | "unknown";
  genres: string[] | null;
  mpaa: string | null;
  runtime_minutes: number | null;
  budget_usd: number | null;
  is_franchise: boolean | null;
  poster_url: string | null;
  opening_usd: number | null;
  total_domestic_usd: number | null;
  peak_theaters: number | null;
  multiplier: number | null;
};

export type FilmIndex = { items: FilmIndexItem[] };

export type FilmTags = Record<
  string,
  { film_id: number; genre_tags?: string[]; audience_tags?: string[]; error?: string }
>;

export type EmbeddingEntry = {
  film_id: number;
  vector: number[];
};

export type Embeddings = {
  feature_names: string[];
  items: EmbeddingEntry[];
};

export type Meta = {
  generated_at: string;
  snapshots_copied: number;
};
