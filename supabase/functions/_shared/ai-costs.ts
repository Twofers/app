type UsageDetails = Record<string, unknown> | null | undefined;

export type AiUsageInput = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: UsageDetails;
  output_tokens_details?: UsageDetails;
  prompt_tokens_details?: UsageDetails;
};

export type NormalizedAiUsage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  image_input_tokens: number;
  image_output_tokens: number;
  image_text_input_tokens: number;
  audio_seconds: number;
  web_search_calls: number;
};

type ModelPricing = {
  textInputPer1M?: number;
  textCachedInputPer1M?: number;
  textOutputPer1M?: number;
  imageInputPer1M?: number;
  imageCachedInputPer1M?: number;
  imageOutputPer1M?: number;
  imageTextInputPer1M?: number;
  audioPerMinute?: number;
  webSearchPerCall?: number;
};

export type AiCostResult = NormalizedAiUsage & {
  estimated_cost_usd: number;
  warnings: string[];
};

export type AiCostLogInput = {
  businessId?: string | null;
  dealId?: string | null;
  ownerUserId?: string | null;
  requestGroupId: string;
  feature: string;
  provider?: string;
  model: string;
  endpoint: string;
  usage?: AiUsageInput | null;
  audioSeconds?: number;
  webSearchCalls?: number;
  estimatedCostUsd?: number;
  openaiRequestId?: string | null;
  responseId?: string | null;
  success?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
};

const USD_PRECISION = 6;

// Central internal pricing config. Values can be updated in one place when the
// provider pricing page changes; stored ledger rows keep the historical estimate.
export const OPENAI_MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.5": {
    textInputPer1M: 2.5,
    textCachedInputPer1M: 0.25,
    textOutputPer1M: 15,
  },
  "gpt-5.4-mini": {
    textInputPer1M: 0.75,
    textCachedInputPer1M: 0.075,
    textOutputPer1M: 4.5,
  },
  "gpt-5.4-nano": {
    textInputPer1M: 0.2,
    textCachedInputPer1M: 0.02,
    textOutputPer1M: 1.6,
  },
  "gpt-5.4": {
    textInputPer1M: 2.5,
    textCachedInputPer1M: 0.25,
    textOutputPer1M: 15,
  },
  "gpt-4o-mini": {
    textInputPer1M: 0.15,
    textCachedInputPer1M: 0.075,
    textOutputPer1M: 0.6,
  },
  "gpt-4o-search-preview": {
    textInputPer1M: 2.5,
    textCachedInputPer1M: 0,
    textOutputPer1M: 10,
    webSearchPerCall: 0.01,
  },
  "gpt-image-2": {
    textInputPer1M: 5,
    textCachedInputPer1M: 1.25,
    imageInputPer1M: 8,
    imageCachedInputPer1M: 2,
    imageOutputPer1M: 30,
  },
  "gpt-image-1": {
    textInputPer1M: 5,
    textCachedInputPer1M: 1.25,
    imageInputPer1M: 8,
    imageCachedInputPer1M: 2,
    imageOutputPer1M: 30,
  },
  "gpt-image-1-mini": {
    textInputPer1M: 2,
    textCachedInputPer1M: 0.5,
    imageInputPer1M: 3,
    imageCachedInputPer1M: 0.75,
    imageOutputPer1M: 12,
  },
  "gpt-4o-mini-transcribe": {
    audioPerMinute: 0.003,
  },
  "gpt-realtime-whisper": {
    audioPerMinute: 0.017,
  },
  "whisper-1": {
    audioPerMinute: 0.006,
  },
};

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function getDetailsNumber(details: UsageDetails, key: string): number {
  return details && typeof details === "object" ? num((details as Record<string, unknown>)[key]) : 0;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(USD_PRECISION));
}

export function normalizeAiUsage(input: {
  usage?: AiUsageInput | null;
  audioSeconds?: number;
  webSearchCalls?: number;
}): NormalizedAiUsage {
  const usage = input.usage ?? {};
  const inputDetails = usage.input_tokens_details ?? usage.prompt_tokens_details;
  const outputDetails = usage.output_tokens_details;
  const cachedInput = getDetailsNumber(inputDetails, "cached_tokens");
  const imageInput = getDetailsNumber(inputDetails, "image_tokens");
  const imageTextInput = getDetailsNumber(inputDetails, "text_tokens");
  const imageOutput = getDetailsNumber(outputDetails, "image_tokens");

  return {
    input_tokens: num(usage.input_tokens ?? usage.prompt_tokens),
    cached_input_tokens: cachedInput,
    output_tokens: num(usage.output_tokens ?? usage.completion_tokens),
    image_input_tokens: imageInput,
    image_output_tokens: imageOutput,
    image_text_input_tokens: imageTextInput,
    audio_seconds: num(input.audioSeconds),
    web_search_calls: num(input.webSearchCalls),
  };
}

