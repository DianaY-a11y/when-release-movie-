// LLM-generated audience profile + genre tags for an uploaded film description.
// Output schema matches FilmTags entries so the rest of the pipeline reuses them.

import type { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `You analyze film descriptions for a theatrical-distribution team.
Given a synopsis + light metadata, output a JSON object with:
  genre_tags: 2-4 fine-grained tags (e.g. "supernatural-horror", "coming-of-age", "neo-noir", "action-tentpole", "prestige-drama")
  audience_tags: 3-5 audience descriptors (e.g. "young-male", "couples-30-plus", "awards-watchers", "horror-fans", "family-with-young-kids", "word-of-mouth-driven")
  audience_profile: one sentence describing the target audience and why this film appeals to them.
Use the same tag vocabulary as you would for established peers. Be specific, not generic.
Return ONLY the JSON object, no preamble.`;

type ProfileRequest = {
  title: string;
  synopsis: string;
  genres?: string[];
  mpaa?: string | null;
};

type ProfileResponse = {
  genre_tags: string[];
  audience_tags: string[];
  audience_profile: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as ProfileRequest;
  if (!body.title || !body.synopsis) {
    return Response.json({ error: "title + synopsis required" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userMsg = [
    `TITLE: ${body.title}`,
    body.mpaa ? `MPAA: ${body.mpaa}` : null,
    body.genres?.length ? `BOX-OFFICE GENRES: ${body.genres.join(", ")}` : null,
    `SYNOPSIS: ${body.synopsis}`,
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });

  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");

  // Strip possible code fences.
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();

  let parsed: ProfileResponse;
  try {
    parsed = JSON.parse(cleaned) as ProfileResponse;
  } catch {
    return Response.json({ error: "model output was not valid JSON", raw: text }, { status: 502 });
  }

  return Response.json(parsed);
}
