import { FunctionsFetchError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { devWarn } from "@/lib/dev-log";

/** Default Edge Function HTTP timeout; forwarded to `supabase.functions.invoke({ timeout })`. */
export const EDGE_FUNCTION_TIMEOUT_MS = 45_000;
export const EDGE_FUNCTION_TIMEOUT_AI_MS = 120_000;
export const EDGE_FUNCTION_TIMEOUT_QUICK_MS = 25_000;

type SupabaseFunctionInvokeError = {
  message?: string;
  context?: {
    body?: unknown;
    message?: string;
  };
};

function isSupabaseFunctionInvokeError(e: unknown): e is SupabaseFunctionInvokeError {
  return typeof e === "object" && e !== null;
}

export function parseFunctionError(error: unknown): string {
  if (error instanceof FunctionsFetchError) {
    const ctx = error.context as { name?: string; message?: string } | undefined;
    const name = ctx?.name ?? "";
    const msg = (ctx?.message ?? "").toLowerCase();
    if (name === "AbortError" || msg.includes("abort")) {
      return "Request timed out. Check your connection and try again.";
    }
  }

  // Supabase functions.invoke error structure:
  // - error.message: response body as string (often JSON)
  // - error.context: additional context
  // - error.context?.body: parsed response body (if available)

  if (!isSupabaseFunctionInvokeError(error)) {
    return String(error);
  }

  let errorMessage = "Unknown error";

  // Try error.context.body first (parsed JSON)
  const body = error.context?.body;
  if (body && typeof body === "object" && body !== null && "error" in body) {
    const errField = (body as { error?: unknown }).error;
    if (typeof errField === "string") {
      return errField;
    }
  }

  // Try error.message (might be JSON string)
  if (error.message) {
    errorMessage = error.message;
    
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(errorMessage);
      if (parsed.error) {
        return parsed.error;
      }
    } catch {
      // Not JSON, use message as-is
    }
  }
  
  // Fallback to error message or context
  const ctxMsg = error.context?.message;
  return errorMessage || (typeof ctxMsg === "string" ? ctxMsg : "") || "Unknown error";
}

export type ClaimDealExtraBody = {
  acquisition_source?: string;
  zip_at_claim?: string | null;
  location_source_at_claim?: "gps" | "zip" | "unknown" | null;
  app_version_at_claim?: string | null;
  device_platform_at_claim?: string | null;
  session_id_at_claim?: string | null;
};

export async function claimDeal(dealId: string, extra?: ClaimDealExtraBody) {
  const { data, error } = await supabase.functions.invoke("claim-deal", {
    body: { deal_id: dealId, ...extra },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });

  if (error) {
    throw new Error(parseFunctionError(error));
  }

  // Check if data itself contains an error (shouldn't happen with proper function, but be safe)
  if (data && typeof data === "object" && "error" in data) {
    throw new Error((data as { error?: string }).error || "Server returned an error");
  }

  if (!data || !data.token) {
    throw new Error("No token returned from server");
  }

  return data as {
    claim_id?: string;
    token: string;
    expires_at: string;
    short_code?: string | null;
  };
}

export async function redeemToken(body: { token?: string; short_code?: string }) {
  const { data, error } = await supabase.functions.invoke("redeem-token", {
    body,
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });

  if (error) {
    throw new Error(parseFunctionError(error));
  }

  // Check if data itself contains an error
  if (data && typeof data === "object" && "error" in data) {
    throw new Error((data as { error?: string }).error || "Server returned an error");
  }

  if (!data || !data.ok) {
    throw new Error("Token redemption failed");
  }

  return data as {
    ok: boolean;
    deal_title?: string;
    redeemed_at: string;
  };
}

