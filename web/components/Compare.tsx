"use client";

import Link from "next/link";
import { useCompareSelection } from "@/lib/compare-selection";
import { useFilms } from "@/lib/film-context";
import type { ClientScoreDeps } from "@/lib/scoring/score-client";
import { formatMoney } from "@/lib/format";
import { SUB_LABELS, type CandidateModel } from "@/lib/wireframe-data";
import { Radar } from "./wireframe/Radar";
import { useWireframeModel } from "./wireframe/useModel";

// Standalone Compare page: the shortlisted weekends (built in Landscape) scored side by
// side on the four sub-criteria, with the tradeoffs spelled out in words. No composite
// ranking — comparison is the output, not a verdict.
export function Compare({ deps }: { deps: ClientScoreDeps }) {
  const model = useWireframeModel(deps);
  const selection = useCompareSelection();
  const { openModal } = useFilms();

  if (!model) {
    return (
      <Shell>
        <div className="border border-dashed border-[var(--color-line)] p-8 text-sm text-[var(--color-muted)] space-y-3">
          <div>No film selected — pick one from the header or upload a profile to score weekends.</div>
          <button
            type="button"
            onClick={openModal}
            className="inline-block border border-[var(--color-accent)] bg-[var(--color-accent)] text-white px-4 py-2 text-sm hover:bg-[var(--color-paper)] hover:text-[var(--color-accent)] transition"
          >
            Upload a film →
          </button>
        </div>
      </Shell>
    );
  }

  const { candidates, usingSuggestion, film } = model;

  // Remove a weekend card. If it's already a user selection, just drop it. If we're showing
  // the auto-suggested set, materialize the suggestion into the selection minus this card so
  // the removal sticks.
  function removeCard(date: string) {
    if (selection.has(date)) {
      selection.remove(date);
    } else {
      selection.setWeekends(candidates.filter((c) => c.date !== date).map((c) => c.date));
    }
  }

  return (
    <Shell>
      <div className="max-w-3xl">
        <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
          Compare · {film.title || "your film"}
        </div>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">
          Side-by-side weekend comparison.
        </h1>
        <p className="mt-4 text-base text-[var(--color-muted)] leading-relaxed">
          Candidate weekends scored on the four sub-criteria — demand, openness, audience
          differentiation, and historical legs — using the same scoring engine as the
          Landscape grid. No composite ranking; per-weekend tradeoffs are surfaced below.
        </p>
      </div>

      {usingSuggestion && (
        <div className="border border-[var(--color-line)] bg-[var(--color-soft)] px-4 py-3 text-sm text-[var(--color-muted)] flex items-center justify-between gap-4 flex-wrap">
          <span>
            Showing an auto-suggested selection — the strongest weekends by aggregate
            score. Build your own from the Landscape view using the ＋ buttons.
          </span>
          <Link href="/" className="underline underline-offset-2 hover:text-[var(--color-ink)] shrink-0">
            Open Landscape →
          </Link>
        </div>
      )}

      {candidates.length < 2 ? (
        <div className="border border-dashed border-[var(--color-line)] p-8 text-sm text-[var(--color-muted)]">
          Select at least two weekends to compare. Use the{" "}
          <Link href="/" className="underline underline-offset-2 hover:text-[var(--color-ink)]">
            Landscape view
          </Link>{" "}
          to add candidates with the ＋ buttons.
        </div>
      ) : (
        <>
          <section className="border border-[var(--color-line)] bg-[var(--color-paper)] overflow-x-auto">
            <div
              className="grid min-w-[640px]"
              style={{ gridTemplateColumns: `170px repeat(${candidates.length}, 1fr)` }}
            >
              <div className="px-4 py-4 border-b border-[var(--color-line)]" />
              {candidates.map((c) => (
                <div key={c.date} className="px-4 py-4 border-b border-l border-[var(--color-line)]">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
                        ◆ Window
                      </div>
                      <div className="font-semibold tracking-tight">{c.label}</div>
                      <div className="text-[11px] text-[var(--color-muted)]">ISO week {c.week}</div>
                    </div>
                    <button
                      onClick={() => removeCard(c.date)}
                      aria-label={`Remove ${c.label}`}
                      title="Remove from comparison"
                      className="text-[var(--color-muted)] hover:text-[var(--color-accent)] text-base leading-none"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}

              {SUB_LABELS.map((row, ri) => (
                <Row key={row.key} label={row.label} hint={row.hint} last={ri === SUB_LABELS.length - 1}>
                  {candidates.map((c) => (
                    <Cell key={c.date} last={ri === SUB_LABELS.length - 1}>
                      <ScoreBar value={c.sub[row.key]} />
                    </Cell>
                  ))}
                </Row>
              ))}

              <div className="px-4 py-5 text-xs uppercase tracking-widest text-[var(--color-muted)]">
                Shape
              </div>
              {candidates.map((c) => (
                <div key={c.date} className="px-4 py-5 border-l border-[var(--color-line)] flex justify-center">
                  <Radar sub={c.sub} />
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
              Weekend analysis — tradeoffs and direct competition
            </div>
            <div
              className="grid grid-cols-1 gap-4"
              style={{ gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))` }}
            >
              {candidates.map((c) => (
                <Footnote key={c.date} candidate={c} />
              ))}
            </div>
            <p className="text-[11px] text-[var(--color-muted)] italic pt-2">
              Sub-scores are oriented so higher = more favorable. Demand, openness, and
              comp record are min-max normalized across the next 52 weekends. A composite
              ranking is intentionally omitted — the tool surfaces tradeoffs; the
              distribution team makes the call.
            </p>
          </section>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="max-w-7xl mx-auto px-8 py-12 space-y-8">{children}</div>;
}

function Row({
  label,
  hint,
  last,
  children,
}: {
  label: string;
  hint: string;
  last: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className={`px-4 py-4 ${last ? "" : "border-b border-[var(--color-line)]"}`}>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[10px] text-[var(--color-muted)] leading-tight mt-0.5">{hint}</div>
      </div>
      {children}
    </>
  );
}

function Cell({ last, children }: { last: boolean; children: React.ReactNode }) {
  return (
    <div className={`px-4 py-4 border-l border-[var(--color-line)] ${last ? "" : "border-b"}`}>
      {children}
    </div>
  );
}

function ScoreBar({ value }: { value: number }) {
  const strong = value >= 70;
  const weak = value < 45;
  const color = strong ? "var(--color-ink)" : weak ? "var(--color-accent)" : "var(--color-muted)";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-[var(--color-soft)] rounded-sm overflow-hidden">
        <div className="h-full rounded-sm" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-[11px] tabular-nums text-[var(--color-muted)] w-6 text-right">{value}</span>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Footnote({ candidate }: { candidate: CandidateModel }) {
  const { sub, raw, label, week } = candidate;

  const demandPhrase =
    sub.demand >= 70
      ? "strong seasonal demand for openers"
      : sub.demand >= 45
        ? "moderate seasonal demand"
        : "soft seasonal demand";
  const fieldPhrase =
    sub.openness >= 70
      ? "a wide-open field"
      : sub.openness >= 45
        ? "a moderately crowded field"
        : "a crowded field overall";
  const directClash = sub.lowClash < 45;
  const clashPhrase = directClash
    ? "and direct same-audience competition"
    : sub.lowClash < 70
      ? "with some overlap for your audience"
      : "and little that targets your audience";
  const compsPhrase =
    sub.comps >= 70
      ? " Similar films have historically legged out well around this week — a window that rewards word of mouth."
      : sub.comps < 40
        ? " Similar films tended to fade fast here, so the opening weekend has to carry it."
        : "";

  return (
    <div className="border border-[var(--color-line)] p-4 text-sm bg-[var(--color-paper)]">
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-[11px] text-[var(--color-muted)]">
          ISO week {week} · peer films open ≈ {formatMoney(raw.demandUsd)}
        </div>
      </div>

      <p className="text-xs leading-relaxed mt-2">
        {cap(demandPhrase)} in {fieldPhrase},{" "}
        <span className={directClash ? "text-[var(--color-accent)] font-medium" : ""}>{clashPhrase}</span>.
        {compsPhrase}
      </p>

      <div className="space-y-1.5 mt-3">
        {candidate.flags.length === 0 ? (
          <div className="text-xs text-[var(--color-muted)]">Balanced across the board.</div>
        ) : (
          candidate.flags.map((f) => (
            <div key={f.text} className="flex gap-2 text-xs">
              <span>{f.tone === "good" ? "◦" : f.tone === "warn" ? "⚠" : "•"}</span>
              <span className={f.tone === "warn" ? "text-[var(--color-accent)]" : ""}>{f.text}</span>
            </div>
          ))
        )}
      </div>

      {/* The specific titles fighting for the same audience this weekend. */}
      <div className="mt-3 pt-3 border-t border-[var(--color-line)]">
        <div className="text-[10px] uppercase tracking-widest text-[var(--color-muted)] mb-1.5">
          Competing for the same audience
        </div>
        {candidate.inWindow.length === 0 ? (
          <div className="text-xs text-[var(--color-muted)] italic">No similar releases in this window.</div>
        ) : (
          <ul className="space-y-1 text-xs">
            {candidate.inWindow.map((s, i) => (
              <li key={i} className="flex items-baseline gap-1.5">
                <span
                  className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: s.overlap === "high" ? "var(--color-accent)" : "var(--color-line)" }}
                />
                <span>
                  <span className="text-[var(--color-ink)]">{s.title}</span>{" "}
                  <span className="text-[var(--color-muted)]">
                    ({s.weekN === 1 ? "opens here" : `holdover wk ${s.weekN}`}
                    {s.overlap === "high" ? ", high overlap" : ""})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
