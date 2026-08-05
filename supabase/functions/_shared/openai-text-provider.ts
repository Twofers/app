import { calculateAiCost, normalizeAiUsage, openAiRequestIdFromHeaders } from "./ai-costs.ts";
import {
  AiProviderError,
  classifyOpenAiProviderError,
  classifyThrownProviderError,
} from "./ai-provider-errors.ts";
import { chatCompletionTuning, isGpt5FamilyModel } from "./openai-chat-model.ts";
import { extractCommonJsonSchema } from "./ai-structured-schema.ts";
import {
  fetchOpenAiWithFallback,
  resolveOpenAiKeyCandidates,
  type OpenAiEnvReader,
} from "./openai-fetch.ts";
import {
  type ProviderAttempt,
  type StructuredGenerationRequest,
} from "./ai-text-provider.ts";

function errorCodeFromOpenAiJson(value: unknown): string | null {
  const err = value && typeof value === "object" ? (value as { error?: unknown }).error : null;
  if (!err || typeof err !== "object") return null;
  const code = (err as { code?: unknown; type?: unknown }).code ?? (err as { type?: unknown }).type;
  return typeof code === "string" ? code.slice(0, 120) : null;
}

function errorMessageFromOpenAiJson(value: unknown): string | null {
  const err = value && typeof value === "object" ? (value as { error?: unknown }).error : null;
  if (!err || typeof err !== "object") return null;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" ? message.slice(0, 500) : null;
}

