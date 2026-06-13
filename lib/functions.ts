import { FunctionsFetchError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { devWarn } from "./dev-log";
import type {
  BusinessContextPayload,
  GeneratedAd,
  PhotoTreatment,
} from "./ad-variants";
import {
  normalizeBusinessLookupResults,
  type BusinessLookupResult,
} from "./business-lookup";
import { Platform } from "react-native";
import Constants from "expo-constants";
import {
  EDGE_FN_TIMEOUT_DEFAULT_MS,
  EDGE_FN_TIMEOUT_AI_MS as _EDGE_FN_TIMEOUT_AI_MS,
  EDGE_FN_TIMEOUT_FAST_MS,
} from "../constants/timing";

/** Default Edge Function HTTP timeout; forwarded to `supabase.functions.invoke({ timeout })`. */
export const EDGE_FUNCTION_TIMEOUT_MS = EDGE_FN_TIMEOUT_DEFAULT_MS;
export const EDGE_FUNCTION_TIMEOUT_AI_MS = _EDGE_FN_TIMEOUT_AI_MS;
export const EDGE_FUNCTION_TIMEOUT_QUICK_MS = EDGE_FN_TIMEOUT_FAST_MS;

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
    if (msg.includes("network") || msg.includes("fetch")) {
      return "We couldn't reach the server. Check your connection and try again.";
    }
    if (msg.includes("function invocation failed")) {
      return "We couldn't complete this action right now. Please try again.";
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
        errorMessage = String(parsed.error);
      }
      const parsedCode = typeof parsed.error_code === "string" ? parsed.error_code : undefined;
      if (parsedCode === "OPENAI_NOT_CONFIGURED") {
        return "Menu scan is temporarily unavailable. Please contact support.";
      }
    } catch {
      // Not JSON, use message as-is
    }
  }

  const normalized = (errorMessage || "").toLowerCase();
  if (!normalized) {
    const ctxMsg = error.context?.message;
    return typeof ctxMsg === "string" && ctxMsg.trim().length > 0
      ? ctxMsg
      : "We couldn't complete this action right now. Please try again.";
  }
  if (
    normalized.includes("function invocation failed") ||
    normalized.includes("missing environment variable") ||
    normalized.includes("insert failed") ||
    normalized.includes("rls") ||
    normalized.includes("row-level security") ||
    normalized.includes("permission denied")
  ) {
    return "We couldn't complete this action right now. Please try again or contact support.";
  }
  if (normalized.includes("openai_not_configured")) {
    return "Menu scan is temporarily unavailable. Please contact support.";
  }

  // Fallback to cleaned error message or context
  const ctxMsg = error.context?.message;
  return (
    errorMessage ||
    (typeof ctxMsg === "string" ? ctxMsg : "") ||
    "We couldn't complete this action right now. Please try again."
  );
}

/** Thrown from AI edge invokes when the response body includes `error_code`. */
export type ErrorWithCode = Error & { code?: string };

function extractErrorCodeFromInvokeError(error: unknown): string | undefined {
  if (!isSupabaseFunctionInvokeError(error)) return undefined;
  const body = error.context?.body;
  if (body && typeof body === "object" && body !== null && "error_code" in body) {
    const c = (body as { error_code?: unknown }).error_code;
    if (typeof c === "string" && c.length > 0) return c;
  }
  if (error.message) {
    try {
      const parsed = JSON.parse(error.message) as { error_code?: string };
      if (typeof parsed.error_code === "string" && parsed.error_code.length > 0) {
        return parsed.error_code;
      }
    } catch {
      /* not JSON */
    }
  }
  return undefined;
}

export function getErrorCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && e !== null && "code" in e) {
    const c = (e as ErrorWithCode).code;
    if (typeof c === "string" && c.length > 0) return c;
  }
  return extractErrorCodeFromInvokeError(e);
}

export function throwInvokeError(message: string, code?: string): never {
  const err = new Error(message) as ErrorWithCode;
  if (code) err.code = code;
  throw err;
}

