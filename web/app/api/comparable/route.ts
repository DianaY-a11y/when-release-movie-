// Top library analogs for a candidate film. Filter-independent and weekend-independent,
// so the client fetches this once per film and caches it. Keeps the heavy film_index +
// film_tags snapshots on the server instead of shipping ~1.6MB to every browser.

import type { NextRequest } from "next/server";
import { comparableFilms } from "@/lib/scoring/comparable";
import type { CandidateFilm } from "@/lib/scoring/types";
import { loadFilmIndex, loadFilmTags } from "@/lib/data/load";

let cached: { filmIndex: Awaited<ReturnType<typeof loadFilmIndex>>; filmTags: Awaited<ReturnType<typeof loadFilmTags>> } | null = null;
async function getDeps() {
  if (cached) return cached;
  const [filmIndex, filmTags] = await Promise.all([loadFilmIndex(), loadFilmTags()]);
  if (!filmIndex) return null;
  cached = { filmIndex, filmTags };
  return cached;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { film?: CandidateFilm; n?: number };
  if (!body?.film) {
    return Response.json({ error: "film required" }, { status: 400 });
  }
  const deps = await getDeps();
  if (!deps?.filmIndex) {
    return Response.json({ error: "data snapshots missing" }, { status: 503 });
  }
  const n = Math.min(40, Math.max(1, body.n ?? 6));
  const comparable_films = comparableFilms(body.film, deps.filmIndex, deps.filmTags, n);
  return Response.json({ comparable_films });
}
