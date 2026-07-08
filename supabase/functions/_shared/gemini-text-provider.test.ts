import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { geminiMaxOutputTokens } from "./gemini-text-provider.ts";

describe("geminiMaxOutputTokens", () => {
  it("adds a thinking reserve on top of the caller's visible-output budget", () => {
    // Gemini counts thought tokens against maxOutputTokens; without the reserve
    // a medium-thinking call (e.g. translation_qa at 850 tokens) truncated its
    // JSON payload -> GEMINI_JSON_PARSE_FAILED (K-001).
    expect(geminiMaxOutputTokens(850, "medium")).toBe(850 + 4096);
    expect(geminiMaxOutputTokens(850, "low")).toBe(850 + 1024);
    expect(geminiMaxOutputTokens(850, "high")).toBe(850 + 8192);
    expect(geminiMaxOutputTokens(850, "minimal")).toBe(850 + 256);
  });

  it("falls back to the medium reserve for unknown levels and floors tiny budgets", () => {
    expect(geminiMaxOutputTokens(850, "unexpected")).toBe(850 + 4096);
    expect(geminiMaxOutputTokens(0, "minimal")).toBe(256 + 256);
  });
});

describe("gemini structured generation source", () => {
  const source = readFileSync(
    join(__dirname, "gemini-text-provider.ts"),
    "utf8",
  );

  it("applies the thinking reserve to the request's generationConfig", () => {
    expect(source).toMatch(/maxOutputTokens:\s*geminiMaxOutputTokens\(/);
  });

  it("flags MAX_TOKENS truncation in empty/invalid JSON errors", () => {
    expect(source).toContain('geminiFinishReason(json) === "MAX_TOKENS"');
    expect(source).toContain("output token budget exhausted");
  });
});
