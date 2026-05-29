"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { CandidateFilm } from "@/lib/scoring/types";
import type { Weights } from "@/lib/scoring/types";
import { PRESETS, presetForGenres } from "@/lib/scoring/presets";
import type { CategoryFilter } from "@/lib/distributors";
import * as store from "./film-store";
import type { SavedFilm } from "./film-store";

type FilmContextValue = {
  films: SavedFilm[];
  active: SavedFilm | null;
  ready: boolean;
  userSelected: boolean;
  setActive: (id: string | null) => void;
  save: (film: CandidateFilm) => SavedFilm;
  remove: (id: string) => void;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  // Scoring weights — shared across WeekendGrid and CompareView so one set of
  // sliders in the filter panel drives both. Resets to the film's auto-preset
  // when the active film changes.
  weights: Weights;
  setWeights: (w: Weights) => void;
  // Competition filters — shared so the grid and the compare cards score against the
  // exact same competitive frame. Changing a filter updates both surfaces identically.
  filters: CompetitionFilters;
  setCategoryFilter: (c: CategoryFilter) => void;
  setMpaaFilter: (m: string | null) => void;
  setDistributorFilter: (d: Set<string>) => void;
  clearFilters: () => void;
};

export type CompetitionFilters = {
  // Distributor category — "all" = the curated universe (default), "studio" / "prestige"
  // narrow it further. Films outside the universe never appear under any of these.
  category: CategoryFilter;
  mpaa: string | null;
  distributors: Set<string>;
};

const Ctx = createContext<FilmContextValue | null>(null);

// Stable callbacks for the "are we past hydration?" useSyncExternalStore below — kept at
// module scope so their identity doesn't change across renders.
const noopSubscribe = () => () => {};
const getClientTrue = () => true;
const getServerFalse = () => false;

export function FilmProvider({ children }: { children: React.ReactNode }) {
  // Read the localStorage-backed store via useSyncExternalStore — no mount effect, and
  // the server/first-client snapshots match so hydration is clean.
  const films = useSyncExternalStore(
    store.subscribe,
    store.getFilmsSnapshot,
    store.getFilmsServerSnapshot
  );
  const activeId = useSyncExternalStore(
    store.subscribe,
    store.getActiveIdSnapshot,
    store.getActiveIdServerSnapshot
  );
  // `ready` flips true once we're past hydration (server snapshot → client snapshot).
  const ready = useSyncExternalStore(noopSubscribe, getClientTrue, getServerFalse);
  const [userSelected, setUserSelected] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  const [weights, setWeightsState] = useState<Weights>(PRESETS.default.weights);
  const setWeights = useCallback((w: Weights) => setWeightsState(w), []);

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [mpaaFilter, setMpaaFilter] = useState<string | null>(null);
  const [distributorFilter, setDistributorFilter] = useState<Set<string>>(new Set());
  const clearFilters = useCallback(() => {
    setCategoryFilter("all");
    setMpaaFilter(null);
    setDistributorFilter(new Set());
  }, []);
  const filters: CompetitionFilters = useMemo(
    () => ({ category: categoryFilter, mpaa: mpaaFilter, distributors: distributorFilter }),
    [categoryFilter, mpaaFilter, distributorFilter]
  );

  const active = films.find((f) => f.id === activeId) ?? null;

  // Reset weights to the film's auto-preset when the active film changes.
  const autoWeights = useMemo(() => {
    if (!active) return PRESETS.default.weights;
    const preset = presetForGenres(
      active.film.genres ?? [],
      active.film.genre_tags ?? []
    );
    return PRESETS[preset].weights;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Apply that reset as render-time "adjust state on change" rather than an effect.
  const [prevAutoWeights, setPrevAutoWeights] = useState(autoWeights);
  if (autoWeights !== prevAutoWeights) {
    setPrevAutoWeights(autoWeights);
    setWeightsState(autoWeights);
  }

  // film list + active id are now derived from the store via useSyncExternalStore, so
  // mutations just write to the store; emit() notifies subscribers and React re-renders.
  const setActive = useCallback((id: string | null) => {
    store.setActiveFilmId(id);
    setUserSelected(true);
  }, []);

  const save = useCallback((film: CandidateFilm): SavedFilm => {
    const saved = store.saveFilm(film);
    store.setActiveFilmId(saved.id);
    setUserSelected(true);
    return saved;
  }, []);

  const remove = useCallback(
    (id: string) => {
      store.deleteFilm(id);
      if (activeId === id) {
        store.setActiveFilmId(null);
      }
    },
    [activeId]
  );

  return (
    <Ctx.Provider value={{
      films, active, ready, userSelected,
      setActive, save, remove,
      modalOpen, openModal, closeModal,
      weights, setWeights,
      filters, setCategoryFilter, setMpaaFilter, setDistributorFilter, clearFilters,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useFilms(): FilmContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFilms must be used inside <FilmProvider>");
  return v;
}
