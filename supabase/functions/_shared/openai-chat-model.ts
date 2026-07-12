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
 * Reasoning-token headroom for the gpt-5 family, keyed by reasoning effort.
 *
 * `max_completion_tokens` caps reasoning tokens + visible output *combined*.
 * Passing only the caller's visible-output budget lets reasoning consume the
 * entire allowance and return empty content (finish_reason "length"), which
 * surfaces as OPENAI_EMPTY_CONTENT. We reserve a separate reasoning allowance on
 * top of the output budget so both fit. The reserve is a ceiling, not a target —
 * it costs nothing unless the model actually spends those reasoning tokens.
 */
const GPT5_REASONING_RESERVE_TOKENS: Record<"none" | "low" | "medium" | "high", number> = {
  none: 0,
  low: 512,
  medium: 2048,
  high: 4096,
};

/**
 * Returns the chat-completions tuning params appropriate for `model`.
 *
 * gpt-5 family rejects `max_tokens` (HTTP 400 — requires `max_completion_tokens`)
 * and rejects any non-default `temperature`. Those models are also reasoning
 * models, so `max_completion_tokens` must cover reasoning *and* the visible
 * output: we take the caller's output budget and add a reasoning reserve sized to
 * the chosen effort (see GPT5_REASONING_RESERVE_TOKENS). Without the reserve a
 * complex call (e.g. the 5-variant ad copy) burns the whole budget on reasoning
 * and returns empty content. gpt-4o-class models keep the classic
 * `max_tokens` + `temperature`.
 */
export function chatCompletionTuning(
  model: string,
  opts: { maxTokens: number; temperature?: number; reasoningEffort?: "none" | "low" | "medium" | "high" },
): Record<string, unknown> {
  if (isGpt5FamilyModel(model)) {
    const effort = opts.reasoningEffort ?? "medium";
    const outputBudget = Math.max(opts.maxTokens, 512);
    const reasoningReserve = GPT5_REASONING_RESERVE_TOKENS[effort] ?? GPT5_REASONING_RESERVE_TOKENS.medium;
    return {
      max_completion_tokens: outputBudget + reasoningReserve,
      reasoning_effort: effort,
    };
  }
  const out: Record<string, unknown> = { max_tokens: opts.maxTokens };
  if (typeof opts.temperature === "number") out.temperature = opts.temperature;
  return out;
}
