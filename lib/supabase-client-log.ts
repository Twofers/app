import type { PostgrestError } from "@supabase/supabase-js";
import { devWarn } from "@/lib/dev-log";

export function logPostgrestError(context: string, error: PostgrestError | { message: string } | null | undefined) {
  if (!error) return;
  const e = error as PostgrestError;
  devWarn(`[supabase] ${context}`, {
    message: e.message,
    code: "code" in e ? e.code : undefined,
    details: "details" in e ? e.details : undefined,
    hint: "hint" in e ? e.hint : undefined,
  });
}
