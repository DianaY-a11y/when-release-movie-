// localStorage-backed film library. Per-browser only (no backend).

import type { CandidateFilm } from "@/lib/scoring/types";

const KEY = "slate-films-v1";
const ACTIVE_KEY = "slate-active-film-v1";

export type SavedFilm = {
  id: string;
  film: CandidateFilm;
  savedAt: number;
};

function isBrowser() {
  return typeof window !== "undefined";
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function readAll(): SavedFilm[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedFilm[]) : [];
  } catch {
    return [];
  }
}

function writeAll(films: SavedFilm[]): void {
  if (!isBrowser()) return;
  localStorage.setItem(KEY, JSON.stringify(films));
  emit();
}

// ── Reactive layer for useSyncExternalStore ──────────────────────────────────
// Lets React read this localStorage-backed store without a mount effect (which would
// otherwise trip react-hooks/set-state-in-effect and risk an SSR hydration mismatch).

const listeners = new Set<() => void>();
// getSnapshot must return a referentially-stable value between mutations, so cache the
// derived list and invalidate it on every write.
let filmsCache: SavedFilm[] | null = null;

function emit(): void {
  filmsCache = null;
  for (const l of listeners) l();
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === ACTIVE_KEY || e.key === null) emit();
  };
  if (isBrowser()) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (isBrowser()) window.removeEventListener("storage", onStorage);
  };
}

export function getFilmsSnapshot(): SavedFilm[] {
  if (filmsCache === null) filmsCache = listFilms();
  return filmsCache;
}

// Stable empty references for the server render (and the first, pre-hydration client
// render) so snapshots match and React reconciles to real data after hydration.
const SERVER_FILMS: SavedFilm[] = [];
export function getFilmsServerSnapshot(): SavedFilm[] {
  return SERVER_FILMS;
}

export function getActiveIdSnapshot(): string | null {
  return getActiveFilmId();
}
export function getActiveIdServerSnapshot(): string | null {
  return null;
}

export function listFilms(): SavedFilm[] {
  return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export function saveFilm(film: CandidateFilm): SavedFilm {
  const next: SavedFilm = { id: randomId(), film, savedAt: Date.now() };
  const all = readAll();
  all.push(next);
  writeAll(all);
  return next;
}

export function deleteFilm(id: string): void {
  writeAll(readAll().filter((f) => f.id !== id));
}

export function getActiveFilmId(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveFilmId(id: string | null): void {
  if (!isBrowser()) return;
  if (id === null) localStorage.removeItem(ACTIVE_KEY);
  else localStorage.setItem(ACTIVE_KEY, id);
  emit();
}
