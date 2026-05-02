import { FunctionsFetchError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { devWarn } from "@/lib/dev-log";
import { isDemoPreviewAccountEmail } from "@/lib/demo-account";
import type {
  BusinessContextPayload,
  GeneratedAd,
  PhotoTreatment,
} from "./ad-variants";
import { Platform } from "react-native";
import Constants from "expo-constants";
import {
  EDGE_FN_TIMEOUT_DEFAULT_MS,
  EDGE_FN_TIMEOUT_AI_MS as _EDGE_FN_TIMEOUT_AI_MS,
  EDGE_FN_TIMEOUT_FAST_MS,
} from "@/constants/timing";

// ── Client-side demo session helper ──────────────────────────
let _cachedDemoEmail: string | null | undefined;

async function isCurrentUserDemo(): Promise<boolean> {
  if (_cachedDemoEmail !== undefined) return isDemoPreviewAccountEmail(_cachedDemoEmail);
  try {
    const { data } = await supabase.auth.getUser();
    _cachedDemoEmail = data?.user?.email ?? null;
  } catch {
    _cachedDemoEmail = null;
  }
  return isDemoPreviewAccountEmail(_cachedDemoEmail);
}

/** Invalidate cached demo status (call on sign-out). */
export function clearDemoEmailCache() {
  _cachedDemoEmail = undefined;
}

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

export type BusinessLookupResult = {
  name: string;
  formatted_address: string;
  phone: string;
  lat: number | null;
  lng: number | null;
  category: string;
  hours_text: string;
  website: string;
  source: "google_places" | "ai_estimate";
};

/** Look up a business by name using Google Places + AI fallback. */
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
      throw new Error(parseFunctionError(error));
    }
    if (data && typeof data === "object" && "error" in data) {
      throw new Error(String((data as { error?: string }).error ?? "Lookup failed"));
    }
    const d = data as { results?: BusinessLookupResult[] };
    return Array.isArray(d.results) ? d.results : [];
  } catch (err) {
    devWarn("[aiBusinessLookup] Edge function failed, using client fallback:", err);
    return [{
      name: body.business_name,
      formatted_address: "123 Main St, Irving, TX 75038",
      phone: "(972) 555-0100",
      lat: 32.8140,
      lng: -96.9489,
      category: "Coffee shop",
      hours_text: "Mon\u2013Fri 6 AM\u20136 PM, Sat\u2013Sun 7 AM\u20134 PM",
      website: "",
      source: "ai_estimate",
    }];
  }
}

/**
 * Fire-and-forget: translate deal title/description into es + ko.
 * Never throws — translations arrive asynchronously.
 */
