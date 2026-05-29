"use client";

import Link from "next/link";
import { useCompareSelection } from "@/lib/compare-selection";

function shortLabel(dateIso: string): string {
  return new Date(dateIso + "T00:00:00Z").toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Shortlist summary bar — shared by the grid and graph views so the compare selection
// reads and behaves identically wherever you build it.
export function CandidateBar() {
  const { weekends, remove, clear, max } = useCompareSelection();
  return (
    <div className="flex flex-wrap items-center gap-2 border border-[var(--color-line)] bg-[var(--color-soft)] px-3 py-2.5">
      <span className="text-[10px] uppercase tracking-widest text-[var(--color-muted)]">
        Comparing
      </span>
      {weekends.length === 0 ? (
        <span className="text-xs italic text-[var(--color-muted)]">
          Tap the ＋ on any weekend to add it (up to {max}), then compare them below.
        </span>
      ) : (
        <>
          {weekends.map((d) => (
            <span
              key={d}
              className="inline-flex items-center gap-1 border border-[var(--color-ink)] bg-[var(--color-paper)] py-0.5 pl-2 pr-1 text-xs font-mono"
            >
              {shortLabel(d)}
              <button
                type="button"
                onClick={() => remove(d)}
                aria-label={`Remove ${shortLabel(d)}`}
                className="px-0.5 text-[var(--color-muted)] hover:text-[var(--color-accent)]"
              >
                ×
              </button>
            </span>
          ))}
          <span className="text-[10px] text-[var(--color-muted)]">
            {weekends.length}/{max}
          </span>
          <button
            type="button"
            onClick={clear}
            className="text-[10px] uppercase tracking-widest text-[var(--color-muted)] underline underline-offset-2 hover:text-[var(--color-ink)]"
          >
            Clear
          </button>
          <Link
            href="/compare"
            className="ml-auto text-[10px] uppercase tracking-widest text-[var(--color-ink)] underline underline-offset-2"
          >
            Compare →
          </Link>
        </>
      )}
    </div>
  );
}
