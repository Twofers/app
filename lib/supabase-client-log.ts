import type { PostgrestError } from "@supabase/supabase-js";

export function logPostgrestError(context: string, error: PostgrestError | { message: string } | null | undefined) {
  if (!error) return;
  const e = error as PostgrestError;
  console.warn(`[supabase] ${context}`, {
    message: e.message,
    code: "code" in e ? e.code : undefined,
    details: "details" in e ? e.details : undefined,
    hint: "hint" in e ? e.hint : undefined,
  });
}
