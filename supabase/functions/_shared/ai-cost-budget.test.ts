import { describe, expect, it } from "vitest";

import {
  estimateTextGenerationCostUsd,
  estimateTokensFromText,
  projectStructuredTextCost,
  resolveAiCostBudgetConfig,
} from "./ai-cost-budget.ts";

function env(values: Record<string, string | undefined>) {
  return {
    get(name: string) {
      return values[name];
    },
  };
}

describe("ai cost budget helpers", () => {
  it("resolves configurable budget ceilings", () => {
    const config = resolveAiCostBudgetConfig(
      env({
        AI_V3_COST_BUDGET_ENABLED: "true",
        AI_TEXT_COST_HARD_LIMIT_USD: "0.03",
        AI_TOTAL_GENERATION_COST_HARD_LIMIT_USD: "0.05",
      }),
    );

    expect(config.enabled).toBe(true);
    expect(config.textHardLimitUsd).toBe(0.03);
    expect(config.totalGenerationHardLimitUsd).toBe(0.05);
  });

  it("estimates GPT-5.5 text generation cost", () => {
    const cost = estimateTextGenerationCostUsd({
      provider: "openai",
      model: "gpt-5.5",
      inputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 500,
    });

    expect(cost).toBeGreaterThan(0);
  });

  it("blocks optional calls when projected total exceeds the hard budget", () => {
    const projection = projectStructuredTextCost({
      provider: "openai",
      model: "gpt-5.5",
      systemPrompt: "x".repeat(4000),
      userPrompt: "y".repeat(4000),
      maxOutputTokens: 650,
      completedCostUsd: 0.049,
      budget: {
        enabled: true,
        textSoftLimitUsd: 0.2,
        textHardLimitUsd: 0.5,
        totalGenerationHardLimitUsd: 0.05,
        revisionHardLimitUsd: 0.35,
      },
    });

    expect(projection.allowed).toBe(false);
    expect(projection.reason).toBe("total_generation_hard_limit");
  });

  it("prices the previously-unpriced allowlisted Gemini flash models (were silently $0)", () => {
    for (const model of ["gemini-3.1-flash", "gemini-3-flash", "gemini-2.5-flash"]) {
      const cost = estimateTextGenerationCostUsd({
        provider: "gemini",
        model,
        inputTokens: 1000,
        outputTokens: 500,
      });
      expect(cost).toBeGreaterThan(0);
    }
  });

  it("matches gemini-3.5-flash's rates for the newly-priced flash variants (documented placeholder)", () => {
    const reference = estimateTextGenerationCostUsd({
      provider: "gemini",
      model: "gemini-3.5-flash",
      inputTokens: 1000,
      cachedInputTokens: 100,
      outputTokens: 500,
      reasoningTokens: 50,
    });
    for (const model of ["gemini-3.1-flash", "gemini-3-flash", "gemini-2.5-flash"]) {
      const cost = estimateTextGenerationCostUsd({
        provider: "gemini",
        model,
        inputTokens: 1000,
        cachedInputTokens: 100,
        outputTokens: 500,
        reasoningTokens: 50,
      });
      expect(cost).toBe(reference);
    }
  });

  it("includes the medium reasoning-reserve tokens in the projected output cost by default", () => {
    const inputTokens = estimateTokensFromText("system\nuser");
    const withoutReserve = estimateTextGenerationCostUsd({
      provider: "openai",
      model: "gpt-5.5",
      inputTokens,
      outputTokens: 650,
    });
    const projection = projectStructuredTextCost({
      provider: "openai",
      model: "gpt-5.5",
      systemPrompt: "system",
      userPrompt: "user",
      maxOutputTokens: 650,
    });
    const withReserve = estimateTextGenerationCostUsd({
      provider: "openai",
      model: "gpt-5.5",
      inputTokens,
      // medium reserve = 2048, matching GPT5_REASONING_RESERVE_TOKENS.medium /
      // GEMINI_THINKING_RESERVE_TOKENS.medium
      outputTokens: 650 + 2048,
    });

    expect(projection.estimatedCostUsd).toBeGreaterThan(withoutReserve);
    expect(projection.estimatedCostUsd).toBe(withReserve);
  });

  it("scales the projected reserve with the request's reasoning level", () => {
    const inputTokens = estimateTokensFromText("system\nuser");
    const request = { provider: "openai" as const, model: "gpt-5.5", systemPrompt: "system", userPrompt: "user", maxOutputTokens: 650 };
    const none = projectStructuredTextCost({ ...request, reasoningLevel: "none" });
    const low = projectStructuredTextCost({ ...request, reasoningLevel: "low" });
    const high = projectStructuredTextCost({ ...request, reasoningLevel: "high" });

    expect(none.estimatedCostUsd).toBe(
      estimateTextGenerationCostUsd({ provider: "openai", model: "gpt-5.5", inputTokens, outputTokens: 650 }),
    );
    expect(low.estimatedCostUsd).toBeGreaterThan(none.estimatedCostUsd);
    expect(high.estimatedCostUsd).toBeGreaterThan(low.estimatedCostUsd);
  });
});

