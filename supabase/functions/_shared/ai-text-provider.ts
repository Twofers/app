import {
  type AiProviderErrorClass,
  type AiProviderName,
  AiProviderError,
  isImmediateFallbackError,
  isRetryableTransientError,
} from "./ai-provider-errors.ts";
import {
  type AiProviderCapability,
  getCircuitBreakerDecision,
  recordCircuitBreakerFailure,
  recordCircuitBreakerSuccess,
} from "./ai-provider-circuit-breaker.ts";
import {
  projectStructuredTextCost,
  resolveAiCostBudgetConfig,
} from "./ai-cost-budget.ts";
import { generateGeminiStructuredJson, resolveGeminiTextModel } from "./gemini-text-provider.ts";
import { generateOpenAiStructuredJson } from "./openai-text-provider.ts";
import { resolveOpenAiChatModel } from "./openai-chat-model.ts";

export type AiOperation =
  | "creative_candidates"
  | "creative_repair"
  | "copy_revision"
  | "candidate_judge"
  | "image_qa"
  | "merchant_context";

export type AiReasoningLevel = "none" | "low" | "medium" | "high";

export interface StructuredGenerationRequest<TSchema> {
  operation: AiOperation;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: TSchema;
  imageInputs?: Array<{
    bytes: Uint8Array;
    mimeType: string;
  }>;
  maxOutputTokens: number;
  timeoutMs: number;
  generationRunId: string;
  promptVersion: string;
  reasoningLevel?: AiReasoningLevel;
}

export interface ProviderAttempt {
  provider: AiProviderName;
  model: string;
  operation: AiOperation;
  success: boolean;
  startedAt: string;
  latencyMs: number;
  errorClass?: AiProviderErrorClass;
  errorCode?: string;
  requestId?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}

export interface StructuredGenerationResult<T> {
  value: T;
  provider: AiProviderName;
  model: string;
  fallbackUsed: boolean;
  fallbackReason?: AiProviderErrorClass;
  attempts: ProviderAttempt[];
}

type EnvReader = {
  get(name: string): string | undefined | null;
};

type SupabaseLike = {
  from(table: string): any;
};

export type AiTextProviderConfig = {
  routerEnabled: boolean;
  primaryProvider: AiProviderName;
  fallbackEnabled: boolean;
  fallbackProvider: AiProviderName;
  circuitBreakerEnabled: boolean;
  openAiModel: string;
  geminiTextModel: string;
  primaryTimeoutMs: number;
  fallbackTimeoutMs: number;
  transientRetryMax: number;
  retryAfterFullTimeout: boolean;
};

