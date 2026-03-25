/**
 * Chat-completions model from Supabase Edge secrets only.
 * Client must never send a model id; keep allowlist tight to avoid cost drift.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

export const ALLOWED_OPENAI_MODELS = new Set<string>(["gpt-5.4-mini"]);

export function resolveOpenAiChatModel(): string {
  const raw = Deno.env.get("OPENAI_MODEL");
  const candidate = (raw ?? DEFAULT_OPENAI_MODEL).trim();
  if (ALLOWED_OPENAI_MODELS.has(candidate)) return candidate;
  return DEFAULT_OPENAI_MODEL;
}
