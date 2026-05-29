"use client";

import { useState } from "react";

type Props = {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
};

export function EditableChips({ values, onChange, placeholder }: Props) {
  const [draft, setDraft] = useState("");

  function add(tag: string) {
    const t = tag.trim();
    if (!t) return;
    if (values.includes(t)) return;
    onChange([...values, t]);
    setDraft("");
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1.5 min-h-[2.5rem]">
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1.5 border border-[var(--color-line)] bg-[var(--color-soft)] px-2 py-0.5 text-xs"
        >
          <span className="font-mono">{v}</span>
          <button
            type="button"
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            aria-label={`Remove ${v}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
        placeholder={placeholder ?? "add tag…"}
        className="bg-transparent text-xs font-mono outline-none min-w-[7rem] flex-1 px-1"
      />
    </div>
  );
}
