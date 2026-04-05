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
