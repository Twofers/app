/**
 * Pure, I/O-free helpers for admin-prospect-enrich's V2 grounding fetch
 * (ADMIN_AI_V2_ENABLED). The actual SSRF-safe network fetch (DNS resolution,
 * byte-capped streaming, redirect handling) lives in
 * admin-prospect-enrich/index.ts itself, mirroring the safeFetch pattern in
 * import-business-website/index.ts. This module only holds the parts of that
 * pipeline that touch no network and can be unit-tested directly: extracting
 * a page title and clamping readable text to a prompt-safe size.
 *
 * Readable-text extraction reuses site-import.ts's htmlToMenuText (imported,
 * not edited) rather than duplicating an HTML-to-text stripper here.
 */

import { htmlToMenuText } from "./site-import.ts";

/** Per-source-url cap on how much extracted text is injected into the enrichment prompt. */
export const MAX_GROUNDED_SOURCE_TEXT_CHARS = 4_000;

/** Admin-supplied source_urls fetched per enrichment run. */
export const MAX_GROUNDED_SOURCE_URLS = 3;

/** Mirrors extractTitle() in import-business-website/index.ts (that file is not edited by this change). */
export function extractPageTitle(html: string): string {
  const source = typeof html === "string" ? html : "";
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(source);
  return match ? match[1].replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

/** Reduces raw HTML to readable text and caps it to MAX_GROUNDED_SOURCE_TEXT_CHARS. */
export function extractGroundedText(html: string): string {
  return htmlToMenuText(html).slice(0, MAX_GROUNDED_SOURCE_TEXT_CHARS);
}

export type GroundedSourceBlock = {
  url: string;
  status: "fetched" | "failed";
  title?: string;
  text?: string;
  reason?: string;
};

/**
 * Formats fetched (and failed) sources into the "Fetched source content:"
 * prompt blocks the V2 prospect_enrichment system prompt instructs the model
 * to ground itself in and cite from. A failed fetch is still listed (with its
 * reason) rather than silently dropped, so the model can see the URL was
 * supplied but not readable, and the fallback bare-URL note in the existing
 * source_urls field remains meaningful.
 */
export function buildGroundedSourceBlocks(sources: GroundedSourceBlock[]): string {
  if (!sources.length) return "";
  const blocks = sources.map((source) => {
    if (source.status === "failed") {
      return `Fetched source content: (fetch failed for ${source.url}${source.reason ? `, reason: ${source.reason}` : ""}; treat this as an unverified bare URL only)`;
    }
    const titleLine = source.title ? `Title: ${source.title}\n` : "";
    return `Fetched source content: ${source.url}\n${titleLine}${source.text ?? ""}`;
  });
  return blocks.join("\n\n");
}
