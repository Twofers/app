/**
 * Chat-completions model from Supabase Edge secrets only.
 * Client must never send a model id; keep allowlist tight to avoid cost drift.
 *
 * gpt-4o and gpt-4.1 were deprecated Feb 2026 — removed from allowlist.
 * gpt-4o-mini remains available (no sunset date as of Apr 2026).
 * gpt-5.4-mini / gpt-5.4-nano are the current recommended replacements.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export const ALLOWED_OPENAI_MODELS = new Set<string>([
  "gpt-4o-mini",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.4",
]);

export function resolveOpenAiChatModel(): string {
  const raw = Deno.env.get("OPENAI_MODEL");
  const candidate = (raw ?? DEFAULT_OPENAI_MODEL).trim();
  if (ALLOWED_OPENAI_MODELS.has(candidate)) return candidate;
  return DEFAULT_OPENAI_MODEL;
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
 * whole allowance and leave empty visible output, so we request minimal
 * reasoning and keep a floor under the budget. gpt-4o-class models keep the
 * classic `max_tokens` + `temperature`.
 */
export function chatCompletionTuning(
  model: string,
  opts: { maxTokens: number; temperature?: number },
): Record<string, unknown> {
  if (isGpt5FamilyModel(model)) {
    return {
      max_completion_tokens: Math.max(opts.maxTokens, 1024),
      // gpt-5.4 rejects "minimal"; "none" = no reasoning (fastest/cheapest, and
      // matches the original non-reasoning gpt-4o-mini behavior for these tasks).
      reasoning_effort: "none",
    };
  }
  const out: Record<string, unknown> = { max_tokens: opts.maxTokens };
  if (typeof opts.temperature === "number") out.temperature = opts.temperature;
  return out;
}
