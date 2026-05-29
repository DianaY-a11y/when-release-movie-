"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DecayCurves, FilmIndexItem, ForwardSchedule, LegsPayload, WeeklyPayload } from "@/lib/types";
import { nextWeekendFridays } from "@/lib/holdovers";
import { WeekendGrid, PresetSelector, ColorModeToggle, type ColorMode } from "./WeekendGrid";
import { CongestionGraph } from "./CongestionGraph";
import type { CandidateFilm } from "@/lib/scoring/types";
import { PRESETS, presetForGenres, type PresetKey } from "@/lib/scoring/presets";
import type { Weights } from "@/lib/scoring/types";
import type { ClientScoreDeps } from "@/lib/scoring/score-client";
import { useFilms } from "@/lib/film-context";

type Props = {
  forward: ForwardSchedule;
  decay: DecayCurves;
  legs?: LegsPayload | null;
  budgetMap?: Record<number, number | null>;
  film?: CandidateFilm | null;
  weeklyIndustry?: WeeklyPayload | null;
  weeklyIndie?: WeeklyPayload | null;
  filmIndex?: FilmIndexItem[] | null;
};

type ViewMode = "graph" | "grid";

// Type filter is three explicit states, all of which restrict the visible distributor
// set to the curated universe (see lib/distributors.ts). "All" lets in any of the three
// in-universe categories; "Studio" restricts to majors; "Indie / Prestige" to the
// indie / prestige subset. Films from distributors outside the universe are excluded
// under every button.
import type { CategoryFilter } from "@/lib/distributors";
const TIER_OPTIONS: { label: string; value: CategoryFilter }[] = [
  { label: "All", value: "all" },
  { label: "Indie / Prestige", value: "prestige" },
];