export async function translateDeal(dealId: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("ai-translate-deal", {
      body: { deal_id: dealId },
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

/** Client-side demo fallback for deal copy generation. */
function buildDemoDealCopy(hint: string, price?: number | null, bizName?: string | null): AiDealCopyResult {
  const biz = bizName ?? "Demo Roasted Bean Coffee";
  const pTag = price != null ? ` \u00B7 $${price}` : "";
  const h = hint.toLowerCase();

  type ItemKey = "latte" | "cortado" | "cold_brew" | "matcha" | "croissant" | "muffin" | "pastry" | "combo" | "generic";
  const patterns: [ItemKey, RegExp][] = [
    ["latte", /latte/], ["cortado", /cortado|espresso/], ["cold_brew", /cold\s*brew|iced\s*coffee/],
    ["matcha", /matcha|green\s*tea/], ["croissant", /croissant/], ["muffin", /muffin|blueberry/],
    ["pastry", /pastry|baked|scone/], ["combo", /combo|pair|bundle|\+|and a/],
  ];
  let itemKey: ItemKey = "generic";
  for (const [k, rx] of patterns) { if (rx.test(h)) { itemKey = k; break; } }

  const cl = (s: string, m: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length <= m ? t : t.slice(0, m - 1).trimEnd() + "\u2026"; };

  const bank: Record<ItemKey, AiDealCopyResult> = {
    latte: { title: cl(`Handcrafted lattes, twice the joy${pTag}`, 50), promo_line: cl(`Every latte at ${biz} is made fresh with care`, 60), description: cl("Two hand-pulled lattes for the price of one. Made with single-origin beans and steamed oat milk.", 160) },
    cortado: { title: cl(`Crafted cortado, doubled${pTag}`, 50), promo_line: cl(`Precision-pulled at ${biz}`, 60), description: cl("A properly balanced cortado deserves a second pour. Two for one — same care in every cup.", 160) },
    cold_brew: { title: cl(`Small-batch cold brew 2-for-1${pTag}`, 50), promo_line: cl(`Steeped 18 hours at ${biz}`, 60), description: cl("Our single-origin cold brew is steeped low and slow for a clean, smooth finish. Bring a friend.", 160) },
    matcha: { title: cl(`Ceremonial matcha, on us${pTag}`, 50), promo_line: cl(`Stone-ground and whisked fresh at ${biz}`, 60), description: cl("Real ceremonial-grade matcha, not the powdered stuff. Buy one, get one — bright, earthy, and made to order.", 160) },
    croissant: { title: cl(`Freshly baked croissant, doubled${pTag}`, 50), promo_line: cl(`Warm from the oven at ${biz}`, 60), description: cl("Buttery, flaky, and laminated by hand every morning. Take two — one for now and one for later.", 160) },
    muffin: { title: cl(`Blueberry muffins, buy one get one${pTag}`, 50), promo_line: cl(`Baked fresh daily at ${biz}`, 60), description: cl("Bursting with real blueberries and topped with a crunchy streusel. Grab a pair and share the morning.", 160) },
    pastry: { title: cl(`Artisan pastry, two for one${pTag}`, 50), promo_line: cl(`From our bakery case at ${biz}`, 60), description: cl("Every pastry is shaped and proofed by hand. Pick your favorite, and the second one's on us.", 160) },
    combo: { title: cl(`The perfect pairing${pTag}`, 50), promo_line: cl(`Crafted together at ${biz}`, 60), description: cl("Some things are better in pairs. Enjoy a drink and a bite — the second item is free.", 160) },
    generic: { title: cl(`Crafted with care, doubled for you${pTag}`, 50), promo_line: cl(`Made fresh at ${biz}`, 60), description: cl("Quality ingredients, honest portions, and now twice the reason to visit. Buy one, get one — no catch.", 160) },
  };
  return bank[itemKey];
}

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
    devWarn("[aiGenerateDealCopy] Edge function failed, using client fallback:", err);
    return buildDemoDealCopy(body.hint_text, body.price, body.business_name);
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
  readable?: boolean;
};

export type AiExtractMenuResult = {
  ok: true;
  items: AiExtractMenuItem[];
  low_legibility: boolean;
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
    items: d.items as AiExtractMenuItem[],
    low_legibility: d.low_legibility === true,
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
  });
}

async function invokeAdEdge(payload: Record<string, unknown>): Promise<AiGenerateAdResponse> {
  const { data, error } = await supabase.functions.invoke("ai-generate-ad-variants", {
    body: payload,
    timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
  });
  if (error) {
    throwInvokeError(parseFunctionError(error), extractErrorCodeFromInvokeError(error));
  }
  throwIfEdgeResponseError(data);
  const d = data as { ad?: GeneratedAd; ads?: GeneratedAd[]; quota?: AdVariantsQuota };
  const ad = d.ad ?? (Array.isArray(d.ads) && d.ads.length > 0 ? d.ads[0] : undefined);
  if (!ad || typeof ad.headline !== "string") {
    throw new Error("Unexpected response from ai-generate-ad-variants.");
  }
  return { ad, quota: d.quota };
}