export type AiTextProviderDeps = {
  openAiApiKey?: string | null;
  geminiApiKey?: string | null;
  admin?: SupabaseLike | null;
  env?: EnvReader;
  config?: AiTextProviderConfig;
  completedCostUsd?: number;
  isRevision?: boolean;
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

function parseProvider(value: string | null | undefined, fallback: AiProviderName): AiProviderName {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "gemini" || normalized === "openai" ? normalized : fallback;
}

export function resolveAiTextProviderConfig(env: EnvReader = edgeEnv()): AiTextProviderConfig {
  const routerEnabled = envFlag(env, "AI_V3_PROVIDER_ROUTER_ENABLED", false);
  return {
    routerEnabled,
    primaryProvider: parseProvider(env.get("AI_TEXT_PRIMARY_PROVIDER"), "openai"),
    fallbackEnabled: routerEnabled && envFlag(env, "AI_TEXT_FALLBACK_ENABLED", false),
    fallbackProvider: parseProvider(env.get("AI_TEXT_FALLBACK_PROVIDER"), "gemini"),
    circuitBreakerEnabled: routerEnabled && envFlag(env, "AI_CIRCUIT_BREAKER_ENABLED", false),
    openAiModel: resolveOpenAiChatModel(env),
    geminiTextModel: resolveGeminiTextModel(env, "GEMINI_TEXT_MODEL"),
    primaryTimeoutMs: envNumber(env, "AI_TEXT_PRIMARY_TIMEOUT_MS", 12_000),
    fallbackTimeoutMs: envNumber(env, "AI_TEXT_FALLBACK_TIMEOUT_MS", 14_000),
    transientRetryMax: Math.min(1, envNumber(env, "AI_TRANSIENT_RETRY_MAX", 1)),
    retryAfterFullTimeout: envFlag(env, "AI_RETRY_AFTER_FULL_TIMEOUT", false),
  };
}

export function operationCapability(operation: AiOperation): AiProviderCapability {
  if (operation === "candidate_judge") return "candidate_judging";
  if (operation === "image_qa") return "vision_qa";
  return "text_generation";
}

function makeFailedAttempt(params: {
  request: StructuredGenerationRequest<unknown>;
  provider: AiProviderName;
  model: string;
  startedAt: string;
  startedMs: number;
  error: AiProviderError;
  estimatedCostUsd?: number;
}): ProviderAttempt {
  return {
    provider: params.provider,
    model: params.model,
    operation: params.request.operation,
    success: false,
    startedAt: params.startedAt,
    latencyMs: Date.now() - params.startedMs,
    errorClass: params.error.errorClass,
    errorCode: params.error.errorCode,
    requestId: params.error.requestId ?? undefined,
    estimatedCostUsd: params.estimatedCostUsd,
  };
}

async function runProvider<TSchema>(params: {
  provider: AiProviderName;
  model: string;
  request: StructuredGenerationRequest<TSchema>;
  apiKey?: string | null;
}): Promise<{ value: unknown; attempt: ProviderAttempt }> {
  if (params.provider === "openai") {
    return await generateOpenAiStructuredJson({
      apiKey: params.apiKey,
      model: params.model,
      request: params.request,
    });
  }
  return await generateGeminiStructuredJson({
    apiKey: params.apiKey,
    model: params.model,
    request: params.request,
  });
}

function providerModel(config: AiTextProviderConfig, provider: AiProviderName): string {
  return provider === "openai" ? config.openAiModel : config.geminiTextModel;
}

function providerKey(deps: AiTextProviderDeps, provider: AiProviderName): string | null | undefined {
  return provider === "openai" ? deps.openAiApiKey : deps.geminiApiKey;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function attachAttempts(error: AiProviderError, attempts: ProviderAttempt[]): AiProviderError {
  (error as AiProviderError & { attempts?: ProviderAttempt[] }).attempts = attempts;
  return error;
}

export async function generateStructuredText<TSchema, TValue = unknown>(
  request: StructuredGenerationRequest<TSchema>,
  deps: AiTextProviderDeps,
): Promise<StructuredGenerationResult<TValue>> {
  const env = deps.env ?? edgeEnv();
  const config = deps.config ?? resolveAiTextProviderConfig(env);
  const budget = resolveAiCostBudgetConfig(env);
  const capability = operationCapability(request.operation);
  const primaryProvider = config.primaryProvider;
  const primaryModel = providerModel(config, primaryProvider);
  const attempts: ProviderAttempt[] = [];
  let fallbackReason: AiProviderErrorClass | undefined;

  const runWithBreaker = async (provider: AiProviderName, timeoutMs: number, isFallback: boolean) => {
    const model = providerModel(config, provider);
    const costProjection = projectStructuredTextCost({
      provider,
      model,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      maxOutputTokens: request.maxOutputTokens,
      completedCostUsd: deps.completedCostUsd,
      isRevision: deps.isRevision,
      budget,
    });
    if (isFallback && !costProjection.allowed) {
      throw new AiProviderError({
        provider,
        model,
        errorClass: "configuration",
        errorCode: `AI_COST_${costProjection.reason.toUpperCase()}`,
        message: `AI fallback skipped by cost budget: ${costProjection.reason}.`,
      });
    }

    let breakerFailureCount = 0;
    if (config.circuitBreakerEnabled) {
      const decision = await getCircuitBreakerDecision({
        admin: deps.admin,
        provider,
        capability,
      });
      breakerFailureCount = decision.failureCount;
      if (!decision.allowed) {
        throw new AiProviderError({
          provider,
          model,
          errorClass: "circuit_open",
          errorCode: "AI_PROVIDER_CIRCUIT_OPEN",
          message: `${provider} ${capability} circuit is open.`,
        });
      }
    }

    const providerRequest = { ...request, timeoutMs };
    try {
      const result = await runProvider({
        provider,
        model,
        request: providerRequest,
        apiKey: providerKey(deps, provider),
      });
      attempts.push({ ...result.attempt, estimatedCostUsd: result.attempt.estimatedCostUsd ?? costProjection.estimatedCostUsd });
      if (config.circuitBreakerEnabled) {
        await recordCircuitBreakerSuccess({ admin: deps.admin, provider, capability });
      }
      return result.value;
    } catch (error) {
      const providerError = error instanceof AiProviderError
        ? error
        : new AiProviderError({
            provider,
            model,
            errorClass: "unknown",
            message: String(error),
          });
      const startedAt = new Date().toISOString();
      attempts.push(
        makeFailedAttempt({
          request: providerRequest,
          provider,
          model,
          startedAt,
          startedMs: Date.now(),
          error: providerError,
          estimatedCostUsd: 0,
        }),
      );
      if (config.circuitBreakerEnabled) {
        await recordCircuitBreakerFailure({
          admin: deps.admin,
          provider,
          capability,
          errorClass: providerError.errorClass,
          previousFailureCount: breakerFailureCount,
        });
      }
      throw providerError;
    }
  };

  try {
    let primaryError: AiProviderError | null = null;
    const maxAttempts = Math.max(0, config.transientRetryMax) + 1;
    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      try {
        const value = await runWithBreaker(primaryProvider, config.primaryTimeoutMs, false);
        return {
          value: value as TValue,
          provider: primaryProvider,
          model: primaryModel,
          fallbackUsed: false,
          attempts,
        };
      } catch (error) {
        primaryError = error instanceof AiProviderError
          ? error
          : new AiProviderError({
              provider: primaryProvider,
              model: primaryModel,
              errorClass: "unknown",
              message: String(error),
            });
        if (
          attemptIndex + 1 < maxAttempts &&
          isRetryableTransientError(primaryError.errorClass) &&
          (primaryError.errorClass !== "timeout" || config.retryAfterFullTimeout)
        ) {
          await delay(150 + Math.floor(Math.random() * 125));
          continue;
        }
        break;
      }
    }

    if (
      primaryError &&
      config.fallbackEnabled &&
      config.fallbackProvider !== primaryProvider &&
      (isImmediateFallbackError(primaryError.errorClass) || isRetryableTransientError(primaryError.errorClass))
    ) {
      fallbackReason = primaryError.errorClass;
      const fallbackProvider = config.fallbackProvider;
      const fallbackModel = providerModel(config, fallbackProvider);
      const value = await runWithBreaker(fallbackProvider, config.fallbackTimeoutMs, true);
      return {
        value: value as TValue,
        provider: fallbackProvider,
        model: fallbackModel,
        fallbackUsed: true,
        fallbackReason,
        attempts,
      };
    }

    if (primaryError) throw attachAttempts(primaryError, attempts);
    throw new Error("AI provider failed.");
  } catch (error) {
    if (error instanceof AiProviderError) throw attachAttempts(error, attempts);
    throw attachAttempts(new AiProviderError({
      provider: primaryProvider,
      model: primaryModel,
      errorClass: "unknown",
      message: String(error),
    }), attempts);
  }
}
