// Server-only loader: assembles the snapshot deps the concept views need and hands
// them to the client scorer. Mirrors what /calendar loads, minus the heavy
// film_index/film_tags (those stay server-side behind /api/comparable).

import {
  loadDecay,
  loadForward,
  loadLegs,
  loadWeeklyIndie,
  loadWeeklyIndustry,
} from "@/lib/data/load";
import type { ClientScoreDeps } from "@/lib/scoring/score-client";

export type WireframeDeps = ClientScoreDeps;

export async function loadWireframeDeps(): Promise<WireframeDeps | null> {
  const [forward, decay, legs, weeklyIndustry, weeklyIndie] = await Promise.all([
    loadForward(),
    loadDecay(),
    loadLegs(),
    loadWeeklyIndustry(),
    loadWeeklyIndie(),
  ]);
  if (!forward || !decay || !legs || !weeklyIndustry || !weeklyIndie) return null;
  return { forward, decay, legs, weeklyIndustry, weeklyIndie };
}
