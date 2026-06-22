export type AiProviderName = "openai" | "gemini";

export type AiProviderErrorClass =
  | "quota_exhausted"
  | "insufficient_credits"
  | "spend_limit_reached"
  | "billing_hard_limit"
  | "model_unavailable"
  | "model_not_found"
  | "authentication"
  | "transient_rate_limit"
  | "server_error"
  | "timeout"
  | "network"
  | "provider_output_invalid"
  | "configuration"
  | "circuit_open"
  | "unknown";

export class AiProviderError extends Error {
  provider: AiProviderName;
  model: string;
  errorClass: AiProviderErrorClass;
  errorCode?: string;
  status?: number;
  requestId?: string | null;

  constructor(params: {
    provider: AiProviderName;
    model: string;
    errorClass: AiProviderErrorClass;
    message: string;
    errorCode?: string;
    status?: number;
    requestId?: string | null;
  }) {
    super(params.message);
    this.name = "AiProviderError";
    this.provider = params.provider;
    this.model = params.model;
    this.errorClass = params.errorClass;
    this.errorCode = params.errorCode;
    this.status = params.status;
    this.requestId = params.requestId ?? null;
  }
}

function textIncludes(text: string, patterns: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern));
}

export function classifyOpenAiProviderError(params: {
  status?: number;
  code?: string | null;
  message?: string | null;
}): AiProviderErrorClass {
  const status = params.status;
  const code = (params.code ?? "").toLowerCase();
  const message = (params.message ?? "").toLowerCase();
  const text = `${code} ${message}`;

  if (status === 401 || code.includes("invalid_api_key")) return "authentication";
  if (status === 403 && textIncludes(text, ["billing", "credit", "quota", "spend", "insufficient"])) {
    return "billing_hard_limit";
  }
  if (status === 404 || code.includes("model_not_found")) return "model_not_found";
  if (textIncludes(text, ["insufficient_quota", "quota exceeded", "quota_exceeded"])) return "quota_exhausted";
  if (textIncludes(text, ["insufficient credits", "insufficient_credit", "credit balance"])) {
    return "insufficient_credits";
  }
  if (textIncludes(text, ["spend limit", "monthly budget", "billing hard limit"])) return "spend_limit_reached";
  if (textIncludes(text, ["model unavailable", "temporarily unavailable", "capacity"])) return "model_unavailable";
  if (status === 429) return "transient_rate_limit";
  if (status && status >= 500 && status <= 504) return "server_error";
  return "unknown";
}

export function classifyGeminiProviderError(params: {
  status?: number;
  code?: string | null;
  message?: string | null;
}): AiProviderErrorClass {
  const status = params.status;
  const code = (params.code ?? "").toLowerCase();
  const message = (params.message ?? "").toLowerCase();
  const text = `${code} ${message}`;

  if (status === 401 || status === 403 || textIncludes(text, ["api key not valid", "permission denied"])) {
    return "authentication";
  }
  if (status === 404 || textIncludes(text, ["model not found", "not found"])) return "model_not_found";
  if (status === 429 && textIncludes(text, ["quota", "billing"])) return "quota_exhausted";
  if (status === 429) return "transient_rate_limit";
  if (status && status >= 500 && status <= 504) return "server_error";
  return "unknown";
}

export function classifyThrownProviderError(error: unknown): AiProviderErrorClass {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  const text = String(error).toLowerCase();
  if (text.includes("timeout") || text.includes("timed out")) return "timeout";
  if (
    text.includes("network") ||
    text.includes("connection") ||
    text.includes("fetch failed") ||
    text.includes("econnreset")
  ) {
    return "network";
  }
  return "unknown";
}

export function isImmediateFallbackError(errorClass: AiProviderErrorClass): boolean {
  return (
    errorClass === "quota_exhausted" ||
    errorClass === "insufficient_credits" ||
    errorClass === "spend_limit_reached" ||
    errorClass === "billing_hard_limit" ||
    errorClass === "model_unavailable" ||
    errorClass === "model_not_found" ||
    errorClass === "authentication" ||
    errorClass === "configuration" ||
    errorClass === "circuit_open" ||
    errorClass === "timeout"
  );
}

export function isRetryableTransientError(errorClass: AiProviderErrorClass): boolean {
  return (
    errorClass === "transient_rate_limit" ||
    errorClass === "server_error" ||
    errorClass === "network"
  );
}
