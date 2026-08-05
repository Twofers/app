import { describe, expect, it } from "vitest";
import {
  MAX_GROUNDED_SOURCE_TEXT_CHARS,
  MAX_GROUNDED_SOURCE_URLS,
  buildGroundedSourceBlocks,
  extractGroundedText,
  extractPageTitle,
} from "./admin-ai-grounding.ts";

describe("extractPageTitle", () => {
  it("extracts and trims a simple title", () => {
    expect(extractPageTitle("<html><head><title>  Joe's Cafe  </title></head></html>")).toBe("Joe's Cafe");
  });

  it("collapses internal whitespace", () => {
    expect(extractPageTitle("<title>Joe's\n  Cafe   -   Home</title>")).toBe("Joe's Cafe - Home");
  });

  it("returns an empty string when there is no title tag", () => {
    expect(extractPageTitle("<html><body>hello</body></html>")).toBe("");
  });

  it("caps at 200 characters", () => {
    const long = "x".repeat(500);
    expect(extractPageTitle(`<title>${long}</title>`).length).toBe(200);
  });

  it("is defensive against non-string input", () => {
    expect(extractPageTitle(undefined as unknown as string)).toBe("");
    expect(extractPageTitle(null as unknown as string)).toBe("");
  });
});

describe("extractGroundedText", () => {
  it("strips tags and caps at MAX_GROUNDED_SOURCE_TEXT_CHARS", () => {
    const html = `<html><body><h1>Joe's Cafe</h1><p>${"Fresh coffee and pastries daily. ".repeat(300)}</p></body></html>`;
    const text = extractGroundedText(html);
    expect(text).not.toMatch(/<[^>]+>/);
    expect(text.length).toBeLessThanOrEqual(MAX_GROUNDED_SOURCE_TEXT_CHARS);
    expect(text).toContain("Joe's Cafe");
  });

  it("returns an empty string for empty input", () => {
    expect(extractGroundedText("")).toBe("");
  });
});

describe("buildGroundedSourceBlocks", () => {
  it("returns an empty string for no sources", () => {
    expect(buildGroundedSourceBlocks([])).toBe("");
  });

  it("formats a fetched source with its title and text", () => {
    const block = buildGroundedSourceBlocks([
      { url: "https://example.com", status: "fetched", title: "Example", text: "Some readable text." },
    ]);
    expect(block).toContain("Fetched source content: https://example.com");
    expect(block).toContain("Title: Example");
    expect(block).toContain("Some readable text.");
  });

  it("formats a failed fetch as an explicit, unverified note rather than silently dropping it", () => {
    const block = buildGroundedSourceBlocks([
      { url: "https://example.com/blocked", status: "failed", reason: "BLOCKED_URL" },
    ]);
    expect(block).toContain("fetch failed for https://example.com/blocked");
    expect(block).toContain("BLOCKED_URL");
    expect(block).toContain("unverified bare URL only");
  });

  it("joins multiple sources with a blank line between blocks", () => {
    const block = buildGroundedSourceBlocks([
      { url: "https://a.example.com", status: "fetched", text: "A" },
      { url: "https://b.example.com", status: "fetched", text: "B" },
    ]);
    expect(block.split("\n\n").length).toBe(2);
  });
});

describe("caps", () => {
  it("keeps the source-url cap at 3 as specified", () => {
    expect(MAX_GROUNDED_SOURCE_URLS).toBe(3);
  });

  it("keeps the per-source text cap at 4000 as specified", () => {
    expect(MAX_GROUNDED_SOURCE_TEXT_CHARS).toBe(4_000);
  });
});