function openAiJsonSchema(jsonSchema: unknown): Record<string, unknown> {
  const record = jsonSchema && typeof jsonSchema === "object" ? jsonSchema as Record<string, unknown> : {};
  if (record.name && record.schema) return record;
  return {
    name: "structured_generation",
    strict: true,
    schema: extractCommonJsonSchema(jsonSchema),
  };
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.slice(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function openAiUserContent(request: StructuredGenerationRequest<unknown>): unknown {
  const images = (request.imageInputs ?? []).filter((image) => image.bytes.length > 0 && image.mimeType.trim());
  if (images.length === 0) return request.userPrompt;
  return [
    { type: "text", text: request.userPrompt },
    ...images.map((image) => ({
      type: "image_url",
      image_url: {
        url: `data:${image.mimeType.trim()};base64,${base64FromBytes(image.bytes)}`,
      },
    })),
  ];
}

// NOTE: this deliberately mirrors the exact `params.request.*` / `params.model`
// spelling of the original inline chat.completions body (a source-guard test in
// ai-generate-ad-variants-vision-qa-source.test.ts asserts on
// `json_schema:\s*openAiJsonSchema\(params\.request\.jsonSchema\)` literally) —
// do not rename `params` or flatten it to `model`/`request` args.
function buildChatCompletionsBody(params: {
  model: string;
  request: StructuredGenerationRequest<unknown>;
}): Record<string, unknown> {
  return {
    model: params.model,
    response_format: {
      type: "json_schema",
      json_schema: openAiJsonSchema(params.request.jsonSchema),
    },
    messages: [
      { role: "system", content: params.request.systemPrompt },
      { role: "user", content: openAiUserContent(params.request) },
    ],
    ...chatCompletionTuning(params.model, {
      maxTokens: params.request.maxOutputTokens,
      reasoningEffort: params.request.reasoningLevel ?? "medium",
    }),
  };
}

/**
 * Resolves whether gpt-5-family structured calls should use the OpenAI
 * Responses API (/v1/responses) instead of /v1/chat/completions. Defaults to
 * false (current behavior, byte-identical) when the env var is unset. Reads
 * AI_OPENAI_RESPONSES_API_ENABLED from Deno.env in production; `envOverride`
 * lets tests (which run under node/vitest with no Deno global) inject a fake
 * env reader without threading anything through ai-text-provider.ts, which is
 * out of scope for this change.
 */
function edgeEnvOrNull(): OpenAiEnvReader | null {
  try {
    return typeof Deno !== "undefined" ? Deno.env : null;
  } catch {
    return null;
  }
}

function responsesApiEnabled(envOverride?: OpenAiEnvReader | null): boolean {
  const env = envOverride ?? edgeEnvOrNull();
  const raw = env?.get("AI_OPENAI_RESPONSES_API_ENABLED");
  if (raw == null) return false;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

// ---- Responses API (/v1/responses) request/response shaping ----
// Mirrors the in-repo precedent in ai-extract-menu/index.ts (status !==
// "completed", incomplete_details, walking output[] for message content) but
// is generic over any structured generation request rather than the
// menu-scan-specific shape there. ai-extract-menu/index.ts is not modified by
// this change.

function openAiResponsesInputContent(request: StructuredGenerationRequest<unknown>): unknown[] {
  const images = (request.imageInputs ?? []).filter((image) => image.bytes.length > 0 && image.mimeType.trim());
  const parts: unknown[] = [{ type: "input_text", text: request.userPrompt }];
  for (const image of images) {
    parts.push({
      type: "input_image",
      image_url: `data:${image.mimeType.trim()};base64,${base64FromBytes(image.bytes)}`,
      detail: "high",
    });
  }
  return parts;
}

function openAiResponsesTextFormat(jsonSchema: unknown): Record<string, unknown> {
  const built = openAiJsonSchema(jsonSchema) as { name?: unknown; schema?: unknown; strict?: unknown };
  return {
    type: "json_schema",
    name: typeof built.name === "string" ? built.name : "structured_generation",
    schema: built.schema ?? extractCommonJsonSchema(jsonSchema),
    strict: typeof built.strict === "boolean" ? built.strict : true,
  };
}

function buildResponsesApiBody(model: string, request: StructuredGenerationRequest<unknown>): Record<string, unknown> {
  // Reuses chatCompletionTuning purely to compute the output-token budget
  // (visible output + reasoning reserve) and the reasoning-effort value from
  // a single source of truth shared with the chat.completions path — the
  // field names below (max_output_tokens / reasoning.effort) are Responses
  // API-specific, but the budget math must stay identical.
  const tuning = chatCompletionTuning(model, {
    maxTokens: request.maxOutputTokens,
    reasoningEffort: request.reasoningLevel ?? "medium",
  });
  return {
    model,
    instructions: request.systemPrompt,
    input: [
      {
        role: "user",
        content: openAiResponsesInputContent(request),
      },
    ],
    text: { format: openAiResponsesTextFormat(request.jsonSchema) },
    max_output_tokens: tuning.max_completion_tokens,
    reasoning: { effort: tuning.reasoning_effort },
  };
}

function extractResponsesOutputText(json: unknown): string {
  const outputText = (json as { output_text?: unknown })?.output_text;
  if (typeof outputText === "string" && outputText.trim()) return outputText.trim();
  const out = (json as { output?: unknown[] })?.output;
  if (!Array.isArray(out)) return "";
  for (const item of out) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { type?: string; content?: unknown[] };
    if (entry.type !== "message") continue;
    const parts = entry.content;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const typed = part as { type?: string; text?: string };
      if (typed.type === "output_text" && typeof typed.text === "string" && typed.text.trim()) {
        return typed.text.trim();
      }
    }
  }
  return "";
}

export async function generateOpenAiStructuredJson<TSchema>(params: {
  apiKey?: string | null;
  model: string;
  request: StructuredGenerationRequest<TSchema>;
  // Optional env override, DI-only (mirrors openai-fetch.ts's `env` override
  // pattern), used solely to resolve AI_OPENAI_RESPONSES_API_ENABLED.
  // Production (ai-text-provider.ts's runProvider) never passes this, so it
  // falls back to Deno.env; tests can inject a fake reader to exercise the
  // flag-on path without a Deno global.
  env?: OpenAiEnvReader | null;
}): Promise<{ value: unknown; attempt: ProviderAttempt }> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const attemptBase = {
    provider: "openai" as const,
    model: params.model,
    operation: params.request.operation,
    startedAt,
  };
  // Key selection (prepaid -> existing) and fallback are centralized in
  // ./openai-fetch.ts. The injected `apiKey` is treated as the existing key so
  // dependency-injection tests keep working; prepaid is read from env in production.
  const keyCandidates = resolveOpenAiKeyCandidates({ existingKeyOverride: params.apiKey });
  if (keyCandidates.length === 0) {
    throw new AiProviderError({
      provider: "openai",
      model: params.model,
      errorClass: "authentication",
      errorCode: "OPENAI_API_KEY_MISSING",
      message: "OpenAI API key is not configured.",
    });
  }

  // Opt-in migration to the OpenAI Responses API for gpt-5-family structured
  // calls only (see openai-chat-model.ts's isGpt5FamilyModel). Any other
  // model, or this flag unset/false, takes the exact current chat.completions
  // path below — byte-identical request/response handling.
  const useResponsesApi = isGpt5FamilyModel(params.model) && responsesApiEnabled(params.env);

  try {
    const { response: res } = await fetchOpenAiWithFallback({
      url: useResponsesApi ? "https://api.openai.com/v1/responses" : "https://api.openai.com/v1/chat/completions",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          useResponsesApi
            ? buildResponsesApiBody(params.model, params.request)
            : buildChatCompletionsBody({ model: params.model, request: params.request }),
        ),
        signal: AbortSignal.timeout(params.request.timeoutMs),
      },
      candidates: keyCandidates,
      logTag: "ai_text_provider",
    });
    const requestId = openAiRequestIdFromHeaders(res.headers);
    if (!res.ok) {
      const body = await res.text();
      let errorJson: unknown = null;
      try {
        errorJson = JSON.parse(body);
      } catch {
        /* non-JSON provider error */
      }
      const errorCode = errorCodeFromOpenAiJson(errorJson) ?? `HTTP_${res.status}`;
      const providerMessage = errorMessageFromOpenAiJson(errorJson) ?? body.slice(0, 500);
      throw new AiProviderError({
        provider: "openai",
        model: params.model,
        status: res.status,
        requestId,
        errorClass: classifyOpenAiProviderError({
          status: res.status,
          code: errorCode,
          message: providerMessage,
        }),
        errorCode,
        message: `OpenAI structured generation failed with ${errorCode}.`,
      });
    }

    const json = await res.json();

    if (useResponsesApi) {
      const status = (json as { status?: string })?.status;
      const incompleteReason = (json as { incomplete_details?: { reason?: string } })?.incomplete_details?.reason;
      if (status === "incomplete" && incompleteReason === "max_output_tokens") {
        throw new AiProviderError({
          provider: "openai",
          model: params.model,
          requestId,
          errorClass: "provider_output_invalid",
          errorCode: "OPENAI_RESPONSES_TRUNCATED",
          message: "OpenAI Responses API returned incomplete output (max_output_tokens budget exhausted).",
        });
      }

      const text = extractResponsesOutputText(json);
      if (!text) {
        throw new AiProviderError({
          provider: "openai",
          model: params.model,
          requestId,
          errorClass: "provider_output_invalid",
          errorCode: "OPENAI_EMPTY_CONTENT",
          message: "OpenAI returned no structured content.",
        });
      }
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new AiProviderError({
          provider: "openai",
          model: params.model,
          requestId,
          errorClass: "provider_output_invalid",
          errorCode: "OPENAI_JSON_PARSE_FAILED",
          message: "OpenAI returned invalid JSON.",
        });
      }
      const usage = normalizeAiUsage({ usage: json?.usage ?? null });
      const cost = calculateAiCost({
        model: params.model,
        endpoint: "responses",
        usage: json?.usage ?? null,
      });
      return {
        value,
        attempt: {
          ...attemptBase,
          success: true,
          latencyMs: Date.now() - startedMs,
          requestId: requestId ?? undefined,
          inputTokens: usage.input_tokens,
          cachedInputTokens: usage.cached_input_tokens,
          reasoningTokens: usage.reasoning_tokens,
          outputTokens: usage.output_tokens,
          estimatedCostUsd: cost.estimated_cost_usd,
        },
      };
    }

    const content = json?.choices?.[0]?.message?.content ?? "";
    const text = typeof content === "string" ? content.trim() : "";
    // finish_reason "length" means the model exhausted max_completion_tokens
    // before emitting (or finishing) structured content — distinguishable from
    // a model returning genuinely garbled/empty output. Mirrors the Gemini
    // provider's MAX_TOKENS handling (geminiFinishReason). errorClass stays
    // "provider_output_invalid" in both cases so downstream retry/fallback
    // classification is unaffected; only the message/errorCode differ.
    const truncated = json?.choices?.[0]?.finish_reason === "length";
    if (!text) {
      throw new AiProviderError({
        provider: "openai",
        model: params.model,
        requestId,
        errorClass: "provider_output_invalid",
        errorCode: truncated ? "OPENAI_EMPTY_CONTENT_TRUNCATED" : "OPENAI_EMPTY_CONTENT",
        message: truncated
          ? "OpenAI returned no structured content (finish_reason=length; output token budget exhausted)."
          : "OpenAI returned no structured content.",
      });
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new AiProviderError({
        provider: "openai",
        model: params.model,
        requestId,
        errorClass: "provider_output_invalid",
        errorCode: truncated ? "OPENAI_JSON_PARSE_FAILED_TRUNCATED" : "OPENAI_JSON_PARSE_FAILED",
        message: truncated
          ? "OpenAI returned truncated JSON (finish_reason=length; output token budget exhausted)."
          : "OpenAI returned invalid JSON.",
      });
    }
    const usage = normalizeAiUsage({ usage: json?.usage ?? null });
    const cost = calculateAiCost({
      model: params.model,
      endpoint: "chat.completions",
      usage: json?.usage ?? null,
    });
    return {
      value,
      attempt: {
        ...attemptBase,
        success: true,
        latencyMs: Date.now() - startedMs,
        requestId: requestId ?? undefined,
        inputTokens: usage.input_tokens,
        cachedInputTokens: usage.cached_input_tokens,
        reasoningTokens: usage.reasoning_tokens,
        outputTokens: usage.output_tokens,
        estimatedCostUsd: cost.estimated_cost_usd,
      },
    };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    const errorClass = classifyThrownProviderError(error);
    throw new AiProviderError({
      provider: "openai",
      model: params.model,
      errorClass,
      errorCode: "OPENAI_FETCH_FAILED",
      message: `OpenAI structured generation failed before a usable response was returned (${errorClass}).`,
    });
  }
}
