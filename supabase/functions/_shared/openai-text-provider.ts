import { calculateAiCost, normalizeAiUsage, openAiRequestIdFromHeaders } from "./ai-costs.ts";
import {
  AiProviderError,
  classifyOpenAiProviderError,
  classifyThrownProviderError,
} from "./ai-provider-errors.ts";
import { chatCompletionTuning } from "./openai-chat-model.ts";
import { extractCommonJsonSchema } from "./ai-structured-schema.ts";
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

export async function generateOpenAiStructuredJson<TSchema>(params: {
  apiKey?: string | null;
  model: string;
  request: StructuredGenerationRequest<TSchema>;
}): Promise<{ value: unknown; attempt: ProviderAttempt }> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const attemptBase = {
    provider: "openai" as const,
    model: params.model,
    operation: params.request.operation,
    startedAt,
  };
  const apiKey = (params.apiKey ?? "").trim();
  if (!apiKey) {
    throw new AiProviderError({
      provider: "openai",
      model: params.model,
      errorClass: "authentication",
      errorCode: "OPENAI_API_KEY_MISSING",
      message: "OpenAI API key is not configured.",
    });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
      }),
      signal: AbortSignal.timeout(params.request.timeoutMs),
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
      const errorMessage = errorMessageFromOpenAiJson(errorJson) ?? body.slice(0, 500);
      throw new AiProviderError({
        provider: "openai",
        model: params.model,
        status: res.status,
        requestId,
        errorClass: classifyOpenAiProviderError({
          status: res.status,
          code: errorCode,
          message: errorMessage,
        }),
        errorCode,
        message: errorMessage,
      });
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "";
    const text = typeof content === "string" ? content.trim() : "";
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
        reasoningTokens: 0,
        outputTokens: usage.output_tokens,
        estimatedCostUsd: cost.estimated_cost_usd,
      },
    };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError({
      provider: "openai",
      model: params.model,
      errorClass: classifyThrownProviderError(error),
      errorCode: "OPENAI_FETCH_FAILED",
      message: String(error).slice(0, 500),
    });
  }
}
