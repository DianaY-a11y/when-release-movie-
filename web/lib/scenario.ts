// URL-encoded scenario state so /film and /compare round-trip via shareable links.
// We base64-encode JSON so the URL stays opaque-ish (and ? & = aren't an issue).

import type { CandidateFilm, Weights } from "@/lib/scoring/types";

export type Scenario = {
  film: CandidateFilm;
  weekends?: string[];
  weights?: Weights;
  preset?: string;
};

function toBase64Url(s: string): string {
  if (typeof window === "undefined") {
    return Buffer.from(s, "utf8").toString("base64url");
  }
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  if (typeof window === "undefined") {
    return Buffer.from(s, "base64url").toString("utf8");
  }
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(padded)));
}

export function encodeScenario(s: Scenario): string {
  return toBase64Url(JSON.stringify(s));
}

export function decodeScenario(token: string): Scenario | null {
  try {
    return JSON.parse(fromBase64Url(token)) as Scenario;
  } catch {
    return null;
  }
}
