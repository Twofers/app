/** Shared AI rate-limit defaults. Override via Supabase Edge Function secrets. */

export const DEFAULT_MONTHLY_LIMIT = Number(Deno.env.get("AI_MONTHLY_LIMIT") ?? "30");
export const DEFAULT_COOLDOWN_SEC = Number(Deno.env.get("AI_COOLDOWN_SECONDS") ?? "60");
