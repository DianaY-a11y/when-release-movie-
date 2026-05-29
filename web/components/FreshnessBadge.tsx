import { loadMeta } from "@/lib/data/load";

function relativeFromNow(iso: string): string {
  const generated = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - generated;
  if (diffMs < 0) return "in the future";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export async function FreshnessBadge() {
  const meta = await loadMeta();
  if (!meta) {
    return (
      <span className="text-xs text-[var(--color-accent)] uppercase tracking-widest">
        no data snapshot
      </span>
    );
  }
  return (
    <span className="text-xs text-[var(--color-muted)] uppercase tracking-widest whitespace-nowrap">
      data · {relativeFromNow(meta.generated_at)}
    </span>
  );
}
