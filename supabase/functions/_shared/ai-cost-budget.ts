import type { AiProviderName } from "./ai-provider-errors.ts";

type EnvReader = {
  get(name: string): string | undefined | null;
};

type TextPricing = {
  inputPer1M: number;
  cachedInputPer1M?: number;
  outputPer1M: number;
  reasoningPer1M?: number;
};

export type AiCostBudgetConfig = {
  enabled: boolean;
  textSoftLimitUsd: number;
  textHardLimitUsd: number;
  totalGenerationHardLimitUsd: number;
  revisionHardLimitUsd: number;
};

export type AiCostProjection = {
  provider: AiProviderName;
  model: string;
  estimatedCostUsd: number;
  allowed: boolean;
  reason: "ok" | "text_hard_limit" | "total_generation_hard_limit" | "revision_hard_limit";
};

const TEXT_PRICING: Record<string, TextPricing> = {
  "openai:gpt-5.5": { inputPer1M: 2.5, cachedInputPer1M: 0.25, outputPer1M: 15, reasoningPer1M: 15 },
  "openai:gpt-5.4": { inputPer1M: 2.5, cachedInputPer1M: 0.25, outputPer1M: 15, reasoningPer1M: 15 },
  "openai:gpt-5.4-mini": { inputPer1M: 0.75, cachedInputPer1M: 0.075, outputPer1M: 4.5, reasoningPer1M: 4.5 },
  "openai:gpt-5.4-nano": { inputPer1M: 0.2, cachedInputPer1M: 0.02, outputPer1M: 1.6, reasoningPer1M: 1.6 },
  "openai:gpt-4o-mini": { inputPer1M: 0.15, cachedInputPer1M: 0.075, outputPer1M: 0.6 },
  "gemini:gemini-3.5-flash": { inputPer1M: 0.3, cachedInputPer1M: 0.03, outputPer1M: 2.5, reasoningPer1M: 2.5 },
};

function edgeEnv(): EnvReader {
  return Deno.env;
}

function envFlag(env: EnvReader, name: string, fallback = false): boolean {
  const raw = env.get(name);
  if (raw == null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function envNumber(env: EnvReader, name: string, fallback: number): number {
  const raw = Number(env.get(name));
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

function roundUsd(value: number): number {
  return Number(Math.max(0, value).toFixed(6));
}

export function estimateTokensFromText(text: string): number {
  return Math.ceil(Math.max(0, text.length) / 4);
}

export function resolveAiCostBudgetConfig(env: EnvReader = edgeEnv()): AiCostBudgetConfig {
  return {
    enabled: envFlag(env, "AI_V3_COST_BUDGET_ENABLED", false),
    textSoftLimitUsd: envNumber(env, "AI_TEXT_COST_SOFT_LIMIT_USD", 0.2),
    textHardLimitUsd: envNumber(env, "AI_TEXT_COST_HARD_LIMIT_USD", 0.5),
    totalGenerationHardLimitUsd: envNumber(env, "AI_TOTAL_GENERATION_COST_HARD_LIMIT_USD", 1),
    revisionHardLimitUsd: envNumber(env, "AI_REVISION_COST_HARD_LIMIT_USD", 0.35),
  };
}

export function estimateTextGenerationCostUsd(params: {
  provider: AiProviderName;
  model: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
}): number {
  const pricing = TEXT_PRICING[`${params.provider}:${params.model}`];
  if (!pricing) return 0;
  const cached = Math.max(0, params.cachedInputTokens ?? 0);
  const input = Math.max(0, params.inputTokens - cached);
  const output = Math.max(0, params.outputTokens);
  const reasoning = Math.max(0, params.reasoningTokens ?? 0);
  return roundUsd(
    (input * pricing.inputPer1M) / 1_000_000 +
      (cached * (pricing.cachedInputPer1M ?? pricing.inputPer1M)) / 1_000_000 +
      (output * pricing.outputPer1M) / 1_000_000 +
      (reasoning * (pricing.reasoningPer1M ?? pricing.outputPer1M)) / 1_000_000,
  );
}

export function projectStructuredTextCost(params: {
  provider: AiProviderName;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  completedCostUsd?: number;
  isRevision?: boolean;
  budget?: AiCostBudgetConfig;
}): AiCostProjection {
  const inputTokens = estimateTokensFromText(`${params.systemPrompt}\n${params.userPrompt}`);
  const estimatedCostUsd = estimateTextGenerationCostUsd({
    provider: params.provider,
    model: params.model,
    inputTokens,
    outputTokens: params.maxOutputTokens,
  });
  const budget = params.budget ?? {
    enabled: false,
    textSoftLimitUsd: 0.2,
    textHardLimitUsd: 0.5,
    totalGenerationHardLimitUsd: 1,
    revisionHardLimitUsd: 0.35,
  };
  if (!budget.enabled) {
    return { provider: params.provider, model: params.model, estimatedCostUsd, allowed: true, reason: "ok" };
  }
  if (estimatedCostUsd > budget.textHardLimitUsd) {
    return {
      provider: params.provider,
      model: params.model,
      estimatedCostUsd,
      allowed: false,
      reason: "text_hard_limit",
    };
  }
  const completed = Math.max(0, params.completedCostUsd ?? 0);
  if (completed + estimatedCostUsd > budget.totalGenerationHardLimitUsd) {
    return {
      provider: params.provider,
      model: params.model,
      estimatedCostUsd,
      allowed: false,
      reason: "total_generation_hard_limit",
    };
  }
  if (params.isRevision && completed + estimatedCostUsd > budget.revisionHardLimitUsd) {
    return {
      provider: params.provider,
      model: params.model,
      estimatedCostUsd,
      allowed: false,
      reason: "revision_hard_limit",
    };
  }
  return { provider: params.provider, model: params.model, estimatedCostUsd, allowed: true, reason: "ok" };
}

