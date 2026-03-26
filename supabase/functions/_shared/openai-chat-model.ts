/**
 * Chat-completions model from Supabase Edge secrets only.
 * Client must never send a model id; keep allowlist tight to avoid cost drift.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export const ALLOWED_OPENAI_MODELS = new Set<string>(["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"]);

export function resolveOpenAiChatModel(): string {
  const raw = Deno.env.get("OPENAI_MODEL");
  const candidate = (raw ?? DEFAULT_OPENAI_MODEL).trim();
  if (ALLOWED_OPENAI_MODELS.has(candidate)) return candidate;
  return DEFAULT_OPENAI_MODEL;
}
