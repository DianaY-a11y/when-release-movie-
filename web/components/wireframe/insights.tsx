"use client";

import { formatMoney } from "@/lib/format";
import { MONTHS, type CandidateModel } from "@/lib/wireframe-data";
import type { ComparableFilm } from "@/lib/scoring/types";
import { Radar } from "./Radar";

// Full-year x-position (the scatter is never zoomed).
const xFull = (week: number) => ((week - 0.5) / 52) * 100;

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">{children}</div>;
}

// Similar films plotted by release week (x) vs. opening gross (y); size/shade = similarity.
export function CompScatter({ comps }: { comps: ComparableFilm[] }) {
  const pts = comps.filter((c) => c.opening_usd != null && c.iso_week != null);
  const maxOpen = Math.max(1, ...pts.map((c) => c.opening_usd ?? 0));
  const y = (usd: number) => 100 - (usd / maxOpen) * 100;
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => f * maxOpen);

  if (pts.length === 0) {
    return (
      <div className="border border-[var(--color-line)] p-8 text-sm text-[var(--color-muted)]">
        No comparable titles with reported opening grosses yet.
      </div>
    );
  }

  return (
    <div className="border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
      <div className="relative h-64">
        {ticks.map((v) => (
          <div
            key={v}
            className="absolute left-0 right-0 border-t border-dashed border-[var(--color-line)]/60"
            style={{ top: `${y(v)}%` }}
          >
            <span className="absolute -left-1 -top-2 text-[10px] text-[var(--color-muted)] bg-[var(--color-paper)] pr-1">
              {formatMoney(v)}
            </span>
          </div>
        ))}
        {pts.map((c) => {
          const size = 8 + c.similarity * 16;
          return (
            <div
              key={c.film_id}
              className="absolute -translate-x-1/2 -translate-y-1/2 group"
              style={{ left: `${xFull(c.iso_week)}%`, top: `${y(c.opening_usd ?? 0)}%` }}
            >
              <span
                className="block rounded-full border border-[var(--color-paper)]"
                style={{ width: size, height: size, background: `rgba(183,58,43,${0.35 + c.similarity * 0.5})` }}
              />
              <span className="absolute left-1/2 -translate-x-1/2 -top-4 text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                {c.title} · {formatMoney(c.opening_usd ?? 0)}
                {c.multiplier ? ` · ${c.multiplier.toFixed(1)}×` : ""} · sim {c.similarity.toFixed(2)}
              </span>
            </div>
          );
        })}
        <div className="absolute left-0 right-0 -bottom-6 h-6">
          {MONTHS.map((m, i) => (
            <span
              key={m}
              className="absolute text-[10px] uppercase tracking-wider text-[var(--color-muted)]"
              style={{ left: `${(i / 12) * 100}%` }}
            >
              {m}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-8 text-[11px] text-[var(--color-muted)]">
        Y = opening gross · X = release week · dot size & shade = similarity to your film
      </div>
    </div>
  );
}

export function DrillIn({
  candidate,
  comps,
  inShortlist,
  canAdd,
  onToggle,
}: {
  candidate: CandidateModel;
  comps: ComparableFilm[];
  inShortlist: boolean;
  canAdd: boolean;
  onToggle: () => void;
}) {
  const nearComps = comps
    .filter((c) => c.iso_week != null && Math.abs(c.iso_week - candidate.week) <= 3)
    .slice(0, 4);
  return (
    <div className="border border-[var(--color-line)] bg-[var(--color-paper)]">
      <div className="px-5 py-4 border-b border-[var(--color-line)]">
        <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Weekend</div>
        <div className="text-lg font-semibold tracking-tight">{candidate.label}</div>
        <div className="text-xs text-[var(--color-muted)] mt-0.5">ISO week {candidate.week}</div>
      </div>

      <div className="px-5 py-4 flex flex-col items-center">
        <Radar sub={candidate.sub} size={190} />
        <div className="mt-2 text-[11px] text-[var(--color-muted)] italic text-center">
          The shape is the verdict — all four axes oriented so further out is better.
        </div>
      </div>

      <Block title="Competing for your audience here">
        {candidate.inWindow.length === 0 ? (
          <li className="list-none text-[var(--color-muted)]">Nothing similar in the window.</li>
        ) : (
          candidate.inWindow.map((s, i) => (
            <li key={i}>
              {s.title}{" "}
              <span className="text-[var(--color-muted)]">
                ({s.weekN === 1 ? "opens here" : `holdover wk ${s.weekN}`}
                {s.overlap === "high" ? ", high overlap" : ""})
              </span>
            </li>
          ))
        )}
      </Block>

      <Block title="Comps released near this week">
        {nearComps.length === 0 ? (
          <li className="list-none text-[var(--color-muted)]">No close analogs opened near here.</li>
        ) : (
          nearComps.map((c) => (
            <li key={c.film_id}>
              {c.title}{" "}
              <span className="text-[var(--color-muted)]">
                wk {c.iso_week}
                {c.multiplier ? ` · ${c.multiplier.toFixed(1)}×` : ""}
              </span>
            </li>
          ))
        )}
      </Block>

      <div className="px-5 py-4 border-t border-[var(--color-line)] space-y-3">
        {candidate.flags.map((f) => (
          <div key={f.text} className="flex gap-2 text-xs">
            <span>{f.tone === "good" ? "◦" : f.tone === "warn" ? "⚠" : "•"}</span>
            <span className={f.tone === "warn" ? "text-[var(--color-accent)]" : ""}>{f.text}</span>
          </div>
        ))}
        <button
          onClick={onToggle}
          disabled={!canAdd}
          className="w-full mt-1 px-3 py-2 text-xs border transition-colors disabled:opacity-40"
          style={
            inShortlist
              ? { borderColor: "var(--color-ink)", background: "var(--color-ink)", color: "#fff" }
              : { borderColor: "var(--color-accent)", color: "var(--color-accent)" }
          }
        >
          {inShortlist ? "✓ On shortlist — remove" : "+ Add to shortlist"}
        </button>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-t border-[var(--color-line)]">
      <div className="text-[11px] uppercase tracking-widest text-[var(--color-muted)] mb-2">{title}</div>
      <ul className="text-xs space-y-1.5 list-disc pl-4 marker:text-[var(--color-line)]">{children}</ul>
    </div>
  );
}
