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
  // gemini-3.6-flash: CONFIRMED. Source: ai.google.dev/gemini-api/docs/pricing and
  // ai.google.dev/gemini-api/docs/models (raw .md.txt variants) — retrieved 2026-08-05.
  // Current stable flagship flash model. Input $1.50/1M, cached input (context caching)
  // $0.15/1M (hourly storage fee not separately modeled, consistent with the rest of
  // this table), output (incl. thinking) $7.50/1M — thinking/reasoning tokens bill at
  // the output rate per Google's "Output price (including thinking tokens)" framing,
  // hence reasoningPer1M === outputPer1M.
  "gemini:gemini-3.6-flash": { inputPer1M: 1.5, cachedInputPer1M: 0.15, outputPer1M: 7.5, reasoningPer1M: 7.5 },
  // gemini-3.5-flash: CONFIRMED/CORRECTED 2026-08-05. Source: ai.google.dev/gemini-api/docs/pricing
  // (standard tier), cross-checked against cloud.google.com/vertex-ai/generative-ai/pricing and
  // re-confirmed across three separate fetches — retrieved 2026-08-05. Input $1.50/1M, cached
  // input (context caching) $0.15/1M (plus a $1.00/1M-tokens/hour storage fee, not separately
  // modeled here, consistent with how storage fees aren't modeled elsewhere in this table),
  // output (incl. thinking) $9.00/1M — thinking/reasoning tokens are billed at the output rate
  // per Google's own "Output price (including thinking tokens)" framing, hence
  // reasoningPer1M === outputPer1M. Previous entry (inputPer1M: 0.3 / outputPer1M: 2.5) was
  // stale relative to this rate — a ~5x/3.6x undercount on both live budget enforcement and
  // spend telemetry for every real gemini-3.5-flash call. That stale value happened to equal
  // today's real gemini-2.5-flash rate (see below), which is almost certainly how it ended up
  // on this row.
  "gemini:gemini-3.5-flash": { inputPer1M: 1.5, cachedInputPer1M: 0.15, outputPer1M: 9, reasoningPer1M: 9 },
  // gemini-2.5-flash: CONFIRMED. Source: ai.google.dev/gemini-api/docs/pricing (standard
  // tier), cross-checked against cloud.google.com/vertex-ai/generative-ai/pricing —
  // retrieved 2026-08-05. Input $0.30/1M (text/image/video; audio is $1.00/1M, not
  // separately modeled here), cached input $0.03/1M, output (incl. thinking) $2.50/1M —
  // thinking/reasoning tokens are billed at the output rate per Google's own "Output
  // price (including thinking tokens)" framing, hence reasoningPer1M === outputPer1M.
  "gemini:gemini-2.5-flash": { inputPer1M: 0.3, cachedInputPer1M: 0.03, outputPer1M: 2.5, reasoningPer1M: 2.5 },
};

// Mirrors GPT5_REASONING_RESERVE_TOKENS in openai-chat-model.ts and
// GEMINI_THINKING_RESERVE_TOKENS in gemini-text-provider.ts: both providers
// reserve headroom above the caller's visible-output budget for
// reasoning/thinking tokens, and that reserve is real spend the caller will
// be billed for if the model uses it. A local literal union (rather than
// importing AiReasoningLevel from ai-text-provider.ts) avoids a value/type
// import cycle between the two modules.
type ReasoningLevel = "none" | "low" | "medium" | "high";
const REASONING_RESERVE_TOKENS: Record<ReasoningLevel, number> = {
  none: 0,
  low: 512,
  medium: 2048,
  high: 4096,
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
  reasoningLevel?: ReasoningLevel;
  completedCostUsd?: number;
  isRevision?: boolean;
  budget?: AiCostBudgetConfig;
}): AiCostProjection {
  const inputTokens = estimateTokensFromText(`${params.systemPrompt}\n${params.userPrompt}`);
  // The provider call reserves reasoning/thinking headroom on top of
  // maxOutputTokens (see chatCompletionTuning / geminiMaxOutputTokens) and is
  // billed for whatever portion of that reserve it actually spends. The
  // projection previously ignored the reserve entirely, undercounting the
  // worst-case projected cost used for budget gating.
  const reasoningReserve = REASONING_RESERVE_TOKENS[params.reasoningLevel ?? "medium"] ?? REASONING_RESERVE_TOKENS.medium;
  const estimatedCostUsd = estimateTextGenerationCostUsd({
    provider: params.provider,
    model: params.model,
    inputTokens,
    outputTokens: params.maxOutputTokens + reasoningReserve,
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

