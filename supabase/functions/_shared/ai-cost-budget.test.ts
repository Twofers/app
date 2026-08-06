import { describe, expect, it } from "vitest";

import {
  estimateTextGenerationCostUsd,
  estimateTokensFromText,
  projectStructuredTextCost,
  resolveAiCostBudgetConfig,
} from "./ai-cost-budget.ts";
import { GEMINI_TEXT_MODEL_ALLOWLIST } from "./gemini-text-provider.ts";

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

  it("has a non-zero TEXT_PRICING row for every allowlisted Gemini text model", () => {
    // Guards the invariant documented on GEMINI_TEXT_MODEL_ALLOWLIST: an
    // operator-selectable Gemini model with no pricing row silently estimates $0 —
    // no budget enforcement and no spend visibility, the exact gap that shipped with
    // the since-removed bare gemini-3.1-flash/gemini-3-flash ids (which were also not
    // real Gemini API model ids at all).
    expect(GEMINI_TEXT_MODEL_ALLOWLIST.size).toBeGreaterThan(0);
    for (const model of GEMINI_TEXT_MODEL_ALLOWLIST) {
      const cost = estimateTextGenerationCostUsd({
        provider: "gemini",
        model,
        inputTokens: 1000,
        outputTokens: 500,
      });
      expect(cost).toBeGreaterThan(0);
    }
  });

  it("prices gemini-3.6-flash from its published rate", () => {
    // Source: ai.google.dev/gemini-api/docs/pricing standard tier, cross-checked against
    // ai.google.dev/gemini-api/docs/models (both raw .md.txt variants) — retrieved
    // 2026-08-05. $1.50/1M input, $0.15/1M cached input, $7.50/1M output (thinking
    // tokens billed at the output rate). Replaces the frozen-placeholder assertions for
    // the bare gemini-3.1-flash/gemini-3-flash ids, removed the same day after the
    // catalog check showed neither exists as a real Gemini API model id.
    const cost = estimateTextGenerationCostUsd({
      provider: "gemini",
      model: "gemini-3.6-flash",
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
    });
    // 1M billable input @ $1.50/1M + 1M output @ $7.50/1M
    expect(cost).toBeCloseTo(1.5 + 7.5, 6);
  });

  it("prices gemini-2.5-flash from confirmed published rates, not a copied placeholder", () => {
    // Source: ai.google.dev/gemini-api/docs/pricing standard tier, cross-checked against
    // cloud.google.com/vertex-ai/generative-ai/pricing — retrieved 2026-08-05. $0.30/1M
    // input, $0.03/1M cached input, $2.50/1M output (thinking tokens billed at the output
    // rate), asserted against literal dollar amounts rather than any other row.
    const cost = estimateTextGenerationCostUsd({
      provider: "gemini",
      model: "gemini-2.5-flash",
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
    });
    // 1M billable input @ $0.30/1M + 1M output @ $2.50/1M
    expect(cost).toBeCloseTo(0.3 + 2.5, 6);
  });

  it("prices gemini-3.5-flash from its corrected 2026-08-05 published rate", () => {
    // Source: ai.google.dev/gemini-api/docs/pricing standard tier, cross-checked against
    // cloud.google.com/vertex-ai/generative-ai/pricing and re-confirmed across three
    // separate fetches — retrieved 2026-08-05. $1.50/1M input, $0.15/1M cached input,
    // $9.00/1M output (thinking tokens billed at the output rate). Replaces a prior
    // entry that was stale by ~5x on input / ~3.6x on output.
    const cost = estimateTextGenerationCostUsd({
      provider: "gemini",
      model: "gemini-3.5-flash",
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
    });
    // 1M billable input @ $1.50/1M + 1M output @ $9.00/1M
    expect(cost).toBeCloseTo(1.5 + 9, 6);
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

