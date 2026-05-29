"use client";

import { useEffect, useMemo, useState } from "react";
import { CandidateBar } from "./CandidateBar";
import type { DecayCurves, ForwardSchedule, LegsPayload, WeeklyPayload, WeekSummary } from "@/lib/types";
import { useFilms } from "@/lib/film-context";
import { activeFilmsOn, isoWeekOf } from "@/lib/holdovers";
import type {
  CandidateFilm,
  CompetitorSlot,
  WeekendScore,
  Weights,
} from "@/lib/scoring/types";
import { scoreClient, normalizeWeights, type CompetitorFilter } from "@/lib/scoring/score-client";
import { matchesCategoryFilter, type CategoryFilter } from "@/lib/distributors";
import { SIM_THRESHOLDS } from "@/lib/scoring/similarity";
import { PRESETS, type PresetKey } from "@/lib/scoring/presets";
import { Hint } from "@/components/Hint";
import { ColorScaleLegend } from "@/components/ColorScaleLegend";
import { useCompareSelection } from "@/lib/compare-selection";

type Friday = { date: string; label: string };

type Props = {
  fridays: Friday[];
  scoringFridays?: Friday[];
  forward: ForwardSchedule;
  decay: DecayCurves;
  film: CandidateFilm | null;
  weights: Weights | null;
  colorMode: ColorMode;
  onColorModeChange: (m: ColorMode) => void;
  filters: {
    category: CategoryFilter;
    mpaa: string | null;
    distributors: Set<string>;
    genres: Set<string>;
  };
  // Legs snapshot for the client-side multiplier baseline.
  legs?: LegsPayload | null;
  // Weekly snapshots: peer-median opening per ISO week, used both for client scoring
  // and the no-film median-coloring fallback.
  weeklyIndustry?: WeeklyPayload | null;
  weeklyIndie?: WeeklyPayload | null;
  budgetMap?: Record<number, number | null>;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Curated priority list — surface the studios a theatrical planner watches first.
const TOP_DISTRIBUTORS = [
  "Walt Disney Studios Motion Pictures",
  "Universal Pictures",
  "Warner Bros.",
  "Paramount Pictures",
  "Sony Pictures Releasing",
  "20th Century Studios",
  "Lionsgate",
  "Apple Original Films",
  "Amazon MGM Studios",
  "A24",
  "Neon",
  "Focus Features",
  "Searchlight Pictures",
  "Bleecker Street",
  "Roadside Attractions",
];

function distributorRank(d: string | null): number {
  if (!d) return TOP_DISTRIBUTORS.length;
  const i = TOP_DISTRIBUTORS.findIndex((t) => d.toLowerCase().includes(t.toLowerCase()));
  return i >= 0 ? i : TOP_DISTRIBUTORS.length;
}

function isTopDistributor(d: string | null): boolean {
  return d ? distributorRank(d) < TOP_DISTRIBUTORS.length : false;
}

// Red (good) → light blue (bad). Score is already normalized to 0..1.
function scoreColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const h = 210 - clamped * 210;
  const s = 30 + clamped * 50;
  const l = 88 - clamped * 30;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// What the cell colors represent. The user can switch lenses; in every mode red = good
// for the candidate film (an open, favorable weekend) and blue = bad.
export type ColorMode = "combined" | "median" | "competition";

const COLOR_MODES: { id: ColorMode; label: string; blurb: string }[] = [
  {
    id: "combined",
    label: "Combined",
    blurb:
      "Opening + legs strength minus competition pressure — the overall competitive fit.",
  },
  {
    id: "median",
    label: "Median gross",
    blurb:
      "Peer median opening-weekend gross for this ISO week and tier — the same seasonal box-office signal the heatmap uses.",
  },
  {
    id: "competition",
    label: "Competition",
    blurb:
      "How open the weekend is — red means little similar competition, blue means crowded.",
  },
];

const MODE_LABEL: Record<ColorMode, string> = {
  combined: "combined fit",
  median: "median gross",
  competition: "competition",
};

// Cell/panel value readout per lens. Median shows real dollars; competition shows the
// raw competition index; combined shows the signed aggregate.
function cellValueLabel(mode: ColorMode, raw: number): string {
  if (mode === "median") return formatBudget(raw);
  if (mode === "combined") return `${raw >= 0 ? "+" : ""}${raw.toFixed(2)}`;
  return raw.toFixed(2);
}

function monthKey(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()).padStart(2, "0")}`;
}

function monthLabel(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function dayOfMonth(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  return String(d.getUTCDate());
}

function weekOfMonth(dateIso: string): number {
  const d = new Date(dateIso + "T00:00:00Z");
  return Math.ceil(d.getUTCDate() / 7);
}

function cleanTitle(t: string): string {
  return t.replace(/\bA24\s+/gi, "").replace(/\s+/g, " ").trim();
}

function formatBudget(usd: number): string {
  if (usd >= 1_000_000) return `$${Math.round(usd / 1_000_000)}M`;
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}K`;
  return `$${usd}`;
}

