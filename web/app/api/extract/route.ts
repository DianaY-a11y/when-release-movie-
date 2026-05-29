// Extract film metadata from an uploaded document (PDF, DOCX, or plain text).
// PDFs go directly to Claude as a base64 document block (avoids browser-only pdfjs-dist).
// DOCX is converted via mammoth; plain text is sent as-is.

import type { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type {
  DocumentBlockParam,
  TextBlockParam,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages/messages";

const GENRES = [
  "Action","Adventure","Animation","Biography","Comedy","Crime",
  "Drama","Family","Fantasy","Horror","Mystery","Romance","Sci-Fi","Thriller","War",
];

const SYSTEM = `You extract film metadata from marketing or production documents.
Output ONLY a JSON object with these fields:
  title: string (film title, or "" if not found)
  synopsis: string (1–3 sentence plot summary; write one if not explicit)
  genres: string[] (0–4 items, picked only from: ${GENRES.join(", ")})
  mpaa: string | null (one of G, PG, PG-13, R, NC-17, or null if unknown)
  tier: "indie" | "industry" (indie = A24-style / prestige / arthouse / limited; industry = major studio tentpole / wide commercial release)
Be concise. Return ONLY the JSON.`;

type ExtractedFilm = {
  title: string;
  synopsis: string;
  genres: string[];
  mpaa: string | null;
  tier: "indie" | "industry";
};

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    file = form.get("file") as File | null;
  } catch {
    return Response.json({ error: "Could not parse form data" }, { status: 400 });
  }

  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const name = file.name.toLowerCase();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let params: MessageCreateParamsNonStreaming;

  if (name.endsWith(".pdf")) {
    const buf = Buffer.from(await file.arrayBuffer());
    const docBlock: DocumentBlockParam = {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
    };
    const promptBlock: TextBlockParam = {
      type: "text",
      text: "Extract the film metadata from this document.",
    };
    params = {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: SYSTEM,
      messages: [{ role: "user", content: [docBlock, promptBlock] }],
    };
  } else {
    let text: string;
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      if (name.endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer: buf });
        text = result.value;
      } else {
        text = buf.toString("utf-8");
      }
    } catch (err) {
      return Response.json(
        { error: `Could not read file: ${err instanceof Error ? err.message : String(err)}` },
        { status: 422 }
      );
    }

    if (!text.trim()) {
      return Response.json({ error: "File appears to be empty or unreadable." }, { status: 422 });
    }

    params = {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: SYSTEM,
      messages: [{ role: "user", content: text.slice(0, 6000) }],
    };
  }

  const msg = await client.messages.create(params);

  const raw = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as TextBlockParam).text)
    .join("");

  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();

  let parsed: ExtractedFilm;
  try {
    parsed = JSON.parse(cleaned) as ExtractedFilm;
  } catch {
    return Response.json({ error: "Model output was not valid JSON", raw }, { status: 502 });
  }

  return Response.json(parsed);
}
