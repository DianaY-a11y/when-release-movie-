import { Compare } from "@/components/Compare";
import { loadWireframeDeps } from "@/lib/wireframe-deps";

export default async function ComparePage() {
  const deps = await loadWireframeDeps();
  if (!deps) {
    return (
      <div className="max-w-7xl mx-auto px-8 py-16">
        <h1 className="text-3xl font-semibold mb-4 tracking-tight">Compare weekends</h1>
        <div className="border border-[var(--color-accent)] bg-[var(--color-soft)] p-4 text-sm">
          Snapshot data missing. Run the data pipeline first.
        </div>
      </div>
    );
  }
  return <Compare deps={deps} />;
}