export function WeekendGrid({
  fridays,
  scoringFridays,
  forward,
  decay,
  film,
  weights,
  colorMode,
  filters,
  legs,
  weeklyIndustry,
  weeklyIndie,
  budgetMap = {},
}: Props) {
  const refFridays = scoringFridays ?? fridays;
  const { openModal } = useFilms();
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const candidates = useCompareSelection();

  const filmKey = film ? JSON.stringify(film) : null;

  const refFridaysKey = useMemo(
    () => refFridays.map((f) => f.date).join(","),
    [refFridays]
  );

  // Map UI filters → competitor_filter. Always set: the Type button is always on
  // ("all" still restricts to the curated distributor universe — Fathom, Netflix,
  // Kino Lorber, Iconic Releasing, etc. are excluded under every button).
  const competitorFilter = useMemo<CompetitorFilter>(() => {
    return {
      category: filters.category,
      mpaa: filters.mpaa,
      distributors: Array.from(filters.distributors).sort(),
      genres: Array.from(filters.genres).sort(),
    };
  }, [filters.category, filters.mpaa, filters.distributors, filters.genres]);
  const competitorFilterKey = JSON.stringify(competitorFilter);

  // Scoring is done client-side (same scoreClient the compare cards use), so the grid
  // and the compare view can never disagree, and filter/weight changes are instant.
  const scoreData = useMemo<{ weekends: WeekendScore[] } | null>(() => {
    if (!film || !weights || !legs || !weeklyIndustry || !weeklyIndie || refFridays.length === 0) {
      return null;
    }
    // Baseline = candidate's own tier. Filters narrow the visible competitor set but
    // never re-baseline which peer median the candidate is compared against.
    const baselineTier: "industry" | "indie" = film.tier;
    const rows = scoreClient(
      film,
      refFridays.map((f) => f.date),
      weights,
      { forward, decay, legs, weeklyIndustry, weeklyIndie },
      { baselineTier, competitorFilter }
    );
    return { weekends: rows };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmKey, weights, refFridaysKey, competitorFilterKey, legs, weeklyIndustry, weeklyIndie, forward, decay]);

  // ESC closes selected.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const byMonth = useMemo(() => {
    const map = new Map<string, Friday[]>();
    for (const f of fridays) {
      const k = monthKey(f.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(f);
    }
    return Array.from(map.entries());
  }, [fridays]);

  // Color value (0..1) + raw readout per lens. All scoring is precomputed by scoreClient;
  // here we just pick which component drives the color and what number to print.
  const scoreByDate = useMemo(() => {
    const out = new Map<string, { raw: number; norm: number }>();

    // No-film median fallback: look up peer-median opener for each weekend's ISO week
    // from the matching tier payload. Same signal the heatmap shows, projected onto the
    // grid so the page is meaningful before any profile is uploaded.
    if (!film) {
      if (colorMode !== "median") return out;
      // Pick the indie payload when the user is exploring prestige releases, industry
      // otherwise. (When no film is loaded the candidate tier doesn't exist, so the
      // category filter is the only natural signal of "which peer set am I looking at".)
      const payload =
        filters.category === "prestige"
          ? weeklyIndie ?? weeklyIndustry
          : weeklyIndustry ?? weeklyIndie;
      if (!payload) return out;
      const byIso = new Map(payload.weeks.map((w) => [w.iso_week, w]));
      for (const f of refFridays) {
        const w = byIso.get(isoWeekOf(f.date));
        if (!w) continue;
        out.set(f.date, { raw: w.median_opener_gross_usd, norm: w.opening_norm });
      }
      return out;
    }

    if (!scoreData) return out;
    if (colorMode === "median") {
      for (const w of scoreData.weekends) {
        out.set(w.weekend_date, {
          raw: w.peer_median_opening_usd,
          norm: w.components.opening_norm,
        });
      }
      return out;
    }
    if (colorMode === "competition") {
      // competition_norm is already absolute (0..1). Invert so low competition → red.
      for (const w of scoreData.weekends) {
        out.set(w.weekend_date, {
          raw: w.competition_index,
          norm: 1 - w.components.competition_norm,
        });
      }
      return out;
    }
    // Combined: raw is the aggregated_score (identical to the compare card). Map to 0..1
    // for color. With normalized weights the aggregate spans [-w_comp, 1 - w_comp], so
    // norm = aggregate + w_comp.
    if (!weights) return out;
    const nw = normalizeWeights(weights);
    for (const w of scoreData.weekends) {
      out.set(w.weekend_date, {
        raw: w.aggregated_score,
        norm: w.aggregated_score + nw.competition,
      });
    }
    return out;
  }, [scoreData, colorMode, weights, film, filters.category, weeklyIndustry, weeklyIndie, refFridays]);

  // Historical top openers per ISO week — drawn from the candidate's tier when a film
  // is loaded, otherwise from the category the user is exploring.
  const historicalByIso = useMemo(() => {
    const tier = film ? film.tier : (filters.category === "prestige" ? "indie" : "industry");
    const payload = tier === "indie" ? weeklyIndie ?? weeklyIndustry : weeklyIndustry ?? weeklyIndie;
    const m = new Map<number, WeekSummary["top_films"]>();
    if (payload) for (const w of payload.weeks) m.set(w.iso_week, w.top_films);
    return m;
  }, [film, filters.category, weeklyIndustry, weeklyIndie]);

  const competitorByDate = useMemo(() => {
    const out = new Map<string, { openers: number; holdovers: number }>();
    for (const f of fridays) {
      const all = activeFilmsOn(f.date, forward.items, decay).filter((h) => {
        if (!matchesCategoryFilter(h.film.distributor, filters.category)) return false;
        if (filters.mpaa && h.film.mpaa !== filters.mpaa) return false;
        if (
          filters.distributors.size > 0 &&
          !filters.distributors.has(h.film.distributor ?? "")
        )
          return false;
        if (
          filters.genres.size > 0 &&
          !(h.film.genres ?? []).some((g) => filters.genres.has(g))
        )
          return false;
        return true;
      });
      out.set(f.date, {
        openers: all.filter((h) => h.week_n === 1).length,
        holdovers: all.filter((h) => h.week_n > 1).length,
      });
    }
    return out;
  }, [fridays, forward, decay, filters]);

  const activeDate = selected ?? hovered;
  // A pinned `selected` weekend can fall out of `fridays` when the user shrinks the
  // weeks-shown selector. Resolve the Friday here and only render the detail panel when
  // it's still in range — otherwise `fridays.find(...)` is undefined and WeekendDetail
  // crashes dereferencing `friday.date`.
  const activeFriday = activeDate
    ? fridays.find((f) => f.date === activeDate) ?? null
    : null;

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <ColorScaleLegend
            color={scoreColor}
            lowLabel={film ? "bad" : "low"}
            highLabel={film ? "good" : "high"}
          />
          <div className="text-sm">
            {film ? (
              <span className="text-[var(--color-muted)]">
                Coloring by{" "}
                <span className="text-[var(--color-ink)] font-medium">
                  {MODE_LABEL[colorMode]}
                </span>{" "}
                for{" "}
                <span className="text-[var(--color-ink)] font-medium">
                  {film.title || "untitled film"}
                </span>
                .
              </span>
            ) : (
              <span className="text-[var(--color-muted)]">
                Coloring by{" "}
                <span className="text-[var(--color-ink)] font-medium">peer median opening</span>{" "}
                for the {filters.category === "prestige" ? "indie / prestige" : "industry"} tier
                — same signal as the heatmap.{" "}
                <button
                  type="button"
                  onClick={openModal}
                  className="text-[var(--color-ink)] underline underline-offset-2"
                >
                  Score a film
                </button>{" "}
                to unlock competition and combined lenses.
              </span>
            )}
          </div>
        </div>
      </div>

      <CandidateBar />

      <div className="grid lg:grid-cols-[5fr_4fr] gap-8">
        {/* LEFT: month-grouped grid */}
        <div className="space-y-3">
          {/* Column headers — week position within the month */}
          <div className="grid grid-cols-5 gap-1 pl-[4.5rem]">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                className="text-center text-[9px] uppercase tracking-widest text-[var(--color-muted)]"
              >
                {n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`}
              </div>
            ))}
          </div>

          {byMonth.map(([k, days]) => (
            <div key={k} className="flex gap-2 items-start">
              {/* Month label — fixed width sidebar */}
              <div className="w-16 shrink-0 pt-1.5 text-[10px] uppercase tracking-widest text-[var(--color-muted)] text-right pr-2">
                {monthLabel(days[0].date)}
              </div>

              {/* 5-column week grid — each cell placed by week-of-month */}
              <div className="flex-1 grid grid-cols-5 gap-1">
                {days.map((f) => {
                  const col = weekOfMonth(f.date);
                  const s = scoreByDate.get(f.date);
                  const c = competitorByDate.get(f.date);
                  const bg = film && s ? scoreColor(s.norm) : "var(--color-paper)";
                  const isHover = hovered === f.date;
                  const isSel = selected === f.date;
                  const isCandidate = candidates.has(f.date);
                  const canAdd = isCandidate || !candidates.isFull;
                  return (
                    <div
                      key={f.date}
                      className="relative"
                      style={{ gridColumn: col }}
                    >
                      <button
                        type="button"
                        onMouseEnter={() => setHovered(f.date)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(f.date)}
                        onBlur={() => setHovered(null)}
                        onClick={() => setSelected(f.date)}
                        style={{ background: bg }}
                        className={`w-full border px-1.5 py-1 text-left transition-all cursor-pointer ${
                          isSel
                            ? "border-[var(--color-ink)] border-[2px] z-10 shadow-md"
                            : isHover
                              ? "border-[var(--color-ink)] z-10"
                              : "border-[var(--color-line)] hover:border-[var(--color-ink)]"
                        } ${isCandidate ? "ring-2 ring-inset ring-[var(--color-ink)]" : ""} ${film && s ? "text-[var(--color-ink)]" : ""}`}
                      >
                        <div className="pr-4">
                          <span className="text-sm font-semibold tracking-tight leading-none">
                            {dayOfMonth(f.date)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-col gap-px">
                          {film && s && (
                            <span className="text-[8px] uppercase tracking-widest font-mono">
                              {cellValueLabel(colorMode, s.raw)}
                            </span>
                          )}
                          <span className="text-[8px] opacity-70">
                            {c?.openers ?? 0}o · {c?.holdovers ?? 0}h
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          candidates.toggle(f.date);
                        }}
                        disabled={!canAdd}
                        aria-pressed={isCandidate}
                        title={
                          isCandidate
                            ? "Remove from compare"
                            : canAdd
                              ? "Add to compare"
                              : `Compare holds ${candidates.max} weekends — remove one first`
                        }
                        className={`absolute top-0.5 right-0.5 z-20 flex h-4 w-4 items-center justify-center border text-[9px] leading-none transition-colors ${
                          isCandidate
                            ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                            : canAdd
                              ? "border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-ink)] opacity-70 hover:border-[var(--color-ink)] hover:opacity-100"
                              : "cursor-not-allowed border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-line)]"
                        }`}
                      >
                        {isCandidate ? "✓" : "+"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* RIGHT: sticky detail panel */}
        <div className="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          {activeFriday ? (
            <WeekendDetail
              dateIso={activeFriday.date}
              friday={activeFriday}
              score={scoreByDate.get(activeFriday.date)}
              forward={forward}
              decay={decay}
              scoreEntry={scoreData?.weekends.find((w) => w.weekend_date === activeFriday.date)}
              film={film}
              colorMode={colorMode}
              budgetMap={budgetMap}
              filters={filters}
              historicalOpeners={historicalByIso.get(isoWeekOf(activeFriday.date)) ?? []}
              pinned={selected === activeFriday.date}
              isPreview={hovered === activeFriday.date && selected !== activeFriday.date}
              onClose={() => setSelected(null)}
            />
          ) : (
            <div className="border border-dashed border-[var(--color-line)] p-6 text-sm text-[var(--color-muted)]">
              Hover or click a weekend to inspect.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


export function PresetSelector({
  preset,
  onPreset,
  compact = false,
}: {
  preset: PresetKey;
  onPreset: (k: PresetKey) => void;
  compact?: boolean;
}) {
  const w = PRESETS[preset].weights;
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        {(Object.keys(PRESETS) as PresetKey[]).map((k) => {
          const on = k === preset;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onPreset(k)}
              aria-pressed={on}
              className={`border px-2 py-1 text-[10px] uppercase tracking-widest transition-colors ${
                on
                  ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                  : "border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
              }`}
            >
              {PRESETS[k].label}
            </button>
          );
        })}
      </div>
      {!compact && (
        <span className="max-w-[26rem] text-left text-[10px] leading-snug text-[var(--color-muted)]">
          <span className="font-mono">
            open {(w.opening * 100).toFixed(0)}% · legs {(w.legs * 100).toFixed(0)}% · comp{" "}
            {(w.competition * 100).toFixed(0)}%
          </span>{" "}
          — {PRESETS[preset].rationale}
        </span>
      )}
    </div>
  );
}

export function ColorModeToggle({
  value,
  onChange,
  disabledModes = [],
}: {
  value: ColorMode;
  onChange: (m: ColorMode) => void;
  // Modes that should render but are non-interactive (e.g., when no film is loaded).
  disabledModes?: ColorMode[];
}) {
  const active = COLOR_MODES.find((m) => m.id === value);
  const isDisabled = (id: ColorMode) => disabledModes.includes(id);
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex border border-[var(--color-line)]">
        {COLOR_MODES.map((m) => {
          const on = m.id === value;
          const disabled = isDisabled(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => !disabled && onChange(m.id)}
              disabled={disabled}
              aria-pressed={on}
              title={disabled ? "Upload a film profile to use this lens" : undefined}
              className={`px-2.5 py-1 text-[10px] uppercase tracking-widest transition-colors ${
                on
                  ? "bg-[var(--color-ink)] text-white"
                  : disabled
                    ? "bg-[var(--color-paper)] text-[var(--color-line)] cursor-not-allowed"
                    : "bg-[var(--color-paper)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      {active && (
        <span className="max-w-[20rem] text-left text-[10px] leading-snug text-[var(--color-muted)]">
          {active.blurb}
          {disabledModes.length > 0 && (
            <span className="block mt-0.5 italic">
              Upload a film profile to unlock competition + combined lenses.
            </span>
          )}
        </span>
      )}
    </div>
  );
}


