import { supabase } from "./supabase";
import { EDGE_FUNCTION_TIMEOUT_MS, getErrorCode, parseFunctionError, throwInvokeError } from "./functions";

export type CanPublishResult = {
  canPublish?: boolean;
  can_publish?: boolean;
  reason?: string;
  reason_code?: string;
  limits?: unknown;
};

// Mirrors readInvokeErrorBody in lib/functions.ts: edge functions return
// `{ error, error_code }` JSON on non-2xx responses, but supabase-js wraps
// that in a FunctionsHttpError whose body isn't pre-read.
async function readInvokeErrorBody(error: unknown): Promise<{ message?: string; code?: string }> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (typeof Response !== "undefined" && ctx instanceof Response) {
    try {
      const data = await ctx.clone().json();
      if (data && typeof data === "object") {
        const o = data as { error?: unknown; error_code?: unknown };
        return {
          message: typeof o.error === "string" ? o.error : undefined,
          code: typeof o.error_code === "string" ? o.error_code : undefined,
        };
      }
    } catch {
      /* body wasn't JSON, or was already consumed — fall back to sync parsing */
    }
  }
  return {};
}

/** Explicit owner action: records acceptance of the current business terms and rechecks can_business_publish(). */
export async function acceptBusinessTerms(businessId: string): Promise<{ ok: boolean; publish: CanPublishResult | null }> {
  const { data, error } = await supabase.functions.invoke("accept-business-terms", {
    body: { business_id: businessId },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) {
    const fromBody = await readInvokeErrorBody(error);
    throwInvokeError(fromBody.message ?? parseFunctionError(error), fromBody.code ?? getErrorCode(error));
  }
  if (data && typeof data === "object" && "error" in data) {
    const response = data as { error?: string; error_code?: string };
    throwInvokeError(response.error ?? "Could not record terms acceptance.", response.error_code);
  }
  return data as { ok: boolean; publish: CanPublishResult | null };
}
