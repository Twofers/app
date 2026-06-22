import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-generate-ad-variants", "index.ts"),
  "utf8",
);

describe("ai-generate-ad-variants vision QA source guard", () => {
  it("keeps Gemini vision QA fallback behind the hosted fallback flag", () => {
    expect(source).toMatch(/AI_VISION_FALLBACK_ENABLED/);
    expect(source).toMatch(/AI_VISION_FALLBACK_PROVIDER/);
    expect(source).toMatch(/function geminiVisionQaFallbackEnabled/);
  });

  it("falls back to Gemini when OpenAI image QA is unavailable", () => {
    const inspectIndex = source.indexOf("async function inspectGeneratedImageForOffer(");
    const geminiHelperIndex = source.indexOf("async function inspectGeneratedImageForOfferWithGemini(");

    expect(inspectIndex).toBeGreaterThan(-1);
    expect(geminiHelperIndex).toBeGreaterThan(inspectIndex);

    const inspectBlock = source.slice(inspectIndex, geminiHelperIndex);
    expect(inspectBlock).toMatch(/const geminiFallback = \(\) =>/);
    expect(inspectBlock).toMatch(/provider:\s*"openai"/);
    expect(inspectBlock.match(/return await geminiFallback\(\);/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("sends image bytes through Gemini with the same QA schema and private telemetry", () => {
    const helperIndex = source.indexOf("async function inspectGeneratedImageForOfferWithGemini(");
    const sourceAwareIndex = source.indexOf("async function sourceAwareQaForImageBytes(");

    expect(helperIndex).toBeGreaterThan(-1);
    expect(sourceAwareIndex).toBeGreaterThan(helperIndex);

    const helperBlock = source.slice(helperIndex, sourceAwareIndex);
    expect(helperBlock).toMatch(/x-goog-api-key/);
    expect(helperBlock).toMatch(/inlineData/);
    expect(helperBlock).toMatch(/bytesToBase64\(params\.imageBytes\)/);
    expect(helperBlock).toMatch(/geminiResponseSchema\(QUICK_DEAL_IMAGE_QA_SCHEMA\)/);
    expect(helperBlock).toMatch(/provider:\s*"gemini"/);
    expect(helperBlock).toMatch(/endpoint:\s*"models\.generateContent"/);
    expect(helperBlock).not.toMatch(/await res\.text\(\)/);
  });

  it("does not store raw exception text in ad-variant AI failure telemetry", () => {
    expect(source).toMatch(/Ad research failed before a usable response was returned/);
    expect(source).toMatch(/Candidate judge unavailable/);
    expect(source).toMatch(/OpenAI image QA failed before a usable response was returned/);
    expect(source).toMatch(/Gemini image QA failed before a usable response was returned/);
    expect(source).toMatch(/failure_reason:\s*"COPY_FAILED"/);
    expect(source).not.toMatch(/String\(e\)\.slice/);
    expect(source).not.toMatch(/err:\s*String\(e\)/);
    expect(source).not.toMatch(/failure_reason:\s*String\(e\)/);
    expect(source).not.toMatch(/errorMessage:\s*String\(e\)\.slice/);
  });
});
