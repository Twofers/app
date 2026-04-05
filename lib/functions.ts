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
      const draft = buildDemoRefinedDraft(
        body.selected_draft as GeneratedAd,
        body.instruction,
        body.structured_offer,
      );
      return { ok: true, draft, usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null } };
    }
    throw err;
  }
}

// ── Demo ad-refine fallback ──────────────────────────────────
type ToneKey = "fun" | "urgent" | "short" | "formal" | "casual" | "emoji" | "spanish" | "korean" | "savings" | "quality" | "community" | "generic";

const TONE_PATTERNS: [ToneKey, RegExp][] = [
  ["fun", /\b(fun|playful|silly|witty|humor|humour|funny|energetic|lively|cheerful|upbeat)\b/i],
  ["urgent", /\b(urgen|hurry|limited|rush|fast|quick|now|fomo|scarcity|don'?t miss|act fast|last chance)\b/i],
  ["short", /\b(short|brief|concise|trim|fewer words|less text|simpler|minimal|tighter)\b/i],
  ["formal", /\b(formal|professional|polished|elegant|sophisticated|refined|business|classy)\b/i],
  ["casual", /\b(casual|chill|relaxed|laid.?back|friendly|conversational|warm|cozy)\b/i],
  ["emoji", /\b(emoji|emojis|icons|emoticon)\b/i],
  ["spanish", /\b(spanish|español|espanol|en español)\b/i],
  ["korean", /\b(korean|한국어|한글)\b/i],
  ["savings", /\b(saving|value|price|deal|cheap|afford|discount|money|budget|bang for)\b/i],
  ["quality", /\b(quality|craft|artisan|premium|handmade|fresh|ingredient|small.?batch|specialty)\b/i],
  ["community", /\b(community|local|neighbor|neighbourhood|neighborhood|block|corner|regulars|family)\b/i],
];

function detectTone(instruction: string): ToneKey {
  for (const [key, rx] of TONE_PATTERNS) {
    if (rx.test(instruction)) return key;
  }
  return "generic";
}

function clipText(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "\u2026";
}

function extractOfferItem(offer: Record<string, unknown>): string {
  const item =
    (offer.buy_item as string) ||
    (offer.free_item as string) ||
    (offer.item_name as string) ||
    (offer.hint_text as string) ||
    "";
  return item.trim() || "your favorite";
}

function buildDemoRefinedDraft(
  draft: GeneratedAd,
  instruction: string,
  offer: Record<string, unknown>,
): GeneratedAd {
  const tone = detectTone(instruction);
  const lane = draft.creative_lane ?? ("value" as CreativeLane);
  const item = extractOfferItem(offer);

  const rewrites: Record<ToneKey, Omit<GeneratedAd, "creative_lane">> = {
    fun: {
      headline: clipText(`Double the ${item}, double the smiles`, 40),
      subheadline: clipText(`Bring a friend and treat yourselves — life's too short for just one ${item}!`, 88),
      cta: "Let's Go!",
      style_label: "Playful & bright",
      rationale: "Lighthearted energy makes the deal feel like a treat, not a transaction.",
      visual_direction: "Bright colors, candid smiles, hand-drawn accents.",
    },
    urgent: {
      headline: clipText(`Today only — BOGO ${item}`, 40),
      subheadline: "Spots are filling up. Grab yours before they're gone.",
      cta: "Claim Now",
      style_label: "Time-sensitive",
      rationale: "Clear urgency drives immediate action without feeling pushy.",
      visual_direction: "Bold countdown feel, high contrast, warm tones.",
    },
    short: {
      headline: clipText(`2-for-1 ${item}`, 40),
      subheadline: "Buy one, get one. Simple as that.",
      cta: "Get Yours",
      style_label: "Minimal",
      rationale: "Stripped to the essentials — the offer speaks for itself.",
      visual_direction: "Clean whitespace, bold type, single product shot.",
    },
    formal: {
      headline: clipText(`Complimentary ${item} with purchase`, 40),
      subheadline: clipText(`We invite you to experience our craftsmanship — enjoy a second ${item} on us.`, 88),
      cta: "Redeem Offer",
      style_label: "Polished & refined",
      rationale: "Professional tone elevates the brand without losing warmth.",
      visual_direction: "Serif accents, muted palette, elegant product photography.",
    },
    casual: {
      headline: clipText(`Hey, free ${item} on us`, 40),
      subheadline: "Grab a friend, swing by, and enjoy two for the price of one. No catch.",
      cta: "Come On In",
      style_label: "Friendly & relaxed",
      rationale: "Feels like a friend telling you about a deal, not an ad.",
      visual_direction: "Warm lighting, approachable vibe, handwritten feel.",
    },
    emoji: {
      headline: clipText(`Buy 1 Get 1 ${item}`, 40),
      subheadline: clipText(`Treat yourself and a friend — two ${item}s, one price. What's not to love?`, 88),
      cta: "Grab the Deal",
      style_label: "Eye-catching",
      rationale: "Visual flair draws the eye in a busy feed.",
      visual_direction: "Colorful accents, product close-up, pop of orange.",
    },
    spanish: {
      headline: clipText(`2x1 en ${item}`, 40),
      subheadline: "Compra uno y llévate otro gratis. Ven con alguien especial.",
      cta: "Canjear ahora",
      style_label: "Oferta directa",
      rationale: "Mensaje claro en español para alcanzar más vecinos.",
      visual_direction: "Colores cálidos, tipografía legible, producto al frente.",
    },
    korean: {
      headline: clipText(`${item} 1+1 혜택`, 40),
      subheadline: "하나 사면 하나 더! 친구와 함께 방문하세요.",
      cta: "지금 받기",
      style_label: "깔끔한 혜택",
      rationale: "한국어로 명확하게 전달하여 더 많은 이웃에게 도달합니다.",
      visual_direction: "깔끔한 배경, 제품 강조, 따뜻한 톤.",
    },
    savings: {
      headline: clipText(`Save on ${item} — BOGO deal`, 40),
      subheadline: "Why pay for two when you can get one free? Real savings, no strings.",
      cta: "See the Savings",
      style_label: "Value-forward",
      rationale: "Leads with the financial benefit to attract deal-seekers.",
      visual_direction: "Price badge overlay, warm product shot, bold numbers.",
    },
    quality: {
      headline: clipText(`Handcrafted ${item}, twice the joy`, 40),
      subheadline: clipText(`Every ${item} is made fresh with care. Now enjoy two for the price of one.`, 88),
      cta: "Taste the Craft",
      style_label: "Artisan quality",
      rationale: "Highlights the craft behind the product to justify the visit.",
      visual_direction: "Tight crop on texture and detail, natural light, minimal text.",
    },
    community: {
      headline: clipText(`Your neighborhood ${item} spot`, 40),
      subheadline: clipText(`We're proud to be part of this community. Bring a neighbor — BOGO today.`, 88),
      cta: "Stop By",
      style_label: "Local favorite",
      rationale: "Neighborhood warmth turns the deal into a community moment.",
      visual_direction: "Storefront or street context, warm tones, real people.",
    },
    generic: {
      headline: clipText(draft.headline || `BOGO ${item}`, 40),
      subheadline: clipText(
        draft.subheadline
          ? `${draft.subheadline.split(".")[0]}. Freshly updated to match your vision.`
          : `Buy one ${item}, get one free. Updated just for you.`,
        88,
      ),
      cta: clipText(draft.cta || "Claim Yours", 26),
      style_label: "Refreshed",
      rationale: "Applied your feedback while keeping the core offer front and center.",
      visual_direction: "Balanced layout, product hero, clean typography.",
    },
  };

  return { creative_lane: lane, ...rewrites[tone] };
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