function resolvePricing(model: string): ModelPricing | null {
  const normalized = model.trim();
  if (OPENAI_MODEL_PRICING[normalized]) return OPENAI_MODEL_PRICING[normalized];
  const withoutDate = normalized.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return OPENAI_MODEL_PRICING[withoutDate] ?? null;
}

export function calculateAiCost(input: {
  model: string;
  endpoint: string;
  usage?: AiUsageInput | null;
  audioSeconds?: number;
  webSearchCalls?: number;
}): AiCostResult {
  const normalized = normalizeAiUsage(input);
  const pricing = resolvePricing(input.model);
  const warnings: string[] = [];
  if (!pricing) warnings.push(`UNKNOWN_MODEL:${input.model}`);
  if (!input.usage && normalized.audio_seconds === 0 && normalized.web_search_calls === 0) {
    warnings.push("MISSING_USAGE");
  }

  const p = pricing ?? {};
  const billableTextInput = Math.max(0, normalized.input_tokens - normalized.cached_input_tokens);
  const billableImageInput = Math.max(0, normalized.image_input_tokens - normalized.cached_input_tokens);
  const cost =
    (billableTextInput * (p.textInputPer1M ?? 0)) / 1_000_000 +
    (normalized.cached_input_tokens * (p.textCachedInputPer1M ?? 0)) / 1_000_000 +
    (normalized.output_tokens * (p.textOutputPer1M ?? 0)) / 1_000_000 +
    (billableImageInput * (p.imageInputPer1M ?? 0)) / 1_000_000 +
    (normalized.cached_input_tokens * (p.imageCachedInputPer1M ?? 0)) / 1_000_000 +
    (normalized.image_output_tokens * (p.imageOutputPer1M ?? 0)) / 1_000_000 +
    (normalized.image_text_input_tokens * (p.imageTextInputPer1M ?? p.textInputPer1M ?? 0)) / 1_000_000 +
    (normalized.audio_seconds / 60) * (p.audioPerMinute ?? 0) +
    normalized.web_search_calls * (p.webSearchPerCall ?? 0);

  return {
    ...normalized,
    estimated_cost_usd: roundUsd(cost),
    warnings,
  };
}

export function openAiRequestIdFromHeaders(headers: Headers): string | null {
  return headers.get("x-request-id") ?? headers.get("openai-request-id");
}

export async function logAiCost(admin: any, input: AiCostLogInput): Promise<void> {
  const calculated =
    typeof input.estimatedCostUsd === "number" && Number.isFinite(input.estimatedCostUsd)
      ? {
          ...normalizeAiUsage({
            usage: input.usage,
            audioSeconds: input.audioSeconds,
            webSearchCalls: input.webSearchCalls,
          }),
          estimated_cost_usd: roundUsd(Math.max(0, input.estimatedCostUsd)),
          warnings: [] as string[],
        }
      : calculateAiCost({
          model: input.model,
          endpoint: input.endpoint,
          usage: input.usage,
          audioSeconds: input.audioSeconds,
          webSearchCalls: input.webSearchCalls,
        });
  const warningText = calculated.warnings.length > 0 ? calculated.warnings.join(";") : null;
  const errorMessage = [input.errorMessage ?? "", warningText ?? ""].filter(Boolean).join(" | ") || null;

  const { error } = await admin.from("ai_generation_costs").insert({
    business_id: input.businessId ?? null,
    deal_id: input.dealId ?? null,
    owner_user_id: input.ownerUserId ?? null,
    request_group_id: input.requestGroupId,
    feature: input.feature,
    provider: input.provider ?? "openai",
    model: input.model,
    endpoint: input.endpoint,
    input_tokens: calculated.input_tokens,
    cached_input_tokens: calculated.cached_input_tokens,
    output_tokens: calculated.output_tokens,
    image_input_tokens: calculated.image_input_tokens,
    image_output_tokens: calculated.image_output_tokens,
    image_text_input_tokens: calculated.image_text_input_tokens,
    audio_seconds: calculated.audio_seconds,
    web_search_calls: calculated.web_search_calls,
    estimated_cost_usd: calculated.estimated_cost_usd,
    openai_request_id: input.openaiRequestId ?? null,
    response_id: input.responseId ?? null,
    success: input.success ?? true,
    error_code: input.errorCode ?? null,
    error_message: errorMessage,
  });
  if (error) {
    console.warn(
      JSON.stringify({
        tag: "ai_cost_ledger",
        event: "insert_failed",
        feature: input.feature,
        endpoint: input.endpoint,
        err: String(error.message ?? error).slice(0, 200),
      }),
    );
  }
}
