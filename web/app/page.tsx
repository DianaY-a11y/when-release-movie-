import { Calendar } from "@/components/Calendar";
import {
  loadDecay,
  loadFilmIndex,
  loadForward,
  loadLegs,
  loadWeeklyIndie,
  loadWeeklyIndustry,
} from "@/lib/data/load";
import { decodeScenario } from "@/lib/scenario";

type SearchParams = Promise<{ s?: string }>;

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [forward, decay, filmIndex, weeklyIndustry, weeklyIndie, legs] = await Promise.all([
    loadForward(),
    loadDecay(),
    loadFilmIndex(),
    loadWeeklyIndustry(),
    loadWeeklyIndie(),
    loadLegs(),
  ]);
  const { s } = await searchParams;
  const scenario = s ? decodeScenario(s) : null;
  const film = scenario?.film ?? null;

  if (!forward || !decay) {
    return (
      <div className="max-w-7xl mx-auto px-8 py-16">
        <h1 className="text-3xl font-semibold mb-4 tracking-tight">Competition calendar</h1>
        <div className="border border-[var(--color-accent)] bg-[var(--color-soft)] p-4 text-sm">
          Snapshot data missing. Run the data pipeline first.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-8 py-12 space-y-12">
      <div className="max-w-3xl">
        <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
          Landscape · release-week planning
        </div>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">
          Release-week planning, weekend by weekend.
        </h1>
        <p className="mt-4 text-base text-[var(--color-muted)] leading-relaxed">
          Each weekend is colored by how it scores for your film: seasonal opening
          strength, projected legs, and the crowdedness of similar releases. Use the peer
          median lens to read the historical shape of the year; load a film profile to
          incorporate competition and overall fit. Expand the window to 52 weeks for the
          full-year view.
          {film
            ? " A film is loaded — the grid is colored by competitive fit. Click a weekend to inspect it; use the ＋ buttons to add candidates, then proceed to the Compare view."
            : ""}
        </p>
      </div>

      <Calendar
        forward={forward}
        decay={decay}
        legs={legs}
        film={film}
        weeklyIndustry={weeklyIndustry}
        weeklyIndie={weeklyIndie}
        budgetMap={Object.fromEntries(
          (filmIndex?.items ?? [])
            .filter((f) => f.budget_usd != null)
            .map((f) => [f.id, f.budget_usd])
        )}
      />
    </div>
  );
}
