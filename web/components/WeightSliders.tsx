"use client";

import type { Weights } from "@/lib/scoring/types";
import { PRESETS, type PresetKey } from "@/lib/scoring/presets";

type Props = {
  weights: Weights;
  preset: PresetKey;
  onPreset: (k: PresetKey) => void;
  onChange: (w: Weights) => void;
};

function Slider({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-between">
        <label className="text-sm">{label}</label>
        <span className="text-xs font-mono text-[var(--color-muted)]">
          {(value * 100).toFixed(0)}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="block w-full my-0"
      />
      <p className="text-xs text-[var(--color-muted)] leading-snug">{hint}</p>
    </div>
  );
}

export function WeightSliders({ weights, preset, onPreset, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
          Genre preset
        </div>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onPreset(k)}
              className={`border px-2.5 py-1 text-xs ${
                preset === k
                  ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                  : "border-[var(--color-line)] hover:border-[var(--color-ink)]"
              }`}
            >
              {PRESETS[k].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--color-muted)] italic mt-2">
          {PRESETS[preset].rationale}
        </p>
      </div>
      <div className="space-y-2.5">
        <Slider
          label="Opening potential"
          value={weights.opening}
          onChange={(v) => onChange({ ...weights, opening: v })}
          hint="How strong is this ISO week historically for the candidate's tier?"
        />
        <Slider
          label="Legs"
          value={weights.legs}
          onChange={(v) => onChange({ ...weights, legs: v })}
          hint="Median multiplier of peer films opening near this week."
        />
        <Slider
          label="Competition penalty"
          value={weights.competition}
          onChange={(v) => onChange({ ...weights, competition: v })}
          hint="Σ similarity × expected-share over openers + holdovers."
        />
      </div>
    </div>
  );
}