function RatingPicker({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className={`border px-3 py-1.5 text-sm flex items-center gap-2 ${
          value
            ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
            : "border-[var(--color-line)] hover:border-[var(--color-ink)]"
        }`}
      >
        <span className="font-mono">{value ?? "All"}</span>
        <span className="text-[10px] opacity-60">▾</span>
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-20 border border-[var(--color-line)] bg-[var(--color-paper)] w-32 shadow-md">
          {options.map((o) => {
            const active = value === o;
            return (
              <button
                key={o}
                type="button"
                onClick={() => { onChange(active ? null : o); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs font-mono flex items-center gap-2 hover:bg-[var(--color-soft)] ${
                  active ? "text-[var(--color-ink)]" : "text-[var(--color-muted)]"
                }`}
              >
                <span
                  className={`w-3 h-3 border shrink-0 flex items-center justify-center text-[8px] ${
                    active
                      ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                      : "border-[var(--color-line)]"
                  }`}
                >
                  {active && "✓"}
                </span>
                {o}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Generic searchable multi-select over a string list (used for both Studio and Genre).
function DistributorPicker({
  options,
  value,
  onChange,
  noun = "studios",
}: {
  options: string[];
  value: Set<string>;
  onChange: (v: Set<string>) => void;
  noun?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const filtered = useMemo(
    () => options.filter((o) => o.toLowerCase().includes(search.toLowerCase())),
    [options, search]
  );

  const label =
    value.size === 0
      ? "All"
      : value.size === 1
        ? [...value][0]
        : `${value.size} ${noun}`;

  function toggle(o: string) {
    const next = new Set(value);
    if (next.has(o)) next.delete(o);
    else next.add(o);
    onChange(next);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className={`border px-3 py-1.5 text-sm flex items-center gap-2 ${
          value.size > 0
            ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
            : "border-[var(--color-line)] hover:border-[var(--color-ink)]"
        }`}
      >
        <span>{label}</span>
        <span className="text-[10px] opacity-60">▾</span>
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-20 border border-[var(--color-line)] bg-[var(--color-paper)] w-60 shadow-md">
          <div className="border-b border-[var(--color-line)]">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${noun}…`}
              className="w-full px-3 py-2 text-xs bg-transparent outline-none placeholder:text-[var(--color-muted)]"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs italic text-[var(--color-muted)]">No match.</div>
            )}
            {filtered.map((o) => {
              const active = value.has(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggle(o)}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-[var(--color-soft)] ${
                    active ? "text-[var(--color-ink)]" : "text-[var(--color-muted)]"
                  }`}
                >
                  <span
                    className={`w-3 h-3 border shrink-0 flex items-center justify-center text-[8px] ${
                      active
                        ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                        : "border-[var(--color-line)]"
                    }`}
                  >
                    {active && "✓"}
                  </span>
                  <span className="truncate">{o}</span>
                </button>
              );
            })}
          </div>
          {value.size > 0 && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="w-full border-t border-[var(--color-line)] px-3 py-1.5 text-xs text-left text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            >
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}


const WEIGHT_LABELS: { key: keyof Weights; label: string }[] = [
  { key: "opening", label: "Opening" },
  { key: "legs", label: "Legs" },
  { key: "competition", label: "Competition" },
];

function WeightRow({ weights, onChange }: { weights: Weights; onChange: (w: Weights) => void }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
      {WEIGHT_LABELS.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-1.5">
          <span className="text-xs text-[var(--color-muted)] shrink-0">{label}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={weights[key]}
            onChange={(e) => onChange({ ...weights, [key]: parseFloat(e.target.value) })}
            className="w-20"
          />
          <span className="text-xs font-mono text-[var(--color-muted)] w-8 text-right">
            {(weights[key] * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

export function Calendar({
  forward,
  decay,
  legs = null,
  budgetMap = {},
  film: filmFromUrl = null,
  weeklyIndustry = null,
  weeklyIndie = null,
  filmIndex = null,
}: Props) {
  const {
    active, userSelected, weights, setWeights,
    filters, setCategoryFilter, setMpaaFilter, setDistributorFilter, setGenreFilter, clearFilters,
  } = useFilms();
  // A `?s=` URL scenario takes precedence for share-link loads, but once the user has
  // explicitly picked a film (or "None") from the header, that selection wins — otherwise
  // a stale scenario in the URL would keep shadowing it.
  const film = userSelected ? active?.film ?? null : filmFromUrl ?? active?.film ?? null;

  // Filters live in FilmContext so the compare cards below score against the same frame.
  const { category, mpaa, distributors, genres } = filters;
  const [weeks, setWeeks] = useState(52);
  // Default to the graph (congestion landscape). User can switch to the grid anytime.
  const [view, setView] = useState<ViewMode>("graph");
  const [colorMode, setColorMode] = useState<ColorMode>(film ? "combined" : "median");

  // Without a film, only "median" is meaningful — competition and combined need a film
  // to compute similarity. Snap back to median during render (guarded so it converges)
  // when the user clears the film — React's recommended alternative to an effect.
  if (!film && colorMode !== "median") setColorMode("median");

  // Preset: auto-detected from the film's genres, overridable by the user.
  const filmKey = film ? JSON.stringify(film) : null;
  const autoPreset = useMemo<PresetKey>(() => {
    if (!film) return "default";
    return presetForGenres(film.genres, film.genre_tags);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmKey]);
  const [presetOverride, setPresetOverride] = useState<PresetKey | null>(null);
  const preset = presetOverride ?? autoPreset;

  // When the active film changes: clear the preset override and (when a film turns on)
  // swap to the graph lens. Done as render-time "adjust state on change" — the supported
  // alternative to syncing via useEffect.
  const hasFilm = film != null;
  const [prevFilmKey, setPrevFilmKey] = useState(filmKey);
  const [prevHasFilm, setPrevHasFilm] = useState(hasFilm);
  if (filmKey !== prevFilmKey) {
    setPrevFilmKey(filmKey);
    setPresetOverride(null);
  }
  if (hasFilm !== prevHasFilm) {
    setPrevHasFilm(hasFilm);
    if (hasFilm) setView("graph");
  }

  function applyPreset(k: PresetKey) {
    setPresetOverride(k);
    setWeights(PRESETS[k].weights);
  }

  const fridays = useMemo(() => nextWeekendFridays(weeks), [weeks]);
  // Fixed full-year reference window for scoring. Scores + colors are normalized against
  // this stable set so they don't shift when the user changes "Weeks shown".
  const scoringFridays = useMemo(() => nextWeekendFridays(52), []);

  // Deps bundle for the graph view's client scorer — null until the snapshots it needs
  // are all present.
  const graphDeps = useMemo<ClientScoreDeps | null>(() => {
    if (!legs || !weeklyIndustry || !weeklyIndie) return null;
    return { forward, decay, legs, weeklyIndustry, weeklyIndie };
  }, [forward, decay, legs, weeklyIndustry, weeklyIndie]);

  const distributorOptions = useMemo(() => {
    const s = new Set<string>();
    for (const f of forward.items) if (f.distributor) s.add(f.distributor);
    return Array.from(s).sort();
  }, [forward]);

  const mpaaOptions = useMemo(() => {
    const s = new Set<string>();
    for (const f of forward.items) if (f.mpaa) s.add(f.mpaa);
    return Array.from(s).sort();
  }, [forward]);

  const genreOptions = useMemo(() => {
    const s = new Set<string>();
    for (const f of forward.items) for (const g of f.genres ?? []) s.add(g);
    return Array.from(s).sort();
  }, [forward]);

  // "all" is the default category — it doesn't count as a "filter applied" for the badge.
  const activeFilterCount =
    (category !== "all" ? 1 : 0) +
    (mpaa ? 1 : 0) +
    (distributors.size > 0 ? 1 : 0) +
    (genres.size > 0 ? 1 : 0);
  const clearAll = clearFilters;

  return (
    <div className="space-y-8">
      {/* ── Top bar: view + weeks (display settings, kept above the filter panel) */}
      <div className="flex flex-wrap items-end gap-6 pb-1">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">View</div>
          <div className="flex">
            {(["graph", "grid"] as const).map((m, i) => (
              <button
                key={m}
                type="button"
                onClick={() => setView(m)}
                className={`border px-3 py-1.5 text-sm capitalize ${i === 0 ? "border-r-0" : ""} ${
                  view === m
                    ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                    : "border-[var(--color-line)] hover:border-[var(--color-ink)]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Weeks</div>
          <select
            value={weeks}
            onChange={(e) => setWeeks(parseInt(e.target.value))}
            className="border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-1.5 text-sm hover:border-[var(--color-ink)]"
          >
            <option value={8}>8</option>
            <option value={16}>16</option>
            <option value={26}>26</option>
            <option value={52}>52</option>
          </select>
        </div>
      </div>

      {/* ── Unified filter panel ───────────────────────────────────────── */}
      <div className="border border-[var(--color-line)] p-5 space-y-5">
        {/* Filters section — competition filters */}
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-widest font-medium text-[var(--color-ink)]">
            Filters
          </div>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] underline underline-offset-2"
            >
              Clear ({activeFilterCount})
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Type</div>
            <div className="flex">
              {TIER_OPTIONS.map((opt, i) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setCategoryFilter(opt.value)}
                  className={`border px-3 py-1.5 text-sm ${i > 0 ? "border-l-0" : ""} ${
                    category === opt.value
                      ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                      : "border-[var(--color-line)] hover:border-[var(--color-ink)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Studio</div>
            <DistributorPicker options={distributorOptions} value={distributors} onChange={setDistributorFilter} />
          </div>

          <div className="space-y-2">
            <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Rating</div>
            <RatingPicker options={mpaaOptions} value={mpaa} onChange={setMpaaFilter} />
          </div>

          <div className="space-y-2">
            <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Genre</div>
            <DistributorPicker
              options={genreOptions}
              value={genres}
              onChange={setGenreFilter}
              noun="genres"
            />
          </div>
        </div>

        {/* Grid-only scoring controls — color mode, weights, genre preset. Hidden in graph
            view, where nothing is weighted or color-blended. */}
        {view === "grid" && (
          <div className="space-y-4 pt-4 border-t border-[var(--color-line)]">
            <div className="flex flex-wrap items-end gap-6">
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Color by</div>
                <ColorModeToggle
                  value={colorMode}
                  onChange={setColorMode}
                  disabledModes={film ? [] : ["combined", "competition"]}
                />
              </div>
            </div>
            {film && (
              <div className="space-y-4 pt-4 border-t border-[var(--color-line)]">
                <div className="text-xs uppercase tracking-widest font-medium text-[var(--color-ink)]">
                  Weights
                </div>
                <WeightRow weights={weights} onChange={setWeights} />
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Genre preset</div>
                  <PresetSelector preset={preset} onPreset={applyPreset} compact />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {view === "graph" ? (
        graphDeps ? (
          <CongestionGraph deps={graphDeps} weeks={weeks} filmIndex={filmIndex} />
        ) : (
          <div className="border border-dashed border-[var(--color-line)] p-8 text-sm text-[var(--color-muted)]">
            Snapshot data missing for the graph view.
          </div>
        )
      ) : (
        <WeekendGrid
          fridays={fridays}
          scoringFridays={scoringFridays}
          forward={forward}
          decay={decay}
          film={film}
          weights={film ? weights : null}
          colorMode={colorMode}
          onColorModeChange={setColorMode}
          filters={{ category, mpaa, distributors, genres }}
          legs={legs}
          weeklyIndustry={weeklyIndustry}
          weeklyIndie={weeklyIndie}
          budgetMap={budgetMap}
        />
      )}
    </div>
  );
}
