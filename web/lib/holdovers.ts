// Project a scheduled film forward into future weekends using the appropriate
// per-bucket decay curve from decay_curves.json.

import type { DecayCurves, ForwardItem } from "@/lib/types";

export type Holdover = {
  film: ForwardItem;
  week_n: number;          // 1 = opening, 2 = second weekend, etc.
  retention: number;       // 0..1 — share of opening retained that week
};

const HORROR_HINTS = ["horror"];
const FAMILY_HINTS = ["family", "animation", "kids"];
const DRAMA_HINTS = ["drama"];

function pickBucket(film: ForwardItem, curves: DecayCurves): string {
  const genres = (film.genres || []).map((g) => g.toLowerCase());
  const joined = genres.join(" ");
  if (HORROR_HINTS.some((h) => joined.includes(h)) && curves.buckets.horror) return "horror";
  if (FAMILY_HINTS.some((h) => joined.includes(h)) && curves.buckets.family) return "family";
  if (DRAMA_HINTS.some((h) => joined.includes(h)) && curves.buckets.drama) return "drama";
  if (film.tier === "indie" && curves.buckets.indie) return "indie";
  return "industry";
}

function isoWeekDelta(targetDate: string, releaseDate: string): number {
  // Number of 7-day blocks between release_date and target_date (inclusive of week 1 = release week).
  const a = new Date(releaseDate).getTime();
  const b = new Date(targetDate).getTime();
  const days = Math.floor((b - a) / (1000 * 60 * 60 * 24));
  return Math.floor(days / 7) + 1;
}

/**
 * For a given target Friday (`weekendStart` ISO date), return all films that
 * are theoretically still in release. Filters to retention ≥ minRetention to
 * suppress noise tail.
 */
export function activeFilmsOn(
  weekendStart: string,
  forward: ForwardItem[],
  curves: DecayCurves,
  minRetention = 0.02
): Holdover[] {
  const out: Holdover[] = [];
  for (const f of forward) {
    const weekN = isoWeekDelta(weekendStart, f.release_date);
    if (weekN < 1) continue;
    if (weekN > curves.max_weeks) continue;
    const bucket = pickBucket(f, curves);
    const retention = curves.buckets[bucket].retention[weekN - 1] ?? 0;
    if (retention < minRetention && weekN > 1) continue;
    out.push({ film: f, week_n: weekN, retention });
  }
  // Openers first, then by retention
  out.sort((a, b) => {
    if (a.week_n !== b.week_n) return a.week_n - b.week_n;
    return b.retention - a.retention;
  });
  return out;
}

export function isoWeekOf(dateIso: string): number {
  const d = new Date(dateIso + "T00:00:00Z");
  // Standard ISO week algorithm (Mon-based, week 1 contains Jan 4).
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7; // 0 = Monday
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // shift to Thursday of same ISO week
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / (1000 * 60 * 60 * 24);
  return 1 + Math.round((diff - ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

export function nextWeekendFridays(count: number): { date: string; label: string }[] {
  const out: { date: string; label: string }[] = [];
  const today = new Date();
  // Find next Friday
  const dow = today.getUTCDay() || 7;
  const daysUntilFri = ((5 - dow) + 7) % 7;
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + daysUntilFri));
  for (let i = 0; i < count; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    const label = cursor.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    out.push({ date: iso, label });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}
