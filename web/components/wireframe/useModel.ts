"use client";

import { useEffect, useMemo, useState } from "react";
import { useFilms } from "@/lib/film-context";
import { useCompareSelection } from "@/lib/compare-selection";
import { nextWeekendFridays } from "@/lib/holdovers";
import { computeMidpoint, type ClientScoreDeps } from "@/lib/scoring/score-client";
import type { CandidateFilm, ComparableFilm, WeekendScore } from "@/lib/scoring/types";
import {
  buildCompetitors,
  buildDemand,
  directCompetitors,
  scoreWeekends,
  suggestShortlist,
  toCandidate,
  type CandidateModel,
  type Competitor,
  type DemandPoint,
  type DirectComp,
} from "@/lib/wireframe-data";

export type WireframeModel = {
  film: CandidateFilm;
  baselineTier: "industry" | "indie";
  // Per-candidate auto-tuned competition midpoint. Consumers that build their own
  // absolute-sigmoid signals (the congestion curve, clash bands) should reuse this so
  // the calibration agrees with the calendar grid + compare cards.
  midpoint: number;
  demand: DemandPoint[];
  competitors: Competitor[];
  direct: DirectComp[];
  scored: WeekendScore[];
  byDate: Map<string, WeekendScore>;
  shortlistDates: string[];
  usingSuggestion: boolean;
  candidates: CandidateModel[];
  comparable: ComparableFilm[];
};

// Centralizes the real-data derivation shared by all three concept views: scores the
// next 52 Fridays with the live scorer (same as the calendar/compare surfaces), builds
// the demand strip + competitive field, and resolves the active shortlist.
export function useWireframeModel(deps: ClientScoreDeps): WireframeModel | null {
  const { active } = useFilms();
  const { weights, filters } = useFilms();
  const { weekends: selected } = useCompareSelection();
  const film = active?.film ?? null;
  const filmKey = film ? JSON.stringify(film) : "";

  // Fix #2: baseline tracks the candidate film, not the filter lens. Filters narrow the
  // competition; the candidate's peer median is intrinsic.
  const baselineTier: "industry" | "indie" = film?.tier ?? "industry";

  // Same competitor filter the grid applies, so graph and grid score against an identical
  // competitive set. Always non-null in the live UI ("all" still restricts to the curated
  // universe).
  const competitorFilter = useMemo(() => {
    const dists = [...filters.distributors].sort();
    const genres = [...filters.genres].sort();
    return { category: filters.category, mpaa: filters.mpaa, distributors: dists, genres };
  }, [filters.category, filters.mpaa, filters.distributors, filters.genres]);
  const competitorFilterKey = JSON.stringify(competitorFilter);

  const allFridays = useMemo(() => nextWeekendFridays(52).map((f) => f.date), []);

  // Auto-tuned per candidate: shared across scoreWeekends, congestionSeries, and the
  // shortlist sub-scores so every absolute-sigmoid call in this render lines up.
  const midpoint = useMemo(() => {
    if (!film) return 1.0;
    return computeMidpoint(film, deps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmKey, deps.forward]);

  const scored = useMemo(() => {
    if (!film) return [];
    return scoreWeekends(film, allFridays, weights, deps, baselineTier, competitorFilter, midpoint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmKey, weights, baselineTier, competitorFilterKey, allFridays, midpoint]);

  const demand = useMemo(
    () => buildDemand(baselineTier === "indie" ? deps.weeklyIndie : deps.weeklyIndustry),
    [deps.weeklyIndie, deps.weeklyIndustry, baselineTier]
  );

  const competitors = useMemo(() => {
    if (!film) return [];
    return buildCompetitors(film, deps.forward.items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmKey, deps.forward]);

  const direct = useMemo(() => {
    if (!film) return [];
    return directCompetitors(film, deps.forward.items, competitorFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmKey, deps.forward, competitorFilterKey]);

  const [comparable, setComparable] = useState<ComparableFilm[]>([]);
  useEffect(() => {
    if (!film) return;
    let cancelled = false;
    fetch("/api/comparable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ film, n: 24 }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!cancelled) setComparable(d.comparable_films ?? []);
      })
      .catch(() => {
        if (!cancelled) setComparable([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmKey]);

  const byDate = useMemo(
    () => new Map(scored.map((r) => [r.weekend_date, r])),
    [scored]
  );

  // Must mirror the shortlistDates branch below: a suggestion is only used when the
  // user has selected nothing. With one pick we surface that pick, not a suggestion.
  const usingSuggestion = selected.length === 0;
  const shortlistDates = useMemo(() => {
    if (selected.length >= 1) return [...selected].sort();
    return suggestShortlist(scored, 3);
  }, [selected, scored]);

  const candidates = useMemo(
    () =>
      shortlistDates
        .map((d) => byDate.get(d))
        .filter((r): r is WeekendScore => !!r)
        .map((r) => toCandidate(r, midpoint)),
    [shortlistDates, byDate, midpoint]
  );

  if (!film) return null;

  return {
    film,
    baselineTier,
    midpoint,
    demand,
    competitors,
    direct,
    scored,
    byDate,
    shortlistDates,
    usingSuggestion,
    candidates,
    comparable,
  };
}
