"use client";

import { useMemo, useState } from "react";
import type { FilmIndexItem, Tier, WeekSummary, WeeklyPayload } from "@/lib/types";
import { formatMoney, monthOfIsoWeek } from "@/lib/format";
import { ColorScaleLegend } from "./ColorScaleLegend";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Props = {
  industry: WeeklyPayload;
  indie: WeeklyPayload;
  filmIndex?: FilmIndexItem[] | null;
};

function intensity(v: number): string {
  const t = Math.max(0, Math.min(1, v));
  const h = 220 - t * 220; // 220 (blue) → 0 (red)
  const s = 20 + t * 60;
  const l = 92 - t * 38;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Recompute the 52-week summary from the raw film index, filtered to a tier + genre.
// Mirrors the server's per-tier aggregation (same min-gross floor + excluded years) so a
// genre view stays comparable to the precomputed "all genres" payload. Holiday labels and
// week labels are carried over from the base payload.
function buildWeeksFromIndex(
  items: FilmIndexItem[],
  tier: Tier,
  genre: string,
  base: WeeklyPayload
): WeekSummary[] {
  const minGross = base.min_opener_gross_usd;
  const excluded = new Set(base.excluded_years);
  const metaByIso = new Map(
    base.weeks.map((w) => [w.iso_week, { label: w.label, holiday: w.holiday }])
  );
  const g = genre.toLowerCase();

  const byIso = new Map<number, FilmIndexItem[]>();
  for (const f of items) {
    if (f.tier !== tier) continue;
    if (f.opening_usd == null || f.opening_usd < minGross) continue;
    if (excluded.has(f.year)) continue;
    if (!(f.genres ?? []).some((x) => x.toLowerCase() === g)) continue;
    const arr = byIso.get(f.iso_week);
    if (arr) arr.push(f);
    else byIso.set(f.iso_week, [f]);
  }

  const out: WeekSummary[] = [];
  for (let i = 1; i <= 52; i++) {
    const films = (byIso.get(i) ?? [])
      .slice()
      .sort((a, b) => (b.opening_usd ?? 0) - (a.opening_usd ?? 0));
    const grosses = films.map((f) => f.opening_usd ?? 0);
    const mean = grosses.length
      ? grosses.reduce((s, x) => s + x, 0) / grosses.length
      : 0;
    const meta = metaByIso.get(i);
    out.push({
      iso_week: i,
      label: meta?.label ?? `Week ${i}`,
      n_years: new Set(films.map((f) => f.year)).size,
      median_opener_gross_usd: median(grosses),
      mean_opener_gross_usd: mean,
      stdev_opener_gross_usd: 0,
      cv: null,
      opening_norm: 0,
      rank_pct: null,
      holiday: meta?.holiday ?? null,
      meaningful_openers_count: films.length,
      top_films: films.slice(0, 12).map((f) => ({
        title: f.title,
        year: f.year,
        gross_usd: f.opening_usd ?? 0,
        film_id: f.id,
      })),
    });
  }
  return out;
}

export function Heatmap({ industry, indie, filmIndex }: Props) {
  const [tier, setTier] = useState<Tier>("indie");
  // Track the selected week by ISO number, not the WeekSummary object — the object is
  // re-derived whenever the tier or genre changes, so the detail panel stays in sync.
  const [activeIso, setActiveIso] = useState<number | null>(null);
  const [genre, setGenre] = useState<string>("");

  const payload = tier === "indie" ? indie : industry;

  const genreOptions = useMemo(() => {
    if (!filmIndex) return [];
    const s = new Set<string>();
    for (const f of filmIndex) for (const g of f.genres ?? []) s.add(g);
    return Array.from(s).sort();
  }, [filmIndex]);

  const weeks = useMemo<WeekSummary[]>(() => {
    // Genre view: recompute from the film index. "All genres" uses the precomputed payload.
    if (genre && filmIndex) {
      return buildWeeksFromIndex(filmIndex, tier, genre, payload);
    }
    const byWeek = new Map(payload.weeks.map((w) => [w.iso_week, w]));
    const out: WeekSummary[] = [];
    for (let i = 1; i <= 52; i++) {
      out.push(
        byWeek.get(i) ?? {
          iso_week: i,
          label: `Week ${i}`,
          n_years: 0,
          median_opener_gross_usd: 0,
          mean_opener_gross_usd: 0,
          stdev_opener_gross_usd: 0,
          cv: null,
          opening_norm: 0,
          rank_pct: null,
          holiday: null,
          meaningful_openers_count: 0,
          top_films: [],
        }
      );
    }
    return out;
  }, [payload, genre, filmIndex, tier]);

  const active = weeks.find((w) => w.iso_week === activeIso) ?? weeks[0];

  const grossMax = useMemo(
    () => Math.max(...weeks.map((w) => w.median_opener_gross_usd), 1),
    [weeks]
  );

  // Sqrt scale: compresses the top so similarly-strong weeks read as similarly
  // hot rather than maximally spreading every week apart like min-max would.
  function cellIntensity(w: WeekSummary): number {
    return Math.sqrt(w.median_opener_gross_usd / grossMax);
  }

  return (
    <div className="space-y-10">
      {/* Header controls — tier toggle + legend, no metric switcher */}
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-[var(--color-line)] pb-6">
        <div className="space-y-3 max-w-xl">
          <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
            Color by
          </div>
          <div className="text-sm">
            Median opening-weekend gross, square-root scaled to the strongest week.
            Similarly-strong weeks read as similarly hot.
          </div>
          {genre && (
            <div className="text-xs text-[var(--color-muted)]">
              Filtered to <span className="text-[var(--color-ink)]">{genre}</span> openers,
              recomputed live from the film index (approximate vs. the precomputed all-genres
              view).
            </div>
          )}
        </div>

        <div className="flex items-end gap-6">
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
              Distribution tier
            </div>
            <div className="flex">
              {(["indie", "industry"] as Tier[]).map((t, i) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  className={`border px-3 py-1.5 text-sm transition ${
                    i === 0 ? "border-r-0" : ""
                  } ${
                    tier === t
                      ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                      : "border-[var(--color-line)] hover:border-[var(--color-ink)]"
                  }`}
                >
                  {t === "indie" ? "Indie / Prestige" : "All distributors"}
                </button>
              ))}
            </div>
          </div>
          {genreOptions.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
                Genre
              </div>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-1.5 text-sm hover:border-[var(--color-ink)]"
              >
                <option value="">All genres</option>
                {genreOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Legend />
        </div>
      </div>

      {/* 52-cell strip */}
      <div className="space-y-2">
        <MonthAxis />
        <div className="grid grid-cols-[repeat(52,minmax(0,1fr))] gap-px">
          {weeks.map((week) => (
            <button
              key={week.iso_week}
              type="button"
              onMouseEnter={() => setActiveIso(week.iso_week)}
              onFocus={() => setActiveIso(week.iso_week)}
              onClick={() => setActiveIso(week.iso_week)}
              style={{ background: intensity(cellIntensity(week)) }}
              className={`relative aspect-square min-h-10 transition-transform hover:scale-110 hover:z-10 hover:shadow-md ${
                active?.iso_week === week.iso_week
                  ? "ring-2 ring-[var(--color-ink)] z-10"
                  : ""
              }`}
              aria-label={`Week ${week.iso_week} · ${formatMoney(week.median_opener_gross_usd)}`}
            >
              {week.holiday && (
                <span className="absolute -top-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[var(--color-ink)]" />
              )}
            </button>
          ))}
        </div>
      </div>

      <Detail row={active} tier={tier} />
    </div>
  );
}

function MonthAxis() {
  return (
    <div className="relative h-4 grid grid-cols-[repeat(52,minmax(0,1fr))]">
      {MONTHS.map((m, i) => (
        <span
          key={m}
          className="text-[10px] uppercase tracking-widest text-[var(--color-muted)]"
          style={{
            gridColumnStart: Math.max(1, Math.round(i * (52 / 12)) + 1),
            gridColumnEnd: "span 4",
          }}
        >
          {m}
        </span>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <ColorScaleLegend color={intensity} lowLabel="bad" highLabel="good" showHoliday align="end" />
  );
}

function Detail({ row, tier }: { row: WeekSummary; tier: Tier }) {
  if (!row) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-12 border-t border-[var(--color-line)] pt-8">
      <div>
        <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
          ISO Week {row.iso_week} · {monthOfIsoWeek(row.iso_week)} weekend
        </div>
        <div className="mt-3 text-3xl font-semibold">
          {formatMoney(row.median_opener_gross_usd)}
        </div>
        <div className="text-sm text-[var(--color-muted)]">
          median opener · mean {formatMoney(row.mean_opener_gross_usd)}
        </div>
        {row.holiday && (
          <div className="mt-4 inline-block border border-[var(--color-ink)] px-2 py-0.5 text-xs uppercase tracking-widest">
            {row.holiday}
          </div>
        )}
        <p className="mt-5 text-sm text-[var(--color-muted)]">
          {row.n_years} {row.n_years === 1 ? "year" : "years"} of data after excluding 2020–21
          (theater closures). Tier:{" "}
          <span className="text-[var(--color-ink)]">
            {tier === "indie" ? "indie / prestige" : "all distributors"}
          </span>
          . {row.meaningful_openers_count}{" "}
          meaningful opener{row.meaningful_openers_count === 1 ? "" : "s"} observed in this
          ISO week.
        </p>
      </div>

      <FilmList row={row} />
    </div>
  );
}

function FilmList({ row }: { row: WeekSummary }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? row.top_films : row.top_films.slice(0, 5);
  const remaining = row.top_films.length - visible.length;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
          Top historical openers
        </div>
        <div className="text-xs text-[var(--color-muted)]">{row.top_films.length} total</div>
      </div>
      <ol className="mt-3 space-y-2">
        {visible.map((f, i) => (
          <li key={`${f.title}-${f.year}-${i}`} className="text-sm">
            <span className="font-medium">{f.title}</span>
            <span className="ml-2 text-[var(--color-muted)]">
              {f.year} · {formatMoney(f.gross_usd)}
            </span>
          </li>
        ))}
        {row.top_films.length === 0 && (
          <li className="text-sm text-[var(--color-muted)]">No qualifying openers in this week</li>
        )}
      </ol>
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 text-xs uppercase tracking-widest text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          Show {remaining} more →
        </button>
      )}
      {expanded && row.top_films.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-3 text-xs uppercase tracking-widest text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          Collapse
        </button>
      )}
    </div>
  );
}
