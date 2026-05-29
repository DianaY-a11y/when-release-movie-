"use client";

import { useMemo, useRef, useState } from "react";
import { useCompareSelection } from "@/lib/compare-selection";
import { useFilms } from "@/lib/film-context";
import { nextWeekendFridays, isoWeekOf } from "@/lib/holdovers";
import { formatMoney } from "@/lib/format";
import type { ClientScoreDeps, CompetitorFilter } from "@/lib/scoring/score-client";
import type { FilmIndexItem, ForwardItem } from "@/lib/types";
import { Hint } from "./Hint";
import { MovieModal } from "./wireframe/MovieModal";
import { CandidateBar } from "./CandidateBar";
import {
  MONTHS,
  buildDemand,
  buildDemandForGenres,
  congestionBands,
  type CongestionPoint,
  type DemandPoint,
  type DirectComp,
} from "@/lib/wireframe-data";
import { useWireframeModel } from "./wireframe/useModel";

const LABEL_W = 150;
const xIn = (week: number, lo: number, hi: number) => ((week - lo + 0.5) / (hi - lo + 1)) * 100;
const MONTH_WEEK = MONTHS.map((_, i) => Math.round((i * 52) / 12) + 1);
const FULL_DOMAIN: [number, number] = [1, 52];
const CURVE_H = 132;
const CELL_ROW_H = 19;
const MIN_ZOOM_SPAN = 3;

