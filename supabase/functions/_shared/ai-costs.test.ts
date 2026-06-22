import { describe, expect, it } from "vitest";

import { calculateAiCost, logAiCost, normalizeAiUsage } from "./ai-costs.ts";

describe("calculateAiCost", () => {
  it("calculates text-only ad cost", () => {
    const cost = calculateAiCost({
      model: "gpt-5.5",
      endpoint: "chat.completions",
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    });

    expect(cost.input_tokens).toBe(1000);
    expect(cost.output_tokens).toBe(500);
    expect(cost.estimated_cost_usd).toBe(0.01);
    expect(cost.warnings).toEqual([]);
  });

  it("calculates image-generation cost", () => {
    const cost = calculateAiCost({
      model: "gpt-image-2",
      endpoint: "images.generations",
      usage: {
        input_tokens: 1000,
        output_tokens: 2000,
        input_tokens_details: { image_tokens: 300, text_tokens: 700 },
        output_tokens_details: { image_tokens: 2000 },
      },
    });

    expect(cost.image_input_tokens).toBe(300);
    expect(cost.image_text_input_tokens).toBe(700);
    expect(cost.image_output_tokens).toBe(2000);
    expect(cost.estimated_cost_usd).toBeGreaterThan(0);
  });

  it("calculates image edit cost", () => {
    const cost = calculateAiCost({
      model: "gpt-image-2",
      endpoint: "images.edits",
      usage: {
        input_tokens: 1200,
        output_tokens: 1800,
        input_tokens_details: { image_tokens: 900, text_tokens: 300 },
        output_tokens_details: { image_tokens: 1800 },
      },
    });

    expect(cost.image_input_tokens).toBe(900);
    expect(cost.estimated_cost_usd).toBeGreaterThan(0);
  });

  it("calculates voice transcription cost", () => {
    const cost = calculateAiCost({
      model: "gpt-4o-mini-transcribe",
      endpoint: "audio.transcriptions",
      audioSeconds: 30,
    });

    expect(cost.audio_seconds).toBe(30);
    expect(cost.estimated_cost_usd).toBe(0.0015);
  });

  it("calculates translation cost", () => {
    const cost = calculateAiCost({
      model: "gpt-5.4-mini",
      endpoint: "chat.completions",
      usage: { prompt_tokens: 800, completion_tokens: 400 },
    });

    expect(cost.estimated_cost_usd).toBe(0.0024);
  });

  it("calculates web-search cost", () => {
    const cost = calculateAiCost({
      model: "gpt-4o-search-preview",
      endpoint: "chat.completions",
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      webSearchCalls: 1,
    });

    expect(cost.web_search_calls).toBe(1);
    expect(cost.estimated_cost_usd).toBeGreaterThanOrEqual(0.01);
  });

  it("flags missing usage response", () => {
    const cost = calculateAiCost({
      model: "gpt-5.4-mini",
      endpoint: "chat.completions",
      usage: null,
    });

    expect(cost.estimated_cost_usd).toBe(0);
    expect(cost.warnings).toContain("MISSING_USAGE");
  });

  it("flags unknown model", () => {
    const cost = calculateAiCost({
      model: "unknown-model",
      endpoint: "chat.completions",
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });

    expect(cost.estimated_cost_usd).toBe(0);
    expect(cost.warnings).toContain("UNKNOWN_MODEL:unknown-model");
  });

  it("normalizes cached input tokens", () => {
    const usage = normalizeAiUsage({
      usage: {
        input_tokens: 1000,
        output_tokens: 20,
        input_tokens_details: { cached_tokens: 250 },
      },
    });

    expect(usage.input_tokens).toBe(1000);
    expect(usage.cached_input_tokens).toBe(250);
  });

  it("logs explicit Gemini image cost estimates without usage warnings", async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    const admin = {
      from(table: string) {
        return {
          async insert(row: Record<string, unknown>) {
            inserts.push({ table, row });
            return { error: null };
          },
        };
      },
    };

    await logAiCost(admin, {
      businessId: "business-1",
      ownerUserId: "owner-1",
      requestGroupId: "11111111-1111-4111-8111-111111111111",
      feature: "image_generation",
      provider: "gemini",
      model: "gemini-3.1-flash-image",
      endpoint: "models.generateContent",
      estimatedCostUsd: 0.067,
      success: true,
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.table).toBe("ai_generation_costs");
    expect(inserts[0]?.row.provider).toBe("gemini");
    expect(inserts[0]?.row.model).toBe("gemini-3.1-flash-image");
    expect(inserts[0]?.row.estimated_cost_usd).toBe(0.067);
    expect(inserts[0]?.row.error_message).toBeNull();
  });
});