export async function beginVisualRedeem(claimId: string) {
  const { data, error } = await supabase.functions.invoke("begin-visual-redeem", {
    body: { claim_id: claimId },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) throw new Error(parseFunctionError(error));
  if (data && typeof data === "object" && "error" in data) {
    throw new Error((data as { error?: string }).error ?? "Server returned an error");
  }
  return data as {
    ok: boolean;
    resumed?: boolean;
    server_now: string;
    redeem_started_at: string;
    min_complete_at: string;
  };
}

export async function completeVisualRedeem(claimId: string) {
  const { data, error } = await supabase.functions.invoke("complete-visual-redeem", {
    body: { claim_id: claimId },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) throw new Error(parseFunctionError(error));
  if (data && typeof data === "object" && "error" in data) {
    throw new Error((data as { error?: string }).error ?? "Server returned an error");
  }
  return data as {
    ok: boolean;
    already_redeemed?: boolean;
    redeemed_at: string;
    deal_title?: string | null;
    deal_id?: string;
  };
}

export async function cancelVisualRedeem(claimId: string) {
  const { data, error } = await supabase.functions.invoke("cancel-visual-redeem", {
    body: { claim_id: claimId },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) throw new Error(parseFunctionError(error));
  if (data && typeof data === "object" && "error" in data) {
    throw new Error((data as { error?: string }).error ?? "Server returned an error");
  }
  return data as { ok: boolean };
}

/** Best-effort: server finalizes visual redemptions stuck past TTL. */
export async function finalizeStaleRedeems(): Promise<void> {
  try {
    await supabase.functions.invoke("finalize-stale-redeems", {
      body: {},
      timeout: EDGE_FUNCTION_TIMEOUT_QUICK_MS,
    });
  } catch (err) {
    devWarn("[finalizeStaleRedeems] failed (non-fatal):", err);
  }
}

/** Returned by `delete-user-account` when the user owns a business row or ownership could not be verified. */
export const DELETE_ACCOUNT_BLOCKED_BUSINESS_OWNER = "BUSINESS_OWNER_DELETE_BLOCKED";

function throwIfDeleteBlockedBody(body: unknown): void {
  if (!body || typeof body !== "object") return;
  const o = body as { code?: string; error?: string };
  if (o.code !== DELETE_ACCOUNT_BLOCKED_BUSINESS_OWNER) return;
  const err = new Error(typeof o.error === "string" ? o.error : "Account deletion blocked");
  (err as Error & { code: string }).code = DELETE_ACCOUNT_BLOCKED_BUSINESS_OWNER;
  throw err;
}

export async function deleteUserAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke("delete-user-account", {
    body: {},
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) {
    throwIfDeleteBlockedBody(error.context?.body);
    throw new Error(parseFunctionError(error));
  }
  if (data && typeof data === "object" && "error" in data) {
    throwIfDeleteBlockedBody(data);
    throw new Error((data as { error?: string }).error ?? "Server returned an error");
  }
}

/**
 * Fire-and-forget: tell the server to send push notifications to eligible consumers.
 * Never throws — the merchant UX should not block on push delivery.
 */
export async function notifyDealPublished(dealId: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("send-deal-push", {
      body: { deal_id: dealId },
      timeout: EDGE_FUNCTION_TIMEOUT_QUICK_MS,
    });
    if (error) {
      devWarn("[notifyDealPublished] Push dispatch failed:", parseFunctionError(error));
    }
  } catch (err) {
    devWarn("[notifyDealPublished] Non-fatal error:", err);
  }
}

export type AiDealCopyResult = {
  title: string;
  promo_line: string;
  description: string;
};

/** Text-only GPT deal copy (Edge: `ai-generate-deal-copy`). Does not write to the database. */
export async function aiGenerateDealCopy(body: {
  hint_text: string;
  price?: number | null;
  business_name?: string | null;
}): Promise<AiDealCopyResult> {
  const { data, error } = await supabase.functions.invoke("ai-generate-deal-copy", {
    body: {
      hint_text: body.hint_text,
      price: body.price ?? undefined,
      business_name: body.business_name ?? undefined,
    },
    timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
  });

  if (error) {
    throw new Error(parseFunctionError(error));
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as { error?: string }).error ?? "Server returned an error"));
  }
  const d = data as Partial<AiDealCopyResult>;
  if (typeof d.title !== "string" || typeof d.promo_line !== "string" || typeof d.description !== "string") {
    throw new Error("Unexpected response from ai-generate-deal-copy.");
  }
  return { title: d.title, promo_line: d.promo_line, description: d.description };
}

export type AiCreateDealResult = {
  deal_id: string;
  title: string;
  description: string;
  promo_line: string;
  poster_url: string;
};

/**
 * Legacy one-shot: AI + insert deal (Edge: `ai-create-deal`).
 * Stores a signed URL in `poster_url` (may expire); prefer the main AI ads → publish flow for production.
 */
export async function aiCreateDeal(body: {
  business_id: string;
  photo_path: string;
  hint_text: string;
  price?: number | null;
  end_time: string;
  max_claims: number;
  claim_cutoff_buffer_minutes?: number;
}): Promise<AiCreateDealResult> {
  const { data, error } = await supabase.functions.invoke("ai-create-deal", {
    body: {
      business_id: body.business_id,
      photo_path: body.photo_path,
      hint_text: body.hint_text,
      price: body.price ?? undefined,
      end_time: body.end_time,
      max_claims: body.max_claims,
      claim_cutoff_buffer_minutes: body.claim_cutoff_buffer_minutes ?? 15,
    },
    timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
  });

  if (error) {
    throw new Error(parseFunctionError(error));
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as { error?: string }).error ?? "Server returned an error"));
  }
  const d = data as Partial<AiCreateDealResult>;
  if (
    typeof d.deal_id !== "string" ||
    typeof d.title !== "string" ||
    typeof d.description !== "string" ||
    typeof d.promo_line !== "string" ||
    typeof d.poster_url !== "string"
  ) {
    throw new Error("Unexpected response from ai-create-deal.");
  }
  return {
    deal_id: d.deal_id,
    title: d.title,
    description: d.description,
    promo_line: d.promo_line,
    poster_url: d.poster_url,
  };
}
