import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-generate-ad-variants", "index.ts"),
  "utf8",
);
const textProviderSource = readFileSync(
  join(process.cwd(), "supabase", "functions", "_shared", "ai-text-provider.ts"),
  "utf8",
);
const openAiProviderSource = readFileSync(
  join(process.cwd(), "supabase", "functions", "_shared", "openai-text-provider.ts"),
  "utf8",
);
const geminiProviderSource = readFileSync(
  join(process.cwd(), "supabase", "functions", "_shared", "gemini-text-provider.ts"),
  "utf8",
);

describe("ai-generate-ad-variants vision QA source guard", () => {
  it("keeps Gemini vision QA fallback behind the hosted fallback flag", () => {
    expect(source).toMatch(/AI_VISION_FALLBACK_ENABLED/);
    expect(source).toMatch(/AI_VISION_FALLBACK_PROVIDER/);
    expect(source).toMatch(/function geminiVisionQaFallbackEnabled/);
    expect(source).toMatch(/function makeImageQaConfig/);
    expect(source).toMatch(/fallbackEnabled,\s*\n\s*fallbackProvider:\s*"gemini"/);
  });

  it("routes image QA through the shared structured provider router", () => {
    const inspectIndex = source.indexOf("async function inspectGeneratedImageForOffer(");
    const sourceAwareIndex = source.indexOf("async function sourceAwareQaForImageBytes(");

    expect(inspectIndex).toBeGreaterThan(-1);
    expect(sourceAwareIndex).toBeGreaterThan(inspectIndex);

    const inspectBlock = source.slice(inspectIndex, sourceAwareIndex);
    expect(inspectBlock).toMatch(/generateStructuredText<typeof QUICK_DEAL_IMAGE_QA_SCHEMA, QuickDealImageQaResult>/);
    expect(inspectBlock).toMatch(/operation:\s*"image_qa"/);
    expect(inspectBlock).toMatch(/imageInputs:\s*\[\{ bytes: params\.imageBytes, mimeType: "image\/png" \}\]/);
    expect(inspectBlock).toMatch(/QUICK_DEAL_IMAGE_QA_SCHEMA/);
    expect(inspectBlock).toMatch(/config:\s*makeImageQaConfig\(\)/);
    expect(inspectBlock).toMatch(/logTextProviderAttempts\(params\.costContext, "image_qa", result\.attempts\)/);
    expect(inspectBlock).toMatch(/attempts\?: ProviderAttempt\[\]/);
    expect(inspectBlock).toMatch(/AI_IMAGE_QA_UNAVAILABLE/);
    expect(inspectBlock).not.toMatch(/api\.openai\.com\/v1\/responses/);
    expect(inspectBlock).not.toMatch(/generativelanguage\.googleapis\.com/);
    expect(inspectBlock).not.toMatch(/x-goog-api-key/);
  });

  it("keeps shared providers capable of structured image QA", () => {
    expect(textProviderSource).toMatch(/\|\s*"image_qa"/);
    expect(textProviderSource).toMatch(/operation === "image_qa"\) return "vision_qa"/);
    expect(openAiProviderSource).toMatch(/request\.imageInputs/);
    expect(openAiProviderSource).toMatch(/type:\s*"image_url"/);
    expect(openAiProviderSource).toMatch(/json_schema:\s*openAiJsonSchema\(params\.request\.jsonSchema\)/);
    expect(geminiProviderSource).toMatch(/request\.imageInputs/);
    expect(geminiProviderSource).toMatch(/inlineData/);
    expect(geminiProviderSource).toMatch(/responseSchema:\s*geminiResponseSchema\(params\.request\.jsonSchema\)/);
  });

  it("does not store raw exception text in ad-variant AI failure telemetry", () => {
    expect(source).toMatch(/Ad research failed before a usable response was returned/);
    expect(source).toMatch(/Candidate judge unavailable/);
    expect(source).toMatch(/AI_IMAGE_QA_UNAVAILABLE/);
    expect(source).toMatch(/failure_reason:\s*"COPY_FAILED"/);
    expect(source).not.toMatch(/String\(e\)\.slice/);
    expect(source).not.toMatch(/err:\s*String\(e\)/);
    expect(source).not.toMatch(/failure_reason:\s*String\(e\)/);
    expect(source).not.toMatch(/errorMessage:\s*String\(e\)\.slice/);
  });

  it("requires and forwards bounded custom image edit instructions", () => {
    expect(source).toMatch(/IMAGE_EDIT_INSTRUCTION_REQUIRED/);
    expect(source).toMatch(/const customImageEditInstruction =/);
    expect(source).toMatch(/customImageEditInstruction,/);
    expect(source).toMatch(/customEditInstruction: params\.imageEditMode === "custom"/);
    expect(source).toMatch(/customEditInstruction\.instruction/);
    expect(source).toMatch(/imageEditMode === "custom"\s*\?\s*"studiopolish"/);
  });

  it("runs source-aware QA before accepting approved stock fallback", () => {
    const fallbackIndex = source.indexOf("async function produceFallbackImage(");
    const produceImageIndex = source.indexOf("async function produceImage(");
    const helperIndex = source.indexOf("async function qaApprovedStockFallback(");

    expect(helperIndex).toBeGreaterThan(-1);
    expect(fallbackIndex).toBeGreaterThan(helperIndex);
    expect(produceImageIndex).toBeGreaterThan(fallbackIndex);

    const helperBlock = source.slice(helperIndex, fallbackIndex);
    expect(helperBlock).toMatch(/sourceType:\s*"approved_stock"/);
    expect(helperBlock).toMatch(/fetchApprovedStockImageBytes/);
    expect(helperBlock).toMatch(/sourceAwareQaForImageBytes/);
    expect(helperBlock).toMatch(/shouldFailClosedForImageQa\(sourceAware\)/);

    const fallbackBlock = source.slice(fallbackIndex, produceImageIndex);
    expect(fallbackBlock).toMatch(/findStockImageFallbacks/);
    expect(fallbackBlock).toMatch(/AI_STOCK_QA_CANDIDATE_LIMIT/);
    expect(fallbackBlock).toMatch(/for \(const stockPath of stockPaths\.slice\(0, maxStockQaCandidates\)\)/);
    expect(fallbackBlock).toMatch(/qaApprovedStockFallback/);
    expect(fallbackBlock).toMatch(/qa:\s*stockQa/);
    expect(fallbackBlock).not.toMatch(/skippedImageQaTelemetry\("approved_stock"\)/);
  });

  it("keeps vision QA active even when no required visual items are inferred", () => {
    const inspectIndex = source.indexOf("async function inspectGeneratedImageForOffer(");
    const sourceAwareIndex = source.indexOf("async function sourceAwareQaForImageBytes(");
    const stockFetchIndex = source.indexOf("async function fetchApprovedStockImageBytes(");

    const inspectBlock = source.slice(inspectIndex, sourceAwareIndex);
    const sourceAwareBlock = source.slice(sourceAwareIndex, stockFetchIndex);

    expect(inspectBlock).not.toMatch(/requiredVisualItems\.length === 0\)\s*return null/);
    expect(sourceAwareBlock).not.toMatch(/requiredVisualItems\.length === 0/);
  });
});
