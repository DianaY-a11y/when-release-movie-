import type { Weights } from "./types";

export type PresetKey =
  | "horror"
  | "prestige_drama"
  | "family"
  | "action_tentpole"
  | "comedy"
  | "default";

export const PRESETS: Record<PresetKey, { label: string; weights: Weights; rationale: string }> = {
  default: {
    label: "Balanced",
    weights: { opening: 0.4, legs: 0.4, competition: 0.5 },
    rationale: "Equal weight to opening potential and legs; competition discounts.",
  },
  horror: {
    label: "Horror",
    // Horror is a tribal-audience genre — when two horror films open the same weekend
    // they directly split the same opening-week buyers, so competition pressure should
    // outweigh peer-week strength.
    weights: { opening: 0.5, legs: 0.1, competition: 0.7 },
    rationale:
      "Front-loaded openers + tribal audiences — competition pressure dominates because horror fans split between same-week titles.",
  },
  prestige_drama: {
    label: "Prestige / Awards drama",
    weights: { opening: 0.25, legs: 0.5, competition: 0.5 },
    rationale: "Slow rollouts that live or die on word-of-mouth multiplier.",
  },
  family: {
    label: "Family / Animation",
    weights: { opening: 0.4, legs: 0.4, competition: 0.5 },
    rationale: "Long tails — kids+parents drive holidays; legs matter as much as open.",
  },
  action_tentpole: {
    label: "Action tentpole",
    weights: { opening: 0.6, legs: 0.2, competition: 0.5 },
    rationale: "Open big or bust — drop-off is steep but openers are massive.",
  },
  comedy: {
    label: "Comedy / General",
    weights: { opening: 0.5, legs: 0.3, competition: 0.5 },
    rationale: "Balanced — opener matters but holdovers from rivals can sink you.",
  },
};

const GENRE_TAG_TO_PRESET: Array<[RegExp, PresetKey]> = [
  [/horror/i, "horror"],
  [/prestige|awards|biopic|coming-of-age/i, "prestige_drama"],
  [/family|animated|animation|kids/i, "family"],
  [/tentpole|franchise|superhero/i, "action_tentpole"],
  [/comedy/i, "comedy"],
];

export function presetForGenres(genres: string[], genreTags: string[]): PresetKey {
  const hay = [...genres, ...genreTags].join(" ").toLowerCase();
  for (const [re, key] of GENRE_TAG_TO_PRESET) if (re.test(hay)) return key;
  return "default";
}
