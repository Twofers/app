import { describe, expect, it } from "vitest";

import {
  estimateTextGenerationCostUsd,
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
});

