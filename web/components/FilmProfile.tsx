"use client";

import { useEffect, useMemo, useState } from "react";
import { useFilms } from "@/lib/film-context";
import { formatMoney } from "@/lib/format";
import type { ComparableFilm } from "@/lib/scoring/types";
import { CompScatter, SectionTitle } from "./wireframe/insights";
import { FilmForm } from "./FilmForm";

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function FilmProfile() {
  const { active } = useFilms();
  const film = active?.film ?? null;
  const filmKey = film ? JSON.stringify(film) : "";

  const [comps, setComps] = useState<ComparableFilm[]>([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    // No film → nothing to fetch. Stale `comps` is never rendered (the no-film branch
    // below shows the upload form instead), and refetches when a film loads again.
    if (!film) return;
    let cancelled = false;
    fetch("/api/comparable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ film, n: 30 }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!cancelled) setComps(d.comparable_films ?? []);
      })
      .catch(() => {
        if (!cancelled) setComps([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmKey]);

  const stats = useMemo(() => {
    const openings = comps.map((c) => c.opening_usd).filter((x): x is number => x != null);
    const mults = comps.map((c) => c.multiplier).filter((x): x is number => x != null);
    return {
      n: comps.length,
      medOpen: median(openings),
      medMult: median(mults),
    };
  }, [comps]);

  // ── No film: this page is where you create/upload one ──────────────────────
  if (!film) {
    return (
      <div className="max-w-7xl mx-auto px-8 py-12 space-y-8">
        <Header subtitle="Upload a one-sheet or enter the details below — this profile becomes the reference for every downstream view." />
        <div className="border border-[var(--color-line)] p-8 bg-[var(--color-paper)]">
          <FilmForm onSave={() => {}} />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-8 py-12 space-y-10">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <Header subtitle="The Landscape, scoring, and comparable-films views all read from this profile." />
        <button
          onClick={() => setEditing((e) => !e)}
          className="shrink-0 border border-[var(--color-ink)] bg-[var(--color-ink)] text-white px-4 py-2 text-sm hover:bg-[var(--color-paper)] hover:text-[var(--color-ink)] transition"
        >
          {editing ? "Close editor" : "Edit / re-upload profile"}
        </button>
      </div>

      {editing && (
        <div className="border border-[var(--color-line)] p-8 bg-[var(--color-paper)]">
          <div className="text-xs uppercase tracking-widest text-[var(--color-muted)] mb-6">
            Editing — saving replaces the active profile
          </div>
          <FilmForm initial={film} onSave={() => setEditing(false)} />
        </div>
      )}

      {/* Profile summary */}
      <div className="border border-[var(--color-line)] bg-[var(--color-paper)] p-6 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Profile</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight">{film.title || "Untitled film"}</div>
          <div className="text-sm text-[var(--color-muted)] mt-1">
            {film.tier === "indie" ? "Indie / Prestige" : "Major studio"}
            {film.mpaa ? ` · ${film.mpaa}` : ""}
            {film.genres.length ? ` · ${film.genres.join(", ")}` : ""}
          </div>
        </div>
        {(film.genre_tags.length > 0 || film.audience_tags.length > 0) && (
          <div className="flex flex-wrap gap-1 text-[10px]">
            {film.genre_tags.map((t) => (
              <span key={t} className="font-mono border border-[var(--color-line)] bg-[var(--color-soft)] px-2 py-0.5">
                {t}
              </span>
            ))}
            {film.audience_tags.map((t) => (
              <span key={t} className="font-mono border border-[var(--color-accent)] text-[var(--color-accent)] px-2 py-0.5">
                {t}
              </span>
            ))}
          </div>
        )}
        {film.synopsis && (
          <p className="text-sm text-[var(--color-muted)] leading-relaxed max-w-prose border-t border-[var(--color-line)] pt-4">
            {film.synopsis}
          </p>
        )}
      </div>

      {/* Comp stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-[var(--color-line)] border border-[var(--color-line)]">
        <Stat label="Comparable titles" value={stats.n.toString()} />
        <Stat label="Median opening" value={stats.medOpen != null ? formatMoney(stats.medOpen) : "—"} />
        <Stat label="Median multiple" value={stats.medMult != null ? `${stats.medMult.toFixed(1)}×` : "—"} />
      </div>

      {/* Similar-genre opening gross scatter */}
      <div className="space-y-4">
        <SectionTitle>
          Similar films — release week vs. opening gross ({comps.length} closest analogs)
        </SectionTitle>
        <p className="text-sm text-[var(--color-muted)] max-w-prose">
          The library titles most similar to {film.title || "your film"} by genre, rating,
          and distributor tier — plotted by the ISO week they actually opened and the
          size of that opening.
        </p>
        <CompScatter comps={comps} />
      </div>

      {/* Comp table */}
      {comps.length > 0 && (
        <div className="space-y-4">
          <SectionTitle>Closest analogs</SectionTitle>
          <div className="border border-[var(--color-line)] bg-[var(--color-paper)]">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 py-2 text-[10px] uppercase tracking-widest text-[var(--color-muted)] border-b border-[var(--color-line)]">
              <span>Title</span>
              <span className="text-right">Wk</span>
              <span className="text-right">Opening</span>
              <span className="text-right">Mult</span>
              <span className="text-right">Sim</span>
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-[var(--color-line)]">
              {comps.slice(0, 20).map((c) => (
                <div key={c.film_id} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 py-2 text-sm">
                  <span className="truncate">
                    <span className="font-medium">{c.title}</span>{" "}
                    <span className="text-[var(--color-muted)]">({c.year})</span>
                  </span>
                  <span className="text-right font-mono text-[var(--color-muted)]">{c.iso_week}</span>
                  <span className="text-right font-mono text-[var(--color-muted)]">
                    {c.opening_usd != null ? formatMoney(c.opening_usd) : "—"}
                  </span>
                  <span className="text-right font-mono text-[var(--color-muted)]">
                    {c.multiplier != null ? `${c.multiplier.toFixed(1)}×` : "—"}
                  </span>
                  <span className="text-right font-mono text-[var(--color-accent)]">{c.similarity.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="max-w-3xl">
      <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Film profile</div>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">Active film profile.</h1>
      <p className="mt-4 text-base text-[var(--color-muted)] leading-relaxed">{subtitle}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-paper)] px-5 py-4">
      <div className="text-[10px] uppercase tracking-widest text-[var(--color-muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
    </div>
  );
}