function WeekendDetail({
  friday,
  score,
  forward,
  decay,
  scoreEntry,
  film,
  colorMode,
  budgetMap,
  filters,
  historicalOpeners,
  pinned,
  isPreview,
}: {
  dateIso: string;
  friday: Friday;
  score?: { raw: number; norm: number };
  forward: ForwardSchedule;
  decay: DecayCurves;
  scoreEntry?: WeekendScore;
  film: CandidateFilm | null;
  colorMode: ColorMode;
  budgetMap: Record<number, number | null>;
  filters: {
    category: CategoryFilter;
    mpaa: string | null;
    distributors: Set<string>;
    genres: Set<string>;
  };
  historicalOpeners: WeekSummary["top_films"];
  pinned: boolean;
  isPreview: boolean;
  onClose: () => void;
}) {
  // Merge: openers + holdovers from forward schedule, decorated with similarity from the API.
  // Apply the same filters as the cell counts so the side panel reflects the current view.
  const active = activeFilmsOn(friday.date, forward.items, decay).filter((h) => {
    if (!matchesCategoryFilter(h.film.distributor, filters.category)) return false;
    if (filters.mpaa && h.film.mpaa !== filters.mpaa) return false;
    if (
      filters.distributors.size > 0 &&
      !filters.distributors.has(h.film.distributor ?? "")
    )
      return false;
    if (
      filters.genres.size > 0 &&
      !(h.film.genres ?? []).some((g) => filters.genres.has(g))
    )
      return false;
    return true;
  });
  const simByFilmId = new Map<number, CompetitorSlot>();
  if (scoreEntry) {
    for (const c of scoreEntry.competition_top) {
      if (c.film_id != null) simByFilmId.set(c.film_id, c);
    }
  }

  const decorated = active.map((h) => {
    const fid = h.film.film_id ?? h.film.id;
    const sim = simByFilmId.get(fid);
    return {
      film: h.film,
      week_n: h.week_n,
      retention: h.retention,
      similarity: sim?.similarity,
      budget: budgetMap[fid] ?? null,
    };
  });

  type Decorated = typeof decorated[number];
  const byTitle = (a: Decorated, b: Decorated) =>
    a.film.title.toLowerCase().localeCompare(b.film.title.toLowerCase());

  // Sort primarily by similarity to the candidate film (closest competitors first).
  // When no film is loaded similarity is undefined for everyone, so we fall back to a
  // sensible secondary order (distributor rank for openers, retention for holdovers).
  function bySimilarity(secondary: (a: Decorated, b: Decorated) => number) {
    return (a: Decorated, b: Decorated) => {
      const sa = a.similarity ?? -1;
      const sb = b.similarity ?? -1;
      if (sb !== sa) return sb - sa;
      return secondary(a, b);
    };
  }

  const openers = decorated
    .filter((d) => d.week_n === 1)
    .sort(
      bySimilarity(
        (a, b) =>
          distributorRank(a.film.distributor) - distributorRank(b.film.distributor) ||
          byTitle(a, b)
      )
    );
  const holdovers = decorated
    .filter((d) => d.week_n > 1)
    .sort(bySimilarity((a, b) => b.retention - a.retention || byTitle(a, b)));

  return (
    <div
      className={`border bg-[var(--color-paper)] ${
        pinned ? "border-[var(--color-ink)] border-[2px]" : "border-[var(--color-line)]"
      }`}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--color-line)] flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-[var(--color-muted)]">
            {isPreview ? "Preview" : "Pinned"}
          </div>
          <div className="mt-1 text-xl font-semibold tracking-tight truncate">
            {friday.label}
          </div>
          <div className="text-[10px] font-mono text-[var(--color-muted)] mt-0.5">
            ISO W{isoWeekOf(friday.date)}
          </div>
        </div>
        {score && (
          <div className="text-right shrink-0">
            <div className="text-[9px] uppercase tracking-widest text-[var(--color-muted)] mb-0.5">
              {MODE_LABEL[colorMode]}
            </div>
            <Hint
              side="below"
              align="right"
              width="20rem"
              body={
                <>
                  <strong>{COLOR_MODES.find((m) => m.id === colorMode)?.label} lens.</strong>{" "}
                  {COLOR_MODES.find((m) => m.id === colorMode)?.blurb} Values are min-max
                  normalized across your candidate weekends, so this is <em>relative</em>:
                  it ranks weekends against each other, not an absolute box-office
                  prediction.
                </>
              }
            >
              <span className="font-mono text-xl leading-none">
                {cellValueLabel(colorMode, score.raw)}
              </span>
            </Hint>
            <div className="text-[10px] text-[var(--color-muted)] mt-1">
              rank {(score.norm * 100).toFixed(0)} / 100
            </div>
          </div>
        )}
      </div>

      {/* Stacked openers / holdovers (narrower panel = vertical stack) */}
      <div className="px-5 py-4 space-y-5">
        <FilmGroup
          title={`Opening (${openers.length})`}
          films={openers}
          film={film}
        />
        <FilmGroup
          title={`Holdovers (${holdovers.length})`}
          films={holdovers}
          film={film}
          mode="holdover"
        />

        {/* Historical evidence — what actually opened in this ISO week, 2015–25. */}
        {historicalOpeners.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-widest text-[var(--color-muted)] mb-3">
              Historically opened this week · ISO W{isoWeekOf(friday.date)}
            </div>
            <ul className="divide-y divide-[var(--color-line)] border-t border-b border-[var(--color-line)]">
              {historicalOpeners.slice(0, 6).map((f, i) => (
                <li
                  key={`${f.film_id}-${i}`}
                  className="flex items-baseline justify-between gap-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm">
                    <span className="font-medium">{f.title}</span>{" "}
                    <span className="text-[var(--color-muted)]">{f.year}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--color-muted)]">
                    {formatBudget(f.gross_usd)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

type DecoratedFilm = {
  film: {
    id: number;
    film_id: number | null;
    title: string;
    distributor: string | null;
    tier: string;
    mpaa: string | null;
    is_franchise: boolean | null;
  };
  week_n: number;
  retention: number;
  similarity?: number;
  budget: number | null;
};

function FilmGroup({
  title,
  films,
  film,
  mode = "opener",
}: {
  title: string;
  films: DecoratedFilm[];
  film: CandidateFilm | null;
  mode?: "opener" | "holdover";
}) {
  if (films.length === 0) {
    return (
      <div>
        <div className="text-xs uppercase tracking-widest text-[var(--color-muted)] mb-3">
          {title}
        </div>
        <div className="text-sm italic text-[var(--color-muted)]">None.</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-[var(--color-muted)] mb-3">
        {title}
      </div>
      <ul className="divide-y divide-[var(--color-line)] border-t border-b border-[var(--color-line)]">
        {films.map((d, i) => (
          <FilmRow key={`${d.film.id}-${i}`} d={d} film={film} mode={mode} />
        ))}
      </ul>
    </div>
  );
}

function FilmRow({
  d,
  film,
  mode,
}: {
  d: DecoratedFilm;
  film: CandidateFilm | null;
  mode: "opener" | "holdover";
}) {
  const top = isTopDistributor(d.film.distributor);
  const display = cleanTitle(d.film.title);
  const tierClass =
    d.film.tier === "indie"
      ? "border-l-[var(--color-accent)]"
      : d.film.tier === "industry"
        ? "border-l-[var(--color-ink)]"
        : "border-l-[var(--color-line)]";
  return (
    <li className={`border-l-2 ${tierClass} pl-3 py-2.5`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{display}</span>
            {top && (
              <span className="text-[9px] uppercase tracking-widest text-[var(--color-muted)]">
                top studio
              </span>
            )}
            {d.film.is_franchise && (
              <span className="text-[9px] uppercase tracking-widest text-[var(--color-accent)]">
                franchise
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-baseline gap-2 text-[11px] text-[var(--color-muted)] flex-wrap">
            {d.film.distributor && (
              <span className="truncate max-w-[14rem]">{d.film.distributor}</span>
            )}
            {d.film.mpaa && <span className="font-mono">{d.film.mpaa}</span>}
            {d.budget != null && (
              <span className="font-mono">{formatBudget(d.budget)} budget</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0 flex flex-col items-end whitespace-nowrap">
          {mode === "holdover" && (
            <span className="font-mono text-[11px] text-[var(--color-muted)] whitespace-nowrap">
              <Hint
                align="right"
                body={
                  <>
                    <strong>Holdover retention.</strong> W{d.week_n} is this film&apos;s
                    weekend number since release. The percent is how much of its box
                    office it&apos;s still holding relative to its opening — higher means
                    it has strong legs and is still drawing audiences this weekend.
                  </>
                }
              >
                W{d.week_n} · {Math.round(d.retention * 100)}%
              </Hint>
            </span>
          )}
          {film && d.similarity != null && (
            <span
              className={`font-mono text-[11px] mt-0.5 whitespace-nowrap ${
                d.similarity >= SIM_THRESHOLDS.clash
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-muted)]"
              }`}
            >
              <Hint
                align="right"
                body={
                  <>
                    <strong>Similarity (0–1).</strong> How much this competitor overlaps
                    with your film&apos;s target audience — a weighted blend of genre overlap,
                    release-window proximity, distributor tier, and MPAA rating. Values
                    above 0.4 are highlighted to flag direct head-to-head competition.
                  </>
                }
              >
                sim {d.similarity.toFixed(2)}
              </Hint>
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