// The competitive landscape as a single overlap-weighted curve: seasonal demand on top,
// the whole slate's competition collapsed into stacked magnitudes below, with only the
// direct (same-audience) threats named as cells. Troughs in the dark band are the white
// space. Click a week to add/remove it from your compare shortlist; click a named
// competitor for its breakdown. Built off the same live scorer as the grid.
export function CongestionGraph({
  deps,
  weeks = 52,
  filmIndex = null,
}: {
  deps: ClientScoreDeps;
  weeks?: number;
  filmIndex?: FilmIndexItem[] | null;
}) {
  const { active, filters } = useFilms();
  const film = active?.film ?? null;
  const model = useWireframeModel(deps); // null until a film is loaded (competition layer)
  const selection = useCompareSelection();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [domain, setDomain] = useState<[number, number]>(FULL_DOMAIN);

  // Fix #2: baseline tracks the candidate. No film loaded → fall back to the category
  // lens the user is exploring.
  const baselineTier: "industry" | "indie" = film?.tier ?? (filters.category === "prestige" ? "indie" : "industry");

  // Upcoming weekends → ISO-week mapping and the start week. Film-independent, so the
  // demand strip + axis render even before a candidate is chosen.
  const upcoming = useMemo(() => nextWeekendFridays(52), []);
  const dateByWeek = useMemo(() => {
    const m = new Map<number, string>();
    for (const f of upcoming) {
      const w = isoWeekOf(f.date);
      if (!m.has(w)) m.set(w, f.date);
    }
    return m;
  }, [upcoming]);
  const startISO = upcoming.length ? isoWeekOf(upcoming[0].date) : 1;

  // The x-axis is seasonal (ISO weeks 1–52), but the live planning window rolls across a
  // calendar-year boundary — so resolve each ISO week to its real upcoming date to show
  // the actual month + year on the axis and in hovers.
  const fmtWeekDate = (w: number): string | null => {
    const d = dateByWeek.get(w);
    if (!d) return null;
    return new Date(d + "T00:00:00Z").toLocaleString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  };
  const weekHoverLabel = (w: number): string => {
    const my = fmtWeekDate(w);
    return my ? `Week ${w} · ${my}` : `Week ${w}`;
  };
  const yearOfWeek = (w: number): number | null => {
    const d = dateByWeek.get(w);
    return d ? new Date(d + "T00:00:00Z").getUTCFullYear() : null;
  };

  // The visible ISO-week window implied by the "Weeks shown" selector.
  const baseLo = weeks >= 52 ? 1 : Math.max(1, Math.min(52, startISO));
  const baseHi = weeks >= 52 ? 52 : Math.max(baseLo, Math.min(52, startISO + weeks - 1));
  // Reset the visible domain to the base window when that window changes (e.g. the user
  // moves the "Weeks shown" selector). Render-time "adjust state on change" rather than an
  // effect; manual zoom is preserved until the base window itself moves.
  const [prevBase, setPrevBase] = useState<[number, number]>([baseLo, baseHi]);
  if (prevBase[0] !== baseLo || prevBase[1] !== baseHi) {
    setPrevBase([baseLo, baseHi]);
    setDomain([baseLo, baseHi]);
  }

  // Demand = seasonal peer-median opener strength per ISO week (10 years, ex-COVID). With
  // genres selected, recompute it from the film index for just those genres; otherwise use
  // the precomputed all-genres weekly snapshot. No film needed either way.
  const genreList = useMemo(() => [...filters.genres].sort(), [filters.genres]);
  const genreKey = genreList.join("|");
  const demand = useMemo(() => {
    const base = baselineTier === "indie" ? deps.weeklyIndie : deps.weeklyIndustry;
    if (genreList.length > 0 && filmIndex && filmIndex.length > 0) {
      return buildDemandForGenres(filmIndex, baselineTier, genreList, base);
    }
    return buildDemand(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.weeklyIndie, deps.weeklyIndustry, baselineTier, genreKey, filmIndex]);

  const [lo, hi] = domain;
  const xw = (w: number) => xIn(w, lo, hi);
  const inWin = (w: number) => w >= lo && w <= hi;
  const zoomed = lo !== baseLo || hi !== baseHi;

  const selectedItem: ForwardItem | null =
    selectedId != null ? deps.forward.items.find((f) => f.id === selectedId) ?? null : null;

  // Competition bands — only meaningful once a film defines an audience. Light = the whole
  // upcoming field (all releases in the curated universe); dark = same-audience competition
  // within the active filter. Built straight from the forward schedule so the light band
  // counts every release, not just the similar ones.
  const competitorFilter = useMemo<CompetitorFilter>(
    () => ({
      category: filters.category,
      mpaa: filters.mpaa,
      distributors: [...filters.distributors].sort(),
      genres: [...filters.genres].sort(),
    }),
    [filters.category, filters.mpaa, filters.distributors, filters.genres]
  );
  const direct = model?.direct ?? [];
  const congestion = useMemo(
    () =>
      film
        ? congestionBands(film, upcoming.map((f) => f.date), deps.forward, deps.decay, competitorFilter)
        : [],
    [film, upcoming, deps.forward, deps.decay, competitorFilter]
  );
  const shortlistDates = selection.weekends;

  function toggleWeek(week: number) {
    const d = dateByWeek.get(week);
    if (d) selection.toggle(d);
  }

  return (
    <div className="space-y-4">
    <section className="border border-[var(--color-line)] bg-[var(--color-paper)]">
      <div className="px-5 py-3 border-b border-[var(--color-line)] flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs uppercase tracking-widest text-[var(--color-muted)] flex items-center gap-3">
          {film ? "Demand vs. competition for your audience" : "Seasonal demand · peer-median opener"}
          {zoomed && (
            <span className="normal-case tracking-normal text-[var(--color-muted)]/80">
              · weeks {lo}–{hi}
            </span>
          )}
        </div>
        <Legend showCompetition={!!film} />
      </div>

      <div className="relative px-5 py-5">
        <div className="absolute top-5 bottom-12 pointer-events-none" style={{ left: LABEL_W + 20, right: 20 }}>
          {MONTHS.map((m, i) =>
            inWin(MONTH_WEEK[i]) ? (
              <div
                key={m}
                className="absolute top-0 bottom-0 border-l border-dashed border-[var(--color-line)]/60"
                style={{ left: `${xw(MONTH_WEEK[i])}%` }}
              />
            ) : null
          )}
          {shortlistDates.map((d) => {
            const w = isoWeekOf(d);
            if (!inWin(w)) return null;
            return (
              <div
                key={d}
                className="absolute top-0 bottom-0 w-px"
                style={{ left: `${xw(w)}%`, background: "var(--color-accent)", opacity: 0.6 }}
              />
            );
          })}
        </div>

        <Row
          label="Demand"
          sub="opener strength"
          info={
            <>
              <p>
                Seasonal opener strength for the selected tier: the peer-median opening-weekend
                gross per ISO week (last 10 yrs, excl. 2020–21), min-max normalized across all 52
                weeks.
              </p>
              <p className="mt-1.5 font-mono text-[10px]">
                demand(w) = (med[w] − min) ÷ (max − min)
              </p>
              <p className="mt-1.5">
                {genreList.length > 0
                  ? `Recomputed from the film index for the selected genre${
                      genreList.length > 1 ? "s" : ""
                    } (${genreList.join(", ")}) — sparser, so noisier than the all-genres curve.`
                  : "Across all genres. Select genres to recompute it for just those."}
              </p>
            </>
          }
        >
          <div className="flex items-end gap-px h-12">
            {demand.filter((d) => inWin(d.week)).map((d) => (
              <button
                key={d.week}
                onClick={() => toggleWeek(d.week)}
                title={`${weekHoverLabel(d.week)} — peer median open ${formatMoney(d.grossUsd)}${
                  d.holiday ? ` · ${d.holiday}` : ""
                }`}
                className="flex-1 rounded-sm hover:outline hover:outline-1 hover:outline-[var(--color-ink)]"
                style={{
                  height: `${Math.max(4, d.value)}%`,
                  background: "var(--color-ink)",
                  opacity: 0.18 + (d.value / 100) * 0.6,
                }}
              />
            ))}
          </div>
        </Row>

        <Row
          label="Competition"
          sub="for your audience"
          info={
            <>
              <p>
                How crowded each week is. Both bands count releases by <em>presence</em> — an
                opener counts as 1, a holdover as its retention — and are scaled to the busiest
                week of the year.
              </p>
              <p className="mt-1.5">
                <strong>Light</strong> = every release in the curated theatrical universe
                (regardless of genre or similarity) — the whole field, for context.
              </p>
              <p className="mt-1">
                <strong>Dark</strong> = the same-audience subset: releases that pass your active
                filters <em>and</em> are similar to your film (similarity ≥ 0.45). These are the
                ones named as cells above the curve.
              </p>
            </>
          }
        >
          {film ? (
            <CongestionCurve
              series={congestion}
              direct={direct}
              domain={domain}
              shortlistWeeks={shortlistDates.map((d) => isoWeekOf(d))}
              onPick={toggleWeek}
              onSelectFilm={(id) => setSelectedId(id)}
              weekLabel={weekHoverLabel}
            />
          ) : (
            <div className="h-12 flex items-center text-[11px] text-[var(--color-muted)] italic">
              Score a film to overlay the competition for its audience.
            </div>
          )}
        </Row>

        <div className="flex" style={{ paddingLeft: LABEL_W }}>
          <div className="relative flex-1 h-6 mt-1">
            {(() => {
              const visIdx = MONTHS.map((_, i) => i).filter((i) => inWin(MONTH_WEEK[i]));
              return visIdx.map((i, pos) => {
                const y = yearOfWeek(MONTH_WEEK[i]);
                const prevY = pos > 0 ? yearOfWeek(MONTH_WEEK[visIdx[pos - 1]]) : null;
                // Show the year on the first visible month and wherever it changes.
                const showYear = y != null && (pos === 0 || y !== prevY);
                return (
                  <span
                    key={MONTHS[i]}
                    className="absolute text-[10px] uppercase tracking-wider text-[var(--color-muted)] -translate-x-1/2"
                    style={{ left: `${xw(MONTH_WEEK[i])}%` }}
                  >
                    {MONTHS[i]}
                    {showYear && (
                      <span className="ml-0.5 text-[var(--color-ink)]/70">
                        &rsquo;{String(y).slice(2)}
                      </span>
                    )}
                  </span>
                );
              });
            })()}
          </div>
        </div>

        <Row label="Zoom" sub="drag to focus">
          <div className="flex items-center gap-3">
            <ZoomBrush domain={domain} demand={demand} onChange={(a, b) => setDomain([a, b])} />
            <button
              onClick={() => setDomain([baseLo, baseHi])}
              disabled={!zoomed}
              className="shrink-0 text-[11px] border border-[var(--color-line)] px-2 py-1 hover:border-[var(--color-ink)] disabled:opacity-40"
            >
              Reset
            </button>
          </div>
        </Row>

        <div className="flex" style={{ paddingLeft: LABEL_W }}>
          <p className="text-[11px] text-[var(--color-muted)] mt-2">
            Each cell names a direct competitor&apos;s
            <em> opening</em>; the shaded tail to its right is that film&apos;s projected
            holdover. Drag the bar above to zoom into a span of weeks.
          </p>
          <p className="text-[11px] text-[var(--color-muted)] mt-2">
            <strong className="text-[var(--color-ink)]">How named competitors are chosen.</strong>{" "}
            Only films with similarity ≥ 0.45 to your candidate get named as cells —
            the &ldquo;clash&rdquo; threshold (genre + MPAA proximity + distributor tier).
            The dark band underneath aggregates same-audience pressure (similarity ≥ 0.45);
            the light band is the rest of the competitive field, weighted by similarity.
            Films are also scored by a release-scale heuristic
            (<code className="font-mono">prominence</code> = distributor tier × franchise
            multiplier × wide/limited flags) used to rank which would clutter the curve if
            shown; that ranking isn&apos;t currently surfaced on this view.
          </p>
        </div>
      </div>

      {selectedItem && model && (
        <MovieModal item={selectedItem} film={model.film} onClose={() => setSelectedId(null)} />
      )}
    </section>
    <CandidateBar />
    </div>
  );
}

function areaPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const first = pts[0];
  const last = pts[pts.length - 1];
  return `${line} L ${last.x.toFixed(2)} 100 L ${first.x.toFixed(2)} 100 Z`;
}