function throwIfEdgeResponseError(data: unknown): void {
  if (!data || typeof data !== "object" || !("error" in data)) return;
  const o = data as { error?: unknown; error_code?: unknown };
  if (typeof o.error !== "string") return;
  const code = typeof o.error_code === "string" ? o.error_code : undefined;
  throwInvokeError(o.error, code);
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
    const fromBody = await readInvokeErrorBody(error);
    const parsed = fromBody.message ?? parseFunctionError(error);
    const message = /edge function returned a non-2xx status code/i.test(parsed)
      ? "We couldn't claim this deal right now. Please try again."
      : parsed;
    throwInvokeError(message, fromBody.code ?? getErrorCode(error));
  }

  // Check if data itself contains an error (shouldn't happen with proper function, but be safe)
  if (data && typeof data === "object" && "error" in data) {
    const body = data as { error?: string; error_code?: string };
    throwInvokeError(body.error || "Server returned an error", body.error_code);
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
    const fromBody = await readInvokeErrorBody(error);
    const parsed = fromBody.message ?? parseFunctionError(error);
    const message = /edge function returned a non-2xx status code|^Failed to redeem token:/i.test(parsed)
      ? "Token redemption failed"
      : parsed;
    throw new Error(message || "Token redemption failed");
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
    claim_id?: string;
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
      body: {
        app_version:
          Constants.expoConfig?.version ?? (Constants as { nativeAppVersion?: string }).nativeAppVersion ?? null,
        device_platform: Platform.OS,
      },
      timeout: EDGE_FUNCTION_TIMEOUT_QUICK_MS,
    });
  } catch (err) {
    devWarn("[finalizeStaleRedeems] failed (non-fatal):", err);
  }
}

export async function deleteUserAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke("delete-user-account", {
    body: {},
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) {
    throw new Error(parseFunctionError(error));
  }
  if (data && typeof data === "object" && "error" in data) {
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

export type { BusinessLookupResult } from "./business-lookup";

/** Look up verified Google Places candidates by business name. */
export async function aiBusinessLookup(body: {
  business_name: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<BusinessLookupResult[]> {
  try {
    const { data, error } = await supabase.functions.invoke("ai-business-lookup", {
      body: {
        business_name: body.business_name,
        lat: body.lat ?? undefined,
        lng: body.lng ?? undefined,
      },
      timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
    });

    if (error) {
      const fromBody = await readInvokeErrorBody(error);
      throw new Error(fromBody.message ?? parseFunctionError(error));
    }
    if (data && typeof data === "object" && "error" in data) {
      throw new Error(String((data as { error?: string }).error ?? "Lookup failed"));
    }
    const results = normalizeBusinessLookupResults(data);
    const rawResults = data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)
      ? (data as { results: unknown[] }).results
      : [];
    if (rawResults.length > 0 && results.length === 0) {
      devWarn("[aiBusinessLookup] Ignored unverified business lookup results.");
    }
    return results;
  } catch (err) {
    devWarn("[aiBusinessLookup] Edge function failed:", err);
    throw err;
  }
}

/** Fetch verified Google Place details after the owner selects a candidate. */
export async function aiBusinessLookupDetails(body: {
  place_id: string;
}): Promise<BusinessLookupResult> {
  const { data, error } = await supabase.functions.invoke("ai-business-lookup", {
    body: {
      action: "details",
      place_id: body.place_id,
    },
    timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
  });

  if (error) {
    const fromBody = await readInvokeErrorBody(error);
    throw new Error(fromBody.message ?? parseFunctionError(error));
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as { error?: string }).error ?? "Lookup failed"));
  }

  const result = normalizeBusinessLookupResults(data)[0] ?? null;
  if (!result) {
    throw new Error("We could not verify this business. Enter details manually.");
  }
  return result;
}

/**
 * Fire-and-forget: translate deal title/description into es + ko.
 * Never throws — translations arrive asynchronously.
 */
export type DealTranslationResult = {
  source_locale: "en" | "es" | "ko";
  title_en: string;
  title_es: string;
  title_ko: string;
  description_en: string;
  description_es: string;
  description_ko: string;
};

