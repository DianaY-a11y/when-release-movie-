// Curated distributor universe — the slate of distributors A24's planners watch.
// Films from distributors *outside* this universe (Fathom re-releases, Netflix
// streaming originals, MUBI, regional / faith-based specialty outfits) are excluded
// from every Calendar filter, including "All". The "Type" buttons partition this
// universe into majors and prestige.
//
// Substring matching is case-insensitive against the distributor field on
// forward-schedule items (Box Office Mojo / The Numbers occasionally vary names —
// "Walt Disney" vs "Walt Disney Studios Motion Pictures", "Searchlight" vs
// "Searchlight Pictures", "Amazon MGM Studios" for the MGM slate post-merger).

export type DistributorCategory = "studio" | "prestige" | "other";

// Major studios (8). Substring patterns match the real distributor strings.
const STUDIO_PATTERNS = [
  "universal",
  "walt disney",
  "warner bros",
  "paramount",
  "sony pictures", // catches "Sony Pictures" AND "Sony Pictures Classics" —
                   // Classics is intercepted by the prestige check first.
  "mgm",           // matches "Amazon MGM Studios"
  "lionsgate",
  "20th century", // matches "20th Century Studios" (post-Fox rename)
];

// Indie / Prestige (8). Sony Pictures Classics is here, not under Sony.
const PRESTIGE_PATTERNS = [
  "a24",
  "neon",
  "focus features",
  "searchlight",        // matches "Searchlight Pictures"
  "bleecker street",
  "magnolia pictures",
  "black bear",
  "sony pictures classics",
];

// In-universe but neither major nor prestige (7). Shown under "All" only.
const OTHER_PATTERNS = [
  "angel studios",
  "vertical entertainment",
  "ketchup entertainment",
  "icon film",       // matches "Icon Film Distribution"
  "godzilla kingdom",
  "bbe",
  "cnv",
];

export function distributorCategory(distributor: string | null): DistributorCategory | null {
  if (!distributor) return null;
  const d = distributor.toLowerCase();
  // Prestige checked first so "Sony Pictures Classics" resolves to prestige before
  // the "sony pictures" studio pattern catches it.
  if (PRESTIGE_PATTERNS.some((p) => d.includes(p))) return "prestige";
  if (STUDIO_PATTERNS.some((p) => d.includes(p))) return "studio";
  if (OTHER_PATTERNS.some((p) => d.includes(p))) return "other";
  return null;
}

export function inUniverse(distributor: string | null): boolean {
  return distributorCategory(distributor) !== null;
}

// The Type filter has exactly two buttons in the UI: "All" (anything in the curated
// universe) and "Indie / Prestige" (just the prestige subset). Films from distributors
// outside the universe are excluded under both.
export type CategoryFilter = "all" | "prestige";

export function matchesCategoryFilter(
  distributor: string | null,
  filter: CategoryFilter
): boolean {
  const cat = distributorCategory(distributor);
  if (cat === null) return false; // outside the universe — never visible
  if (filter === "all") return true;
  return cat === "prestige";
}