function CongestionCurve({
  series,
  direct,
  domain,
  shortlistWeeks,
  onPick,
  onSelectFilm,
  weekLabel,
}: {
  series: CongestionPoint[];
  direct: DirectComp[];
  domain: [number, number];
  shortlistWeeks: number[];
  onPick: (week: number) => void;
  onSelectFilm: (id: number, week: number) => void;
  weekLabel?: (w: number) => string;
}) {
  const [lo, hi] = domain;
  const count = hi - lo + 1;
  const xw = (w: number) => ((w - lo + 0.5) / count) * 100;
  const inWin = (w: number) => w >= lo && w <= hi;

  const vis = series.filter((p) => inWin(p.week));
  const totalPts = vis.map((p) => ({ x: xw(p.week), y: 100 - p.total }));
  const clashPts = vis.map((p) => ({ x: xw(p.week), y: 100 - p.clash }));

  const cellW = Math.min(22, Math.max(11, (100 / Math.max(6, count)) * 1.2));
  const half = cellW / 2;
  const gap = 0.6;
  const rowRight: number[] = [];
  const placed = direct
    .filter((c) => inWin(c.week))
    .map((c) => {
      const left = Math.min(100 - half, Math.max(half, xw(c.week)));
      const leftEdge = left - half;
      let row = 0;
      while (rowRight[row] != null && rowRight[row] > leftEdge - gap) row++;
      rowRight[row] = left + half;
      return { c, left, row };
    });
  const cellBandH = Math.max(1, rowRight.length) * CELL_ROW_H + 4;

  const visibleWeeks = Array.from({ length: count }, (_, i) => lo + i);
  const shortlistSet = new Set(shortlistWeeks);

  return (
    <div className="relative" style={{ height: CURVE_H + cellBandH }}>
      <div className="absolute top-0 left-0 right-0" style={{ height: cellBandH }}>
        {placed.map(({ c, left, row }) => {
          const strong = c.sim >= 0.5;
          return (
            <button
              key={c.id}
              onClick={() => onSelectFilm(c.id, c.week)}
              title={`${c.name} — ${c.distributor ?? "—"}, ${weekLabel ? weekLabel(c.week) : `wk ${c.week}`}, similarity ${c.sim.toFixed(2)} · click for details`}
              className="absolute -translate-x-1/2 h-[16px] rounded-sm border flex items-center px-1 overflow-hidden whitespace-nowrap hover:ring-1 hover:ring-[var(--color-ink)]"
              style={{
                left: `${left}%`,
                top: row * CELL_ROW_H,
                width: `${cellW}%`,
                background: strong ? "rgba(183,58,43,0.92)" : "rgba(183,58,43,0.18)",
                borderColor: strong ? "transparent" : "var(--color-accent)",
                color: strong ? "#fff" : "var(--color-accent)",
              }}
            >
              <span className="text-[9px] font-medium truncate">{c.name}</span>
            </button>
          );
        })}
      </div>

      <div className="absolute left-0 right-0 bottom-0" style={{ top: cellBandH }}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="block overflow-visible">
          {[25, 50, 75].map((g) => (
            <line key={g} x1={0} y1={g} x2={100} y2={g} stroke="var(--color-line)" strokeWidth={0.4} />
          ))}
          <path d={areaPath(totalPts)} fill="rgba(183,58,43,0.14)" />
          <path d={areaPath(clashPts)} fill="rgba(183,58,43,0.55)" />
          <polyline
            points={clashPts.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <div className="absolute inset-0 flex">
          {visibleWeeks.map((w) => (
            <button
              key={w}
              onClick={() => onPick(w)}
              title={weekLabel ? weekLabel(w) : `Week ${w}`}
              className={`flex-1 hover:bg-[var(--color-ink)]/5 ${
                shortlistSet.has(w) ? "bg-[var(--color-accent)]/5" : ""
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ZoomBrush({
  domain,
  demand,
  onChange,
}: {
  domain: [number, number];
  demand: DemandPoint[];
  onChange: (lo: number, hi: number) => void;
}) {
  const [lo, hi] = domain;
  const trackRef = useRef<HTMLDivElement>(null);
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const pctLeft = (week: number) => ((week - 1) / 52) * 100;

  const startDrag = (mode: "pan" | "l" | "r") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const track = trackRef.current;
    if (!track) return;
    const width = track.getBoundingClientRect().width;
    const startX = e.clientX;
    const d0 = { lo, hi };
    const span = d0.hi - d0.lo + 1;

    const move = (ev: PointerEvent) => {
      const delta = Math.round(((ev.clientX - startX) / width) * 52);
      if (mode === "pan") {
        const nLo = clamp(d0.lo + delta, 1, 52 - span + 1);
        onChange(nLo, nLo + span - 1);
      } else if (mode === "l") {
        onChange(clamp(d0.lo + delta, 1, d0.hi - (MIN_ZOOM_SPAN - 1)), d0.hi);
      } else {
        onChange(d0.lo, clamp(d0.hi + delta, d0.lo + (MIN_ZOOM_SPAN - 1), 52));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const winLeft = pctLeft(lo);
  const winWidth = ((hi - lo + 1) / 52) * 100;

  return (
    <div
      ref={trackRef}
      className="relative flex-1 h-9 bg-[var(--color-soft)] border border-[var(--color-line)] rounded-sm select-none touch-none"
    >
      <div className="absolute inset-0 flex items-end gap-px px-px opacity-40 pointer-events-none">
        {demand.map((d) => (
          <div
            key={d.week}
            className="flex-1"
            style={{ height: `${Math.max(6, d.value)}%`, background: "var(--color-ink)" }}
          />
        ))}
      </div>

      <div
        onPointerDown={startDrag("pan")}
        className="absolute top-0 bottom-0 bg-[var(--color-accent)]/20 border-x-2 border-[var(--color-accent)] cursor-grab active:cursor-grabbing"
        style={{ left: `${winLeft}%`, width: `${winWidth}%` }}
      >
        <Handle side="left" onPointerDown={startDrag("l")} />
        <Handle side="right" onPointerDown={startDrag("r")} />
      </div>
    </div>
  );
}

function Handle({
  side,
  onPointerDown,
}: {
  side: "left" | "right";
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <span
      onPointerDown={onPointerDown}
      className="absolute top-1/2 -translate-y-1/2 w-3 h-7 rounded-sm bg-[var(--color-accent)] cursor-ew-resize flex items-center justify-center"
      style={side === "left" ? { left: -6 } : { right: -6 }}
    >
      <span className="block w-px h-3 bg-white/70" />
    </span>
  );
}

function Row({
  label,
  sub,
  info,
  children,
}: {
  label: string;
  sub?: string;
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center">
      <div style={{ width: LABEL_W }} className="pr-4 shrink-0">
        <div className="text-xs font-medium flex items-center gap-1">
          {label}
          {info && (
            <Hint body={info} width="22rem" side="below" align="left">
              <span className="inline-flex items-center justify-center w-2.5 h-2.5 rounded-full border border-current/50 text-[6px] leading-none text-[var(--color-muted)]">
                i
              </span>
            </Hint>
          )}
        </div>
        {sub && <div className="text-[10px] text-[var(--color-muted)]">{sub}</div>}
      </div>
      <div className="flex-1 border-t border-[var(--color-line)]/50 py-2">{children}</div>
    </div>
  );
}

function Legend({ showCompetition }: { showCompetition: boolean }) {
  return (
    <div className="flex items-center gap-4 text-[11px] text-[var(--color-muted)]">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3.5 h-3.5 rounded-sm" style={{ background: "var(--color-ink)", opacity: 0.6 }} />
        Demand
      </span>
      {showCompetition && (
        <>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 rounded-sm" style={{ background: "rgba(183,58,43,0.14)" }} />
            All releases
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 rounded-sm" style={{ background: "rgba(183,58,43,0.55)" }} />
            Same-audience
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 rounded-sm border border-[var(--color-accent)]" style={{ background: "rgba(183,58,43,0.92)" }} />
            Direct competitor
          </span>
        </>
      )}
    </div>
  );
}
