"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useFilms } from "@/lib/film-context";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

export function FilmSelector() {
  const { films, active, ready, setActive, remove, openModal } = useFilms();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Reset the search whenever the dropdown closes so it reopens clean. Render-time
  // "adjust state on change" rather than an effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setQuery("");
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? films.filter(
        (f) =>
          (f.film.title || "untitled").toLowerCase().includes(q) ||
          f.film.genres.some((g) => g.toLowerCase().includes(q))
      )
    : films;

  // Explicitly choosing a film (or "None") in the header should win. `setActive` flips
  // `userSelected` so the selection beats any `?s=` scenario in the URL in-session (see
  // Calendar/CompareView). We also drop the now-stale scenario from the URL bar so a
  // later reload doesn't resurrect it. We use the History API directly because the App
  // Router's soft navigation can no-op here, leaving the query in place.
  function choose(id: string | null) {
    setActive(id);
    setOpen(false);
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState(null, "", pathname);
    }
  }

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  if (!ready) {
    return (
      <div className="border border-[var(--color-line)] px-3 py-1.5 text-xs uppercase tracking-widest text-[var(--color-muted)]">
        Film
      </div>
    );
  }

  // No film loaded — show a simple button that opens the modal directly.
  if (!active && films.length === 0) {
    return (
      <button
        type="button"
        onClick={openModal}
        className="border border-[var(--color-line)] px-3 py-1.5 text-sm hover:border-[var(--color-ink)] flex items-center gap-1.5"
      >
        <span className="text-[var(--color-muted)]">+</span>
        <span>Film Profile</span>
      </button>
    );
  }

  const label = active ? active.film.title : "No film";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className={`border px-3 py-1.5 text-sm flex items-center gap-2 max-w-[18rem] ${
          active
            ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
            : "border-[var(--color-line)] hover:border-[var(--color-ink)]"
        }`}
      >
        <span className="text-[10px] uppercase tracking-widest opacity-70">Film</span>
        <span className="truncate font-medium">{label}</span>
        <span className="text-[10px] opacity-60 shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-30 w-80 border border-[var(--color-line)] bg-[var(--color-paper)] shadow-lg">
          <button
            type="button"
            onClick={() => choose(null)}
            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--color-soft)] flex items-center gap-2 ${
              active === null ? "text-[var(--color-ink)]" : "text-[var(--color-muted)]"
            }`}
          >
            <span
              className={`w-3 h-3 border shrink-0 flex items-center justify-center text-[8px] ${
                active === null
                  ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                  : "border-[var(--color-line)]"
              }`}
            >
              {active === null && "✓"}
            </span>
            None — show neutral views
          </button>

          {films.length > 0 && (
            <div className="border-t border-[var(--color-line)]">
              <div className="px-4 py-2 text-[10px] uppercase tracking-widest text-[var(--color-muted)]">
                Saved profiles ({films.length})
              </div>
              {films.length > 3 && (
                <div className="px-3 pb-2">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search saved films…"
                    className="w-full border border-[var(--color-line)] bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-ink)]"
                  />
                </div>
              )}
              <div className="max-h-64 overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="px-4 py-3 text-xs italic text-[var(--color-muted)]">
                    No saved films match “{query}”.
                  </div>
                ) : (
                  filtered.map((f) => {
                  const isActive = active?.id === f.id;
                  return (
                    <div
                      key={f.id}
                      className={`flex items-stretch hover:bg-[var(--color-soft)] ${
                        isActive ? "bg-[var(--color-soft)]" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => choose(f.id)}
                        className="flex-1 text-left px-4 py-2 flex items-center gap-2 min-w-0"
                      >
                        <span
                          className={`w-3 h-3 border shrink-0 flex items-center justify-center text-[8px] ${
                            isActive
                              ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                              : "border-[var(--color-line)]"
                          }`}
                        >
                          {isActive && "✓"}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm truncate">{f.film.title || "Untitled"}</div>
                          <div className="text-[10px] text-[var(--color-muted)]">
                            {f.film.genres.slice(0, 2).join(" · ") || "—"} ·{" "}
                            {timeAgo(f.savedAt)}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${f.film.title || "Untitled"}" from your library?`)) {
                            remove(f.id);
                          }
                        }}
                        className="px-3 text-[var(--color-muted)] hover:text-[var(--color-accent)] text-sm"
                        aria-label="Delete"
                      >
                        ×
                      </button>
                    </div>
                  );
                  })
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => { setOpen(false); openModal(); }}
            className="block w-full text-left border-t border-[var(--color-line)] px-4 py-2.5 text-sm text-[var(--color-ink)] hover:bg-[var(--color-soft)]"
          >
            + Upload a new film…
          </button>
        </div>
      )}
    </div>
  );
}
