"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditableChips } from "./EditableChips";
import type { CandidateFilm } from "@/lib/scoring/types";
import { useFilms } from "@/lib/film-context";

const MPAA = ["G", "PG", "PG-13", "R", "NC-17"];
const COMMON_GENRES = [
  "Action",
  "Adventure",
  "Animation",
  "Biography",
  "Comedy",
  "Crime",
  "Drama",
  "Family",
  "Fantasy",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Thriller",
  "War",
];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
        {label}
      </div>
      {children}
      {hint && <div className="text-xs text-[var(--color-muted)]">{hint}</div>}
    </div>
  );
}

export function FilmForm({ initial, onSave }: { initial?: CandidateFilm; onSave?: () => void }) {
  const router = useRouter();
  const { save } = useFilms();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [synopsis, setSynopsis] = useState(initial?.synopsis ?? "");
  const [tier, setTier] = useState<"indie" | "industry">(initial?.tier ?? "indie");
  const [mpaa, setMpaa] = useState<string | null>(initial?.mpaa ?? "R");
  const [genres, setGenres] = useState<string[]>(initial?.genres ?? []);
  const [genreTags, setGenreTags] = useState<string[]>(initial?.genre_tags ?? []);
  const [audienceTags, setAudienceTags] = useState<string[]>(initial?.audience_tags ?? []);
  const [audienceProfile, setAudienceProfile] = useState(initial?.audience_profile ?? "");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileGenerated, setProfileGenerated] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setExtractError(null);
    setExtracting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.title) setTitle(data.title);
      if (data.synopsis) setSynopsis(data.synopsis);
      if (data.genres?.length) setGenres(data.genres);
      if (data.mpaa) setMpaa(data.mpaa);
      if (data.tier) setTier(data.tier);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  async function generateProfile() {
    setError(null);
    if (!title.trim() || !synopsis.trim()) {
      setError("A title and synopsis are required to generate a profile.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, synopsis, genres, mpaa }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setGenreTags(data.genre_tags ?? []);
      setAudienceTags(data.audience_tags ?? []);
      setAudienceProfile(data.audience_profile ?? "");
      setProfileGenerated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  function continueToCompare() {
    const film: CandidateFilm = {
      title,
      tier,
      mpaa,
      genres,
      genre_tags: genreTags,
      audience_tags: audienceTags,
      synopsis,
      audience_profile: audienceProfile.trim() || null,
    };
    save(film);
    if (onSave) {
      onSave();
    } else {
      router.push("/");
    }
  }

  const canContinue = title.trim() && genres.length > 0 && genreTags.length > 0;

  return (
    <div className="space-y-10 max-w-3xl">
      {/* Document upload */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border border-dashed px-6 py-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-[var(--color-ink)] bg-[var(--color-soft)]"
            : "border-[var(--color-line)] hover:border-[var(--color-ink)]"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md"
          className="hidden"
          onChange={onFileInput}
        />
        {extracting ? (
          <span className="text-sm text-[var(--color-muted)]">Reading document…</span>
        ) : (
          <>
            <div className="text-sm text-[var(--color-ink)]">
              Drop a one-sheet, treatment, or press release here.
            </div>
            <div className="text-xs text-[var(--color-muted)] mt-1">
              PDF · DOCX · TXT — fields auto-populate for your review.
            </div>
          </>
        )}
      </div>
      {extractError && (
        <div className="text-xs text-[var(--color-accent)]">{extractError}</div>
      )}

      <Field label="Film title">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled film"
          className="w-full border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm focus:border-[var(--color-ink)] outline-none"
        />
      </Field>

      <div className="grid grid-cols-2 gap-8">
        <Field label="Distributor tier">
          <div className="flex">
            {(["indie", "industry"] as const).map((t, i) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className={`flex-1 border px-3 py-2 text-sm ${i === 0 ? "border-r-0" : ""} ${
                  tier === t
                    ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                    : "border-[var(--color-line)] hover:border-[var(--color-ink)]"
                }`}
              >
                {t === "indie" ? "Indie / Prestige" : "Major studio"}
              </button>
            ))}
          </div>
        </Field>
        <Field label="MPAA rating">
          <div className="flex">
            {MPAA.map((m, i) => (
              <button
                key={m}
                type="button"
                onClick={() => setMpaa(m)}
                className={`flex-1 border px-2 py-2 text-xs font-mono ${
                  i > 0 ? "border-l-0" : ""
                } ${
                  mpaa === m
                    ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                    : "border-[var(--color-line)] hover:border-[var(--color-ink)]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <Field label="Box-office genres (Mojo categories)">
        <div className="flex flex-wrap gap-1">
          {COMMON_GENRES.map((g) => {
            const active = genres.includes(g);
            return (
              <button
                key={g}
                type="button"
                onClick={() =>
                  setGenres(active ? genres.filter((x) => x !== g) : [...genres, g])
                }
                className={`border px-3 py-1.5 text-xs ${
                  active
                    ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                    : "border-[var(--color-line)] hover:border-[var(--color-ink)]"
                }`}
              >
                {g}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Synopsis">
        <textarea
          value={synopsis}
          onChange={(e) => setSynopsis(e.target.value)}
          rows={5}
          placeholder="A reclusive painter discovers that her newest portrait subject is haunting her studio…"
          className="w-full border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm focus:border-[var(--color-ink)] outline-none"
        />
      </Field>

      <div className="flex items-center gap-4 border-t border-[var(--color-line)] pt-6">
        <button
          type="button"
          onClick={generateProfile}
          disabled={generating}
          className="border border-[var(--color-ink)] bg-[var(--color-ink)] text-white px-4 py-2 text-sm hover:bg-[var(--color-paper)] hover:text-[var(--color-ink)] disabled:opacity-50 transition"
        >
          {generating
            ? "Generating profile…"
            : profileGenerated
              ? "Regenerate AI profile"
              : "Generate AI profile"}
        </button>
        {error && <span className="text-xs text-[var(--color-accent)]">{error}</span>}
      </div>

      {(profileGenerated || initial) && (
        <div className="border border-[var(--color-line)] bg-[var(--color-soft)] p-6 space-y-6">
          <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
            Generated profile · editable
          </div>
          <Field label="Genre tags">
            <EditableChips
              values={genreTags}
              onChange={setGenreTags}
              placeholder="add genre tag"
            />
          </Field>
          <Field label="Audience tags">
            <EditableChips
              values={audienceTags}
              onChange={setAudienceTags}
              placeholder="add audience tag"
            />
          </Field>
          {audienceProfile && (
            <Field label="Audience profile">
              <textarea
                value={audienceProfile}
                onChange={(e) => setAudienceProfile(e.target.value)}
                rows={2}
                className="w-full border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-xs focus:border-[var(--color-ink)] outline-none"
              />
            </Field>
          )}
        </div>
      )}

      <div className="pt-6 border-t border-[var(--color-line)]">
        <button
          type="button"
          onClick={continueToCompare}
          disabled={!canContinue}
          className="border border-[var(--color-accent)] bg-[var(--color-accent)] text-white px-5 py-2.5 text-sm hover:bg-[var(--color-paper)] hover:text-[var(--color-accent)] disabled:opacity-40 transition"
        >
          Save profile and open Landscape →
        </button>
        {!canContinue && (
          <p className="text-xs text-[var(--color-muted)] mt-2">
            Requires a title, at least one genre, and at least one genre tag (generated or
            manually added).
          </p>
        )}
      </div>
    </div>
  );
}
