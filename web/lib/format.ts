export function formatMoney(usd: number): string {
  if (!Number.isFinite(usd)) return "—";
  const sign = usd < 0 ? "-" : "";
  const v = Math.abs(usd);
  if (v >= 1_000_000_000) return `${sign}$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${sign}$${(v / 1_000).toFixed(0)}K`;
  return `${sign}$${Math.round(v)}`;
}

export function formatPct(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

// Approximate calendar month for an ISO week (ISO week 1 contains Jan 4).
// Defaults to the current year so labels track the live planning window.
export function monthOfIsoWeek(isoWeek: number, year = new Date().getUTCFullYear()): string {
  // Friday of that ISO week (BOM convention is Fri-Sun weekend).
  const jan1 = new Date(Date.UTC(year, 0, 1));
  // Find Monday of ISO week 1
  const dayOfWeek = jan1.getUTCDay() || 7; // Sunday=7 in ISO
  const isoWeek1Mon = new Date(jan1);
  isoWeek1Mon.setUTCDate(jan1.getUTCDate() - dayOfWeek + 1 + (dayOfWeek <= 4 ? 0 : 7));
  const friday = new Date(isoWeek1Mon);
  friday.setUTCDate(isoWeek1Mon.getUTCDate() + (isoWeek - 1) * 7 + 4);
  return friday.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
