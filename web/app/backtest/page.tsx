import { BacktestChart } from "@/components/BacktestChart";
import { getBacktest } from "@/lib/backtest/run";
import {
  loadDecay,
  loadFilmIndex,
  loadFilmTags,
  loadForward,
  loadLegs,
  loadWeeklyIndie,
  loadWeeklyIndustry,
} from "@/lib/data/load";

export default async function BacktestPage() {
  const [weeklyIndustry, weeklyIndie, legs, decay, forward, filmIndex, filmTags] = await Promise.all([
    loadWeeklyIndustry(),
    loadWeeklyIndie(),
    loadLegs(),
    loadDecay(),
    loadForward(),
    loadFilmIndex(),
    loadFilmTags(),
  ]);

  if (!weeklyIndustry || !weeklyIndie || !legs || !decay || !forward || !filmIndex) {
    return (
      <div className="max-w-7xl mx-auto px-8 py-16">
        <h1 className="text-3xl font-semibold mb-4 tracking-tight">Backtest</h1>
        <div className="border border-[var(--color-accent)] bg-[var(--color-soft)] p-4 text-sm">
          Snapshot data missing. Run the scraper pipeline + publish first.
        </div>
      </div>
    );
  }

  const result = getBacktest({ weeklyIndustry, weeklyIndie, legs, decay, forward, filmIndex, filmTags });

  return (
    <div className="max-w-7xl mx-auto px-8 py-12 space-y-10">
      <div className="max-w-3xl">
        <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
          Validation
        </div>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">
          Holdout validation.
        </h1>
        <p className="mt-4 text-base text-[var(--color-muted)] leading-relaxed">
          Spearman rank correlation between our aggregated weekend score and the
          historical peer-median opener for that ISO week, across indie-tier films
          released 2022–24. Each film is scored using its genre-assigned preset weights
          (the same logic the live UI applies), so the per-preset breakdown below shows
          whether any preset's weights underperform.
        </p>
      </div>

      <BacktestChart data={result} />

      <div className="border-t border-[var(--color-line)] pt-6 max-w-3xl">
        <div className="text-xs uppercase tracking-widest text-[var(--color-muted)] mb-2">
          Methodology + caveats
        </div>
        <div className="text-sm text-[var(--color-muted)] space-y-3 leading-relaxed">
          <p>
            For each film, we run the live scoring engine (the same one that powers the
            Landscape grid and the Compare cards) on every weekend in ±12 weeks of its
            actual release date. Competitors are drawn from same-year peers within that
            window — the film itself is excluded. The &ldquo;realized&rdquo; ranking is
            the historical peer-median opener for that ISO week from{" "}
            <code className="font-mono">weekly_indie.json</code>.
          </p>
          <p>
            <span className="text-[var(--color-ink)] font-medium">Open caveats.</span>{" "}
            The peer-median snapshot is computed over 2015–25 including the film&apos;s own
            year — a strict holdout would re-aggregate per-film. Opening-norm is by
            construction derived from peer median, so a positive ρ has a built-in
            bias; this test is closer to &ldquo;does adding legs and competition pressure
            preserve the peer-median ranking?&rdquo; than &ldquo;does the score
            independently predict performance?&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}
