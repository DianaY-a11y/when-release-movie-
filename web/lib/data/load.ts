// Server-side snapshot loaders. We read directly from public/data/ at request time so
// `publish.sh` re-runs are picked up without rebuilding the app.

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  DecayCurves,
  Embeddings,
  FilmIndex,
  FilmTags,
  ForwardSchedule,
  LegsPayload,
  Meta,
  WeeklyPayload,
} from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "public", "data");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const buf = await fs.readFile(path.join(DATA_DIR, file), "utf8");
    return JSON.parse(buf) as T;
  } catch {
    return fallback;
  }
}

export const loadWeeklyIndustry = () =>
  readJson<WeeklyPayload | null>("weekly_industry.json", null);
export const loadWeeklyIndie = () =>
  readJson<WeeklyPayload | null>("weekly_indie.json", null);
export const loadLegs = () => readJson<LegsPayload | null>("legs.json", null);
export const loadDecay = () =>
  readJson<DecayCurves | null>("decay_curves.json", null);
export const loadForward = () =>
  readJson<ForwardSchedule | null>("forward_schedule.json", null);
export const loadFilmIndex = () =>
  readJson<FilmIndex | null>("film_index.json", null);
export const loadFilmTags = () =>
  readJson<FilmTags>("film_tags.json", {});
export const loadEmbeddings = () =>
  readJson<Embeddings | null>("embeddings.json", null);
export const loadMeta = () =>
  readJson<Meta | null>("meta.json", null);
