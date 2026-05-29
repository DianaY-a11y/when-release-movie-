"use client";

import type { SubScores } from "@/lib/wireframe-data";

// Shared radar used by the Compare page and the Film Profile drill-in, so the two
// surfaces read identically. Plots the candidate sub-scores — all oriented
// higher = more favorable.
const RADAR_AXES: (keyof SubScores)[] = ["demand", "openness", "lowClash", "comps"];
const AXIS_SHORT: Record<keyof SubScores, string> = {
  demand: "Dem",
  openness: "Open",
  lowClash: "Clash",
  comps: "Comp",
};

export function Radar({ sub, size = 150 }: { sub: SubScores; size?: number }) {
  const c = size / 2;
  const r = size * 0.35;
  const labelR = r + size * 0.17;
  const n = RADAR_AXES.length;
  const point = (i: number, val: number) => {
    const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const rad = (val / 100) * r;
    return [c + rad * Math.cos(ang), c + rad * Math.sin(ang)] as const;
  };
  const labelPoint = (i: number) => {
    const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [c + labelR * Math.cos(ang), c + labelR * Math.sin(ang)] as const;
  };
  const poly = RADAR_AXES.map((k, i) => point(i, sub[k]).join(",")).join(" ");
  const stroke = "var(--color-ink)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[0.33, 0.66, 1].map((f) => (
        <polygon
          key={f}
          points={RADAR_AXES.map((_, i) => point(i, f * 100).join(",")).join(" ")}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={1}
        />
      ))}
      {RADAR_AXES.map((k, i) => {
        const [x, y] = point(i, 100);
        const [lx, ly] = labelPoint(i);
        return (
          <g key={k}>
            <line x1={c} y1={c} x2={x} y2={y} stroke="var(--color-line)" strokeWidth={1} />
            <text
              x={lx}
              y={ly}
              fontSize={size * 0.055}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="var(--color-muted)"
            >
              {AXIS_SHORT[k]}
            </text>
          </g>
        );
      })}
      <polygon points={poly} fill={stroke} fillOpacity={0.12} stroke={stroke} strokeWidth={1.5} />
      {RADAR_AXES.map((k, i) => {
        const [x, y] = point(i, sub[k]);
        return <circle key={k} cx={x} cy={y} r={size * 0.013} fill={stroke} />;
      })}
    </svg>
  );
}
