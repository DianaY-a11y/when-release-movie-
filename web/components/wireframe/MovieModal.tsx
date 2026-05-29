"use client";

import { useEffect } from "react";
import type { CandidateFilm } from "@/lib/scoring/types";
import type { ForwardItem } from "@/lib/types";
import { competitorSimDetail, labelOf, OVERLAP_STYLE } from "@/lib/wireframe-data";

export function MovieModal({
  item,
  film,
  onClose,
}: {
  item: ForwardItem;
  film: CandidateFilm;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const detail = competitorSimDetail(film, item);
  const overlapStyle = OVERLAP_STYLE[detail.overlap];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-paper)] border border-[var(--color-line)] w-full max-w-lg max-h-[88vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[var(--color-line)]">
          <div>
            <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
              Competitor
            </div>
            <h2 className="text-xl font-semibold tracking-tight">{item.title}</h2>
            <div className="text-sm text-[var(--color-muted)] mt-0.5">
              {labelOf(item.release_date)} · ISO week {item.iso_week}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--color-muted)] hover:text-[var(--color-ink)] text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 flex gap-5">
          {item.poster_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.poster_url}
              alt={item.title}
              className="w-24 h-36 object-cover border border-[var(--color-line)] shrink-0"
            />
          ) : (
            <div className="w-24 h-36 border border-dashed border-[var(--color-line)] shrink-0 flex items-center justify-center text-[10px] text-[var(--color-muted)] text-center px-2">
              no poster
            </div>
          )}
          <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 content-start">
            <Meta label="Studio" value={item.distributor ?? "—"} />
            <Meta label="Genres" value={item.genres?.join(", ") || "—"} />
            <Meta label="Rating" value={item.mpaa ?? "—"} />
            <Meta
              label="Tier"
              value={item.tier === "indie" ? "Indie / Prestige" : item.tier === "industry" ? "Major studio" : "Unknown"}
            />
            <Meta label="Release" value={item.format_flags?.join(", ") || "—"} />
            <Meta label="Runtime" value={item.runtime_minutes ? `${item.runtime_minutes} min` : "—"} />
            {item.is_franchise != null && <Meta label="Franchise" value={item.is_franchise ? "Yes" : "No"} />}
          </dl>
        </div>

        <div className="px-6 pb-6">
          <div className="border border-[var(--color-line)] bg-[var(--color-soft)] p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
                Overlap with {film.title || "your film"}
              </div>
              <span
                className="text-[11px] px-2 py-0.5 rounded-sm"
                style={{
                  background: overlapStyle.fill,
                  color: detail.overlap === "high" ? "#fff" : "var(--color-ink)",
                  border: detail.overlap === "none" ? "1px solid var(--color-line)" : "none",
                }}
              >
                {detail.overlap === "high" ? "Direct competitor" : detail.overlap === "some" ? "Partial overlap" : "Different audience"}
              </span>
            </div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">
              {Math.round(detail.total * 100)}
              <span className="text-base text-[var(--color-muted)] font-normal"> / 100 similarity</span>
            </div>

            <div className="mt-4 space-y-2.5">
              {detail.parts.map((p) => (
                <div key={p.label}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span>{p.label}</span>
                    <span className="text-[var(--color-muted)] tabular-nums">
                      +{Math.round(p.points * 100)} <span className="opacity-50">/ {Math.round(p.max * 100)}</span>
                    </span>
                  </div>
                  <div className="h-2 bg-[var(--color-paper)] rounded-sm overflow-hidden border border-[var(--color-line)]">
                    <div
                      className="h-full rounded-sm"
                      style={{ width: `${(p.points / p.max) * 100}%`, background: "var(--color-accent)" }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-[var(--color-muted)] italic">
              Similarity = 0.70·genre + 0.15·MPAA + 0.15·tier. Films scoring ≥ 45 split your
              audience and feed the same-audience band.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--color-muted)] text-[11px] uppercase tracking-wide pt-0.5">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
