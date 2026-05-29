"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

// Candidate weekends are selected directly on the calendar grid and consumed by the
// compare section below it. Lifting this into a shared context lets the two sibling
// components (grid + compare) stay in sync without prop-drilling through the page.

export const MAX_CANDIDATES = 4;

type CompareSelectionValue = {
  weekends: string[];
  has: (date: string) => boolean;
  toggle: (date: string) => void;
  remove: (date: string) => void;
  clear: () => void;
  setWeekends: (next: string[]) => void;
  isFull: boolean;
  max: number;
};

const Ctx = createContext<CompareSelectionValue | null>(null);

function defaultWeekends(initial?: string[]): string[] {
  return initial ?? [];
}

export function CompareSelectionProvider({
  initialWeekends,
  children,
}: {
  initialWeekends?: string[];
  children: React.ReactNode;
}) {
  const [weekends, setWeekends] = useState<string[]>(() =>
    defaultWeekends(initialWeekends)
  );

  const has = useCallback((date: string) => weekends.includes(date), [weekends]);

  const toggle = useCallback((date: string) => {
    setWeekends((cur) => {
      if (cur.includes(date)) return cur.filter((d) => d !== date);
      if (cur.length >= MAX_CANDIDATES) return cur;
      // Keep chronological order so the side-by-side cards read left→right in time.
      return [...cur, date].sort();
    });
  }, []);

  const remove = useCallback((date: string) => {
    setWeekends((cur) => cur.filter((d) => d !== date));
  }, []);

  const clear = useCallback(() => setWeekends([]), []);

  const value = useMemo<CompareSelectionValue>(
    () => ({
      weekends,
      has,
      toggle,
      remove,
      clear,
      setWeekends,
      isFull: weekends.length >= MAX_CANDIDATES,
      max: MAX_CANDIDATES,
    }),
    [weekends, has, toggle, remove, clear]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompareSelection(): CompareSelectionValue {
  const v = useContext(Ctx);
  if (!v)
    throw new Error(
      "useCompareSelection must be used inside <CompareSelectionProvider>"
    );
  return v;
}