function parseDealTranslationResult(data: unknown): DealTranslationResult {
  if (!data || typeof data !== "object") {
    throw new Error("Unexpected response from ai-translate-deal.");
  }
  const d = data as Partial<DealTranslationResult>;
  const source = d.source_locale;
  if (source !== "en" && source !== "es" && source !== "ko") {
    throw new Error("Unexpected response from ai-translate-deal.");
  }
  for (const key of ["title_en", "title_es", "title_ko", "description_en", "description_es", "description_ko"] as const) {
    if (typeof d[key] !== "string") {
      throw new Error("Unexpected response from ai-translate-deal.");
    }
  }
  const title_en = d.title_en!;
  const title_es = d.title_es!;
  const title_ko = d.title_ko!;
  const description_en = d.description_en!;
  const description_es = d.description_es!;
  const description_ko = d.description_ko!;
  return {
    source_locale: source,
    title_en,
    title_es,
    title_ko,
    description_en,
    description_es,
    description_ko,
  };
}

/** Translate source deal copy before publish so all customer locales are saved together. */
export async function translateDealCopy(body: {
  business_id: string;
  title: string;
  description: string;
  source_locale: "en" | "es" | "ko";
}): Promise<DealTranslationResult> {
  const { data, error } = await supabase.functions.invoke("ai-translate-deal", {
    body,
    timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
  });
  if (error) {
    const fromBody = await readInvokeErrorBody(error);
    throw new Error(fromBody.message ?? parseFunctionError(error));
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as { error?: string }).error ?? "Translation failed."));
  }
  return parseDealTranslationResult(data);
}

