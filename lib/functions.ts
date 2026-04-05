import { FunctionsFetchError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { devWarn } from "@/lib/dev-log";
import { isDemoPreviewAccountEmail } from "@/lib/demo-account";
import type { BusinessContextPayload, CreativeLane, GeneratedAd } from "./ad-variants";
import { Platform } from "react-native";
import Constants from "expo-constants";

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
    if (await isCurrentUserDemo()) {
      devWarn("[aiBusinessLookup] Edge function failed for demo user, using client fallback:", err);
      return [{
        name: body.business_name,
        formatted_address: "123 Main St, Irving, TX 75038",
        phone: "(972) 555-0100",
        lat: 32.8140,
        lng: -96.9489,
        category: "Coffee shop",
        hours_text: "Mon–Fri 6 AM–6 PM, Sat–Sun 7 AM–4 PM",
        website: "",
        source: "ai_estimate",
      }];
    }
    throw err;
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
  const biz = bizName ?? "Local business";
  const priceBit = price != null ? ` ($${price})` : "";
  return {
    title: `BOGO ${hint.slice(0, 30)}${priceBit}`.slice(0, 50),
    promo_line: `Buy one, get one free at ${biz}`.slice(0, 60),
    description: `Grab a friend and enjoy ${hint.slice(0, 60)} — two for the price of one at ${biz}. Walk-ins welcome!`.slice(0, 160),
  };
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
    // Demo accounts: return client-side template instead of failing
    if (await isCurrentUserDemo()) {
      devWarn("[aiGenerateDealCopy] Edge function failed for demo user, using client fallback:", err);
      return buildDemoDealCopy(body.hint_text, body.price, body.business_name);
    }
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

export type AiRefineAdCopyUsage = {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
};

/** Refine one ad draft with chat history (Edge: `ai-refine-ad-copy`). */
export async function aiRefineAdCopy(body: {
  business_id: string;
  structured_offer: Record<string, unknown>;
  selected_draft: Record<string, unknown>;
  instruction: string;
  conversation_history: Array<{ role: string; content: string }>;
  output_language?: string;
}): Promise<{ ok: true; draft: GeneratedAd; usage: AiRefineAdCopyUsage }> {
  try {
    const { data, error } = await supabase.functions.invoke("ai-refine-ad-copy", {
      body: {
        business_id: body.business_id,
        structured_offer: body.structured_offer,
        selected_draft: body.selected_draft,
        instruction: body.instruction,
        conversation_history: body.conversation_history,
        output_language: body.output_language ?? "en",
      },
      timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
    });
    if (error) {
      throwInvokeError(parseFunctionError(error), extractErrorCodeFromInvokeError(error));
    }
    throwIfEdgeResponseError(data);
    const d = data as {
      ok?: boolean;
      draft?: GeneratedAd;
      usage?: AiRefineAdCopyUsage;
    };
    if (!d?.ok || !d.draft || typeof d.draft.headline !== "string") {
      throw new Error("Unexpected response from ai-refine-ad-copy.");
    }
    return { ok: true, draft: d.draft, usage: d.usage ?? { prompt_tokens: null, completion_tokens: null, total_tokens: null } };
  } catch (err) {
    if (await isCurrentUserDemo()) {
      devWarn("aiRefineAdCopy: edge failed for demo user, returning fallback", err);
      const sel = body.selected_draft as GeneratedAd;
      const draft: GeneratedAd = {
        creative_lane: sel.creative_lane ?? ("value" as CreativeLane),
        headline: sel.headline ?? "Demo Headline",
        subheadline: sel.subheadline ?? "Demo subheadline",
        cta: sel.cta ?? "Try It Now",
        style_label: sel.style_label ?? "Value",
        rationale: `Refined per your request: "${body.instruction.slice(0, 80)}"`,
        visual_direction: sel.visual_direction ?? "Clean, inviting design",
      };
      return { ok: true, draft, usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null } };
    }
    throw err;
  }
}

export type AdVariantsQuota = { used: number; limit: number; remaining: number };

/** Client-side demo fallback for ad variants. */
function buildDemoAdVariants(hint: string, bizName?: string): GeneratedAd[] {
  const biz = bizName ?? "Local business";
  return [
    {
      creative_lane: "value" as CreativeLane,
      headline: `BOGO at ${biz}`.slice(0, 50),
      subheadline: `${hint.slice(0, 40)} — buy one, get one free`,
      cta: "Grab Yours Today",
      style_label: "Value",
      rationale: "Clear savings message",
      visual_direction: "Bold price-led design",
    },
    {
      creative_lane: "neighborhood" as CreativeLane,
      headline: `Your Neighbors Love ${biz}`.slice(0, 50),
      subheadline: `Come try ${hint.slice(0, 40)} and bring a friend`,
      cta: "Visit Us",
      style_label: "Community",
      rationale: "Local community tone",
      visual_direction: "Warm, inviting neighborhood feel",
    },
    {
      creative_lane: "premium" as CreativeLane,
      headline: `Crafted with Care at ${biz}`.slice(0, 50),
      subheadline: `Two for one — ${hint.slice(0, 40)}`,
      cta: "Discover the Difference",
      style_label: "Premium",
      rationale: "Quality-focused messaging",
      visual_direction: "Clean, refined aesthetic",
    },
  ];
}

/** Three ad lanes from structured offer (optional photo). Edge: `ai-generate-ad-variants`. */
export async function aiGenerateAdVariantsStructured(body: {
  business_id: string;
  structured_offer: Record<string, unknown>;
  hint_text: string;
  business_context: BusinessContextPayload;
  output_language: string;
  photo_path?: string;
  price?: number | null;
  regeneration_attempt?: number;
  offer_schedule_summary?: string;
}): Promise<{ ads: GeneratedAd[]; quota?: AdVariantsQuota }> {
  try {
    const { data, error } = await supabase.functions.invoke("ai-generate-ad-variants", {
      body: {
        business_id: body.business_id,
        structured_offer: body.structured_offer,
        hint_text: body.hint_text,
        business_context: body.business_context,
        output_language: body.output_language,
        regeneration_attempt: body.regeneration_attempt ?? 0,
        ...(body.photo_path ? { photo_path: body.photo_path } : {}),
        ...(body.price != null ? { price: body.price } : {}),
        ...(body.offer_schedule_summary ? { offer_schedule_summary: body.offer_schedule_summary } : {}),
      },
      timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
    });
    if (error) {
      throwInvokeError(parseFunctionError(error), extractErrorCodeFromInvokeError(error));
    }
    throwIfEdgeResponseError(data);
    const d = data as { ads?: GeneratedAd[]; quota?: AdVariantsQuota };
    if (!Array.isArray(d.ads) || d.ads.length !== 3) {
      throw new Error("Unexpected response from ai-generate-ad-variants.");
    }
    return { ads: d.ads, quota: d.quota };
  } catch (err) {
    if (await isCurrentUserDemo()) {
      devWarn("[aiGenerateAdVariantsStructured] Edge function failed for demo user, using client fallback:", err);
      return {
        ads: buildDemoAdVariants(body.hint_text, body.business_context?.category),
        quota: { used: 0, limit: 30, remaining: 30 },
      };
    }
    throw err;
  }
}
