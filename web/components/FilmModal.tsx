"use client";

import { useEffect } from "react";
import { useFilms } from "@/lib/film-context";
import { FilmForm } from "./FilmForm";

export function FilmModal() {
  const { modalOpen, closeModal } = useFilms();

  // Close on Escape
  useEffect(() => {
    if (!modalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, closeModal]);

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = modalOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [modalOpen]);

  if (!modalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40"
        onClick={closeModal}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-3xl mx-4 my-12 bg-[var(--color-paper)] border border-[var(--color-line)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-8 py-5">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[var(--color-muted)]">
              Profile
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Film profile</h2>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="text-[var(--color-muted)] hover:text-[var(--color-ink)] text-2xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-8 py-8">
          <FilmForm onSave={closeModal} />
        </div>
      </div>
    </div>
  );
}
