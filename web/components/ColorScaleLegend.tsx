type Props = {
  /** Maps 0..1 to a CSS color. Pass the same function the cells use so legend matches. */
  color: (t: number) => string;
  /** Label for the low (0) end. */
  lowLabel?: string;
  /** Label for the high (1) end. */
  highLabel?: string;
  /** Number of swatches in the gradient strip. */
  steps?: number;
  /** Show the "holiday week" dot marker beneath the strip. */
  showHoliday?: boolean;
  /** Horizontal alignment of the stacked rows. */
  align?: "start" | "end";
};

/**
 * Shared gradient legend used by both the seasonal heatmap and the calendar grid so the
 * two views read the same way. Defaults to a bad → good scale.
 */
export function ColorScaleLegend({
  color,
  lowLabel = "bad",
  highLabel = "good",
  steps = 7,
  showHoliday = false,
  align = "start",
}: Props) {
  const swatches = Array.from({ length: steps }, (_, i) => i / (steps - 1));
  return (
    <div className={`flex flex-col gap-2 ${align === "end" ? "items-end" : "items-start"}`}>
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
          {lowLabel}
        </span>
        <div className="flex">
          {swatches.map((v) => (
            <div key={v} className="h-4 w-6" style={{ background: color(v) }} aria-hidden />
          ))}
        </div>
        <span className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
          {highLabel}
        </span>
      </div>
      {showHoliday && (
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-ink)]" />
          <span className="text-xs text-[var(--color-muted)]">holiday week</span>
        </div>
      )}
    </div>
  );
}
