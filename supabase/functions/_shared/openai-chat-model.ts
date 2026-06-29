/**
 * Chat-completions model from Supabase Edge secrets only.
 * Client must never send a model id; keep allowlist tight to avoid cost drift.
 *
 * gpt-4o and gpt-4.1 were deprecated Feb 2026 — removed from allowlist.
 * gpt-5.5 is the default production text model.
 * Other allowlisted models remain explicit override options only.
 * Unsupported configured values fail closed instead of silently downgrading.
 */
type EnvReader = {
  get(name: string): string | undefined | null;
};

export const DEFAULT_OPENAI_MODEL = "gpt-5.5";

export const ALLOWED_OPENAI_MODELS = new Set<string>([
  "gpt-4o-mini",
  "gpt-5.5",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.4",
]);

function edgeEnv(): EnvReader {
  return Deno.env;
}

export class OpenAiModelConfigError extends Error {
  code = "AI_TEXT_CONFIG_INVALID";

  constructor(model: string) {
    super(`AI_TEXT_CONFIG_INVALID: unsupported OPENAI_MODEL "${model}".`);
    this.name = "OpenAiModelConfigError";
  }
}

export function resolveOpenAiChatModel(env: EnvReader = edgeEnv()): string {
  const raw = env.get("OPENAI_MODEL");
  const candidate = (raw ?? "").trim() || DEFAULT_OPENAI_MODEL;
  if (ALLOWED_OPENAI_MODELS.has(candidate)) return candidate;
  throw new OpenAiModelConfigError(candidate);
}

export function isGpt5FamilyModel(model: string): boolean {
  return /^gpt-5/i.test(model.trim());
}

/**
 * Returns the chat-completions tuning params appropriate for `model`.
 *
 * gpt-5 family rejects `max_tokens` (HTTP 400 — requires `max_completion_tokens`)
 * and rejects any non-default `temperature`. Those models are also reasoning
 * models: with a tight completion budget the reasoning tokens can consume the
 * whole allowance and leave empty visible output, so callers choose the
 * reasoning effort and we keep a floor under the budget. gpt-4o-class models keep the
 * classic `max_tokens` + `temperature`.
 */
export function chatCompletionTuning(
  model: string,
  opts: { maxTokens: number; temperature?: number; reasoningEffort?: "none" | "low" | "medium" | "high" },
): Record<string, unknown> {
  if (isGpt5FamilyModel(model)) {
    return {
      max_completion_tokens: Math.max(opts.maxTokens, 1024),
      reasoning_effort: opts.reasoningEffort ?? "medium",
    };
  }
  const out: Record<string, unknown> = { max_tokens: opts.maxTokens };
  if (typeof opts.temperature === "number") out.temperature = opts.temperature;
  return out;
}
