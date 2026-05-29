"use client";

import type { BacktestResult } from "@/lib/backtest/run";
import { formatMoney } from "@/lib/format";

const BINS = [
  { lo: -1.0, hi: -0.5, label: "< -0.5" },
  { lo: -0.5, hi: -0.2, label: "-0.5 to -0.2" },
  { lo: -0.2, hi: 0.2, label: "-0.2 to 0.2" },
  { lo: 0.2, hi: 0.5, label: "0.2 to 0.5" },
  { lo: 0.5, hi: 1.01, label: "≥ 0.5" },
];

export function BacktestChart({ data }: { data: BacktestResult }) {
  const buckets = BINS.map((b) => ({
    ...b,
    n: data.films.filter((f) => f.rho >= b.lo && f.rho < b.hi).length,
  }));
  const maxN = Math.max(1, ...buckets.map((b) => b.n));

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--color-line)] border border-[var(--color-line)]">
        <Stat label="Films tested" value={data.summary.n_films.toString()} />
        <Stat label="Median ρ" value={data.summary.median_rho.toFixed(2)} />
        <Stat
          label="% positive"
          value={`${(data.summary.pct_positive * 100).toFixed(0)}%`}
        />
        <Stat
          label="% strong (|ρ| ≥ 0.5)"
          value={`${(data.summary.pct_strong * 100).toFixed(0)}%`}
        />
      </div>

      <div>
        <div className="text-xs uppercase tracking-widest text-[var(--color-muted)] mb-4">
          Distribution of per-film Spearman ρ
        </div>
        <div className="grid grid-cols-5 gap-3 items-end h-48 border-b border-[var(--color-line)] pb-2">
          {buckets.map((b) => (
            <div key={b.label} className="flex flex-col items-center justify-end gap-2 h-full">
              <div className="text-sm font-mono">{b.n}</div>
              <div
                className="w-full bg-[var(--color-ink)]"
                style={{ height: `${(b.n / maxN) * 80}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-5 gap-3">
          {buckets.map((b) => (
            <div
              key={b.label}
              className="text-[10px] uppercase tracking-widest text-[var(--color-muted)] text-center"
            >
              {b.label}
            </div>
          ))}
        </div>
      </div>

      {data.per_preset.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-widest text-[var(--color-muted)] mb-3">
            By genre preset — does each preset&apos;s weighting hold up?
          </div>
          <div className="border-t border-b border-[var(--color-line)] divide-y divide-[var(--color-line)]">
            {data.per_preset.map((p) => (
              <div
                key={p.preset}
                className="py-2.5 grid grid-cols-[1.4fr_auto_auto_1.5fr] gap-4 text-sm items-baseline"
              >
                <span className="font-medium capitalize">
                  {p.preset.replace(/_/g, " ")}
                </span>
                <span className="font-mono text-[var(--color-muted)]">
                  n = {p.n_films}
                </span>
                <span
                  className={`font-mono ${
                    p.median_rho >= data.summary.median_rho
                      ? "text-[var(--color-ink)]"
                      : "text-[var(--color-accent)]"
                  }`}
                >
                  median ρ {p.median_rho.toFixed(2)}
                </span>
                <span className="font-mono text-[var(--color-muted)] text-[11px]">
                  open {Math.round(p.weights.opening * 100)} · legs{" "}
                  {Math.round(p.weights.legs * 100)} · comp{" "}
                  {Math.round(p.weights.competition * 100)}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] italic text-[var(--color-muted)] mt-2">
            Presets with median ρ below the overall ({data.summary.median_rho.toFixed(2)}) are
            highlighted — those are candidates for re-weighting.
          </p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-8">
        <FilmList title="Best agreement (top ρ)" films={data.films.slice(0, 8)} />
        <FilmList
          title="Worst agreement (bottom ρ)"
          films={[...data.films].reverse().slice(0, 8)}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-paper)] p-5">
      <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight font-mono">{value}</div>
    </div>
  );
}

function FilmList({ title, films }: { title: string; films: BacktestResult["films"] }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-[var(--color-muted)] mb-3">
        {title}
      </div>
      <ul className="divide-y divide-[var(--color-line)] border-t border-b border-[var(--color-line)]">
        {films.map((f) => (
          <li key={f.film_id} className="py-2.5 grid grid-cols-[1fr_auto_auto] gap-4 text-sm">
            <span className="truncate">
              <span className="font-medium">{f.title}</span>{" "}
              <span className="text-[var(--color-muted)]">({f.year})</span>
            </span>
            <span className="font-mono text-[var(--color-muted)]">
              {formatMoney(f.opening_usd)}
            </span>
            <span
              className={`font-mono ${
                f.rho > 0.2
                  ? "text-[var(--color-ink)]"
                  : f.rho < -0.2
                    ? "text-[var(--color-accent)]"
                    : "text-[var(--color-muted)]"
              }`}
            >
              ρ {f.rho.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