export async function translateDeal(dealId: string, sourceLocale?: "en" | "es" | "ko"): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("ai-translate-deal", {
      body: { deal_id: dealId, ...(sourceLocale ? { source_locale: sourceLocale } : {}) },
      timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
    });
    if (error) {
      devWarn("[translateDeal] Translation failed:", parseFunctionError(error));
    }
  } catch (err) {
    devWarn("[translateDeal] Non-fatal error:", err);
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
  business_id?: string | null;
}): Promise<AiDealCopyResult> {
  try {
    const { data, error } = await supabase.functions.invoke("ai-generate-deal-copy", {
      body: {
        hint_text: body.hint_text,
        price: body.price ?? undefined,
        business_name: body.business_name ?? undefined,
        business_id: body.business_id ?? undefined,
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
  } catch (err) {
    devWarn("[aiGenerateDealCopy] Edge function failed:", err);
    throw err;
  }
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

export type AiExtractMenuItem = {
  name: string;
  category?: string;
  price_text?: string;
  size_options?: string[];
  readable?: boolean;
};

export type AiExtractMenuResult = {
  ok: true;
  items: AiExtractMenuItem[];
  low_legibility: boolean;
  extraction_source?: "openai" | "synthetic_fallback";
  menu_notes: string;
};

/** Vision menu scan (Edge: `ai-extract-menu`). */
export async function aiExtractMenu(body: {
  business_id: string;
  image_url?: string;
  image_base64?: string;
  image_mime_type?: string;
}): Promise<AiExtractMenuResult> {
  const { data, error } = await supabase.functions.invoke("ai-extract-menu", {
    body,
    timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
  });
  if (error) {
    throwInvokeError(parseFunctionError(error), extractErrorCodeFromInvokeError(error));
  }
  throwIfEdgeResponseError(data);
  const d = data as Partial<AiExtractMenuResult & { ok?: boolean }>;
  if (!d?.ok || !Array.isArray(d.items)) {
    throw new Error("Unexpected response from ai-extract-menu.");
  }
  return {
    ok: true,
    items: (d.items as AiExtractMenuItem[]).map((item) => ({
      ...item,
      size_options: Array.isArray(item.size_options)
        ? item.size_options.filter((size) => typeof size === "string" && size.trim().length > 0)
        : [],
    })),
    low_legibility: d.low_legibility === true,
    extraction_source: d.extraction_source === "synthetic_fallback" ? "synthetic_fallback" : "openai",
    menu_notes: typeof d.menu_notes === "string" ? d.menu_notes : "",
  };
}

// ── v2 single-ad pipeline (the new quality-first flow) ─────────────────────────────

export type AdVariantsQuota = { used: number; limit: number; remaining: number };

export type AiGenerateAdRequest = {
  business_id: string;
  hint_text: string;
  business_context: BusinessContextPayload;
  output_language: string;
  photo_path?: string;
  photo_treatment?: PhotoTreatment | null;
  offer_schedule_summary?: string;
  quantity_limit?: number | null;
  redemption_limit?: string;
};

export type AiReviseAdRequest = AiGenerateAdRequest & {
  previous_ad: GeneratedAd;
  revision_target: "copy" | "image" | "both";
  revision_count: number;
  revision_preset?: string;
  revision_feedback?: string;
};

export type AiGenerateAdResponse = { ad: GeneratedAd; quota?: AdVariantsQuota };

/** Generate a single ad (research → copy → image). Edge: `ai-generate-ad-variants`. */
export async function aiGenerateAd(body: AiGenerateAdRequest): Promise<AiGenerateAdResponse> {
  return invokeAdEdge({
    business_id: body.business_id,
    hint_text: body.hint_text,
    business_context: body.business_context,
    output_language: body.output_language,
    ...(body.photo_path ? { photo_path: body.photo_path } : {}),
    ...(body.photo_treatment ? { photo_treatment: body.photo_treatment } : {}),
    ...(body.offer_schedule_summary ? { offer_schedule_summary: body.offer_schedule_summary } : {}),
    ...(body.quantity_limit != null ? { quantity_limit: body.quantity_limit } : {}),
    ...(body.redemption_limit ? { redemption_limit: body.redemption_limit } : {}),
  });
}

/** Revise an existing ad — copy only, image only, or both. */
export async function aiReviseAd(body: AiReviseAdRequest): Promise<AiGenerateAdResponse> {
  return invokeAdEdge({
    business_id: body.business_id,
    hint_text: body.hint_text,
    business_context: body.business_context,
    output_language: body.output_language,
    previous_ad: body.previous_ad,
    revision_target: body.revision_target,
    revision_count: body.revision_count,
    ...(body.revision_preset ? { revision_preset: body.revision_preset } : {}),
    ...(body.revision_feedback ? { revision_feedback: body.revision_feedback } : {}),
    ...(body.photo_path ? { photo_path: body.photo_path } : {}),
    ...(body.photo_treatment ? { photo_treatment: body.photo_treatment } : {}),
    ...(body.offer_schedule_summary ? { offer_schedule_summary: body.offer_schedule_summary } : {}),
    ...(body.quantity_limit != null ? { quantity_limit: body.quantity_limit } : {}),
    ...(body.redemption_limit ? { redemption_limit: body.redemption_limit } : {}),
  });
}

/**
 * Edge functions return `{ error, error_code }` JSON with a non-2xx status, but
 * supabase-js wraps that in a FunctionsHttpError whose `context` is the raw
 * Response — the body is never pre-read, so the synchronous parsers above can't
 * see it. Read it here (async) so codes like COOLDOWN_ACTIVE / MONTHLY_LIMIT
 * reach the caller instead of a bare "Edge Function returned a non-2xx status".
 */
async function readInvokeErrorBody(
  error: unknown,
): Promise<{ message?: string; code?: string }> {
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

async function invokeAdEdge(payload: Record<string, unknown>): Promise<AiGenerateAdResponse> {
  const { data, error } = await supabase.functions.invoke("ai-generate-ad-variants", {
    body: payload,
    timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
  });
  if (error) {
    const fromBody = await readInvokeErrorBody(error);
    const code = fromBody.code ?? extractErrorCodeFromInvokeError(error);
    const message = fromBody.message ?? parseFunctionError(error);
    throwInvokeError(message, code);
  }
  throwIfEdgeResponseError(data);
  const d = data as { ad?: GeneratedAd; ads?: GeneratedAd[]; quota?: AdVariantsQuota };
  const ad = d.ad ?? (Array.isArray(d.ads) && d.ads.length > 0 ? d.ads[0] : undefined);
  if (!ad || typeof ad.headline !== "string") {
    throw new Error("Unexpected response from ai-generate-ad-variants.");
  }
  return { ad, quota: d.quota };
}
