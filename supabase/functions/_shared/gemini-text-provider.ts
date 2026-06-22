import {
  estimateTextGenerationCostUsd,
  estimateTokensFromText,
} from "./ai-cost-budget.ts";
import {
  AiProviderError,
  classifyGeminiProviderError,
  classifyThrownProviderError,
} from "./ai-provider-errors.ts";
import { extractCommonJsonSchema } from "./ai-structured-schema.ts";
import {
  type ProviderAttempt,
  type StructuredGenerationRequest,
} from "./ai-text-provider.ts";

type EnvReader = {
  get(name: string): string | undefined | null;
};

export const GEMINI_TEXT_MODEL_FALLBACK = "gemini-3.5-flash";

export const GEMINI_TEXT_MODEL_ALLOWLIST = new Set([
  "gemini-3.5-flash",
  "gemini-3.1-flash",
  "gemini-3-flash",
  "gemini-2.5-flash",
]);

function cleanText(value: string | null | undefined, max = 160): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

export function resolveGeminiTextModel(env: EnvReader, name: "GEMINI_TEXT_MODEL" | "GEMINI_JUDGE_MODEL"): string {
  const configured = cleanText(env.get(name), 120);
  if (!configured) return GEMINI_TEXT_MODEL_FALLBACK;
  if (GEMINI_TEXT_MODEL_ALLOWLIST.has(configured)) return configured;
  throw new AiProviderError({
    provider: "gemini",
    model: configured,
    errorClass: "configuration",
    errorCode: "AI_TEXT_CONFIG_INVALID",
    message: `AI_TEXT_CONFIG_INVALID: unsupported ${name} "${configured}".`,
  });
}

function stripUnsupportedSchemaKeywords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnsupportedSchemaKeywords);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "additionalProperties" || key === "strict" || key === "name") continue;
    out[key] = stripUnsupportedSchemaKeywords(child);
  }
  return out;
}

export function geminiResponseSchema(jsonSchema: unknown): unknown {
  return stripUnsupportedSchemaKeywords(extractCommonJsonSchema(jsonSchema));
}

function geminiThinkingLevel(level: StructuredGenerationRequest<unknown>["reasoningLevel"]): string {
  if (level === "none") return "minimal";
  if (level === "low" || level === "high") return level;
  return "medium";
}

function errorCodeFromGeminiJson(value: unknown): string | null {
  const error = value && typeof value === "object" ? (value as { error?: unknown }).error : null;
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  const code = (error as { code?: unknown }).code;
  if (typeof status === "string") return status.slice(0, 120);
  if (typeof code === "number") return `HTTP_${code}`;
  return null;
}

function errorMessageFromGeminiJson(value: unknown): string | null {
  const error = value && typeof value === "object" ? (value as { error?: unknown }).error : null;
  if (!error || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message.slice(0, 500) : null;
}

function extractGeminiText(json: unknown): string {
  const candidates = (json as { candidates?: unknown[] } | null)?.candidates;
  if (!Array.isArray(candidates)) return "";
  for (const candidate of candidates) {
    const parts = (candidate as { content?: { parts?: unknown[] } } | null)?.content?.parts;
    if (!Array.isArray(parts)) continue;
    const text = parts
      .map((part) => {
        const record = part as Record<string, unknown>;
        return typeof record.text === "string" && record.thought !== true ? record.text : "";
      })
      .filter(Boolean)
      .join("");
    if (text.trim()) return text.trim();
  }
  return "";
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

function geminiUserParts(request: StructuredGenerationRequest<unknown>): unknown[] {
  const parts: unknown[] = [{ text: request.userPrompt }];
  for (const image of request.imageInputs ?? []) {
    const mimeType = image.mimeType.trim();
    if (!mimeType || image.bytes.length === 0) continue;
    parts.push({
      inlineData: {
        mimeType,
        data: base64FromBytes(image.bytes),
      },
    });
  }
  return parts;
}

function geminiUsage(json: unknown): {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
} {
  const usage = (json as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata ?? {};
  const numberValue = (name: string) => {
    const value = usage[name];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  };
  return {
    inputTokens: numberValue("promptTokenCount"),
    cachedInputTokens: numberValue("cachedContentTokenCount"),
    outputTokens: numberValue("candidatesTokenCount"),
    reasoningTokens: numberValue("thoughtsTokenCount"),
  };
}

export async function generateGeminiStructuredJson<TSchema>(params: {
  apiKey?: string | null;
  model: string;
  request: StructuredGenerationRequest<TSchema>;
}): Promise<{ value: unknown; attempt: ProviderAttempt }> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const attemptBase = {
    provider: "gemini" as const,
    model: params.model,
    operation: params.request.operation,
    startedAt,
  };
  const apiKey = (params.apiKey ?? "").trim();
  if (!apiKey) {
    throw new AiProviderError({
      provider: "gemini",
      model: params.model,
      errorClass: "authentication",
      errorCode: "GEMINI_API_KEY_MISSING",
      message: "Gemini API key is not configured.",
    });
  }

  try {
    const promptText = `${params.request.systemPrompt}\n\n${params.request.userPrompt}`;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: params.request.systemPrompt }],
          },
          contents: [
            {
              role: "user",
              parts: geminiUserParts(params.request),
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: geminiResponseSchema(params.request.jsonSchema),
            maxOutputTokens: params.request.maxOutputTokens,
            thinkingConfig: {
              thinkingLevel: geminiThinkingLevel(params.request.reasoningLevel),
            },
          },
        }),
        signal: AbortSignal.timeout(params.request.timeoutMs),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      let errorJson: unknown = null;
      try {
        errorJson = JSON.parse(body);
      } catch {
        /* non-JSON provider error */
      }
      const errorCode = errorCodeFromGeminiJson(errorJson) ?? `HTTP_${res.status}`;
      const providerMessage = errorMessageFromGeminiJson(errorJson) ?? body.slice(0, 500);
      throw new AiProviderError({
        provider: "gemini",
        model: params.model,
        status: res.status,
        errorClass: classifyGeminiProviderError({
          status: res.status,
          code: errorCode,
          message: providerMessage,
        }),
        errorCode,
        message: `Gemini structured generation failed with ${errorCode}.`,
      });
    }

    const json = await res.json();
    const text = extractGeminiText(json);
    if (!text) {
      throw new AiProviderError({
        provider: "gemini",
        model: params.model,
        errorClass: "provider_output_invalid",
        errorCode: "GEMINI_EMPTY_CONTENT",
        message: "Gemini returned no structured content.",
      });
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new AiProviderError({
        provider: "gemini",
        model: params.model,
        errorClass: "provider_output_invalid",
        errorCode: "GEMINI_JSON_PARSE_FAILED",
        message: "Gemini returned invalid JSON.",
      });
    }
    const usage = geminiUsage(json);
    const estimatedCostUsd =
      estimateTextGenerationCostUsd({
        provider: "gemini",
        model: params.model,
        inputTokens: usage.inputTokens || estimateTokensFromText(promptText),
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens || params.request.maxOutputTokens,
        reasoningTokens: usage.reasoningTokens,
      });
    return {
      value,
      attempt: {
        ...attemptBase,
        success: true,
        latencyMs: Date.now() - startedMs,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        reasoningTokens: usage.reasoningTokens,
        outputTokens: usage.outputTokens,
        estimatedCostUsd,
      },
    };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError({
      provider: "gemini",
      model: params.model,
      errorClass: classifyThrownProviderError(error),
      errorCode: "GEMINI_FETCH_FAILED",
      message: String(error).slice(0, 500),
    });
  }
}
