/**
 * ai-generate-ad-variants — Twofer ad generator (single-ad pipeline).
 *
 * Quality-first rewrite (2026-05-01):
 * - Stage 1: optional web research for unfamiliar menu items (gpt-4o-search-preview).
 * - Stage 2: copy generation tuned for an item-forward, anti-AI-tell voice.
 * - Stage 3: image — enhance the cafe's uploaded photo (touchup / cleanbg / studiopolish)
 *            OR generate a photoreal hero via the configured GPT image model when no photo is provided.
 *
 * The app renders the headline/subline/CTA ABOVE the image — text is never baked in.
 *
 * Returns a single ad. For backward compatibility with old clients, the response also
 * includes `ads: [ad]` so existing UI that expects an array does not crash.
 */

import { createClient, type SupabaseClient as SupabaseClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel, chatCompletionTuning, isGpt5FamilyModel } from "../_shared/openai-chat-model.ts";
import { DEFAULT_MONTHLY_LIMIT, DEFAULT_COOLDOWN_SEC } from "../_shared/ai-limits.ts";
import {
  buildPhotoAdImagePrompt,
  enhanceUploadedPhotoWithTelemetry,
  generatePhotoAdImageWithTelemetry,
  RESOLVED_IMAGE_GENERATE_MODEL,
  type PhotoTreatment,
  type OpenAiImageAttempt,
} from "../_shared/dalle-image.ts";
import {
  buildGeminiAdImagePrompt,
  generateGeminiAdImageWithTelemetry,
  resolveAiImageProviderConfig,
  type AiImageProvider,
  type AiImageProviderConfig,
  type AiImageStylePreset,
  type GeminiImageAttempt,
} from "../_shared/ai-image-provider.ts";
import { logAiCost, openAiRequestIdFromHeaders, type AiUsageInput } from "../_shared/ai-costs.ts";
import { shouldSkipWebSearchForMenuItem } from "../_shared/ai-web-search-gate.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import {
  AD_COPY_PROMPT_VERSION,
  buildAdCopyPrompt,
  type BusinessContext,
  type ItemResearch,
  type OutputLanguage,
} from "./prompt.ts";
import {
  DEAL_COPY_LIMITS,
  buildDealOfferContract,
  buildRequiredVisualItems,
  generateValidatedDealCopy,
  parseAiDealCopyVariants,
  type AiDealCopySource,
  type DealOfferContract,
} from "../../../lib/deal-offer-contract.ts";
import {
  dealEligibilityErrorPayload,
  validateDealEligibility,
  type DealEligibilityInput,
} from "../../../lib/deal-eligibility.ts";
import {
  QUICK_DEAL_IMAGE_QA_SCHEMA,
  buildQuickDealImageQaPrompt,
  buildQuickDealImageRegenerationPrompt,
  normalizeQuickDealImageQaResult,
  type QuickDealImageQaResult,
} from "../../../lib/quick-deal-image-qa.ts";

// Static anchors so Supabase's remote bundler includes the npm packages that
// `_shared/ai-image-provider.ts` imports lazily when Gemini returns JPEG bytes.
import "jpeg-js";
import "pngjs";

const CHAT_MODEL = resolveOpenAiChatModel();
const RESEARCH_MODEL = "gpt-4o-search-preview";
const DEFAULT_MONTHLY = DEFAULT_MONTHLY_LIMIT;
const COOLDOWN_SEC = DEFAULT_COOLDOWN_SEC;

/** Hard cap to bound abuse. The client enforces a matching soft cap (2) for UX. */
const MAX_REVISION_COUNT = 2;

const VALID_PHOTO_TREATMENTS: ReadonlySet<PhotoTreatment> = new Set([
  "touchup",
  "cleanbg",
  "studiopolish",
]);
const VALID_REVISION_TARGETS = new Set(["copy", "image", "both"] as const);

type RevisionTarget = "copy" | "image" | "both";

type SingleAd = {
  /** Short, item-forward (≤40 chars). */
  headline: string;
  /** One sentence — explains what the item is OR why it's worth the trip (≤88 chars). */
  subheadline: string;
  short_description: string;
  push_notification: string;
  terms_summary: string;
  social_caption?: string;
  locked_offer_line?: string;
  locked_terms_line?: string;
  copy_source?: AiDealCopySource;
  variant_count?: number;
  selected_variant_index?: number | null;
  validation_reason_codes?: string[];
  /** Verb-first action (≤26 chars). */
  cta: string;
  /** Research the AI used to write the copy. Empty when it skipped/failed research. */
  item_research: ItemResearch;
  /** How the image was produced. */
  photo_source: "uploaded_original" | "uploaded_enhanced" | "generated" | "stock" | "copy_only";
  /** Which enhancement was applied (only meaningful when photo_source = "uploaded_enhanced"). */
  photo_treatment: PhotoTreatment | null;
  /** Storage path in deal-photos bucket; null if image production failed. */
  poster_storage_path: string | null;
};

function utcMonthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd();
}

function parseDealEligibilityInput(value: unknown): DealEligibilityInput | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DealEligibilityInput)
    : null;
}

function dealNotEligibleForAiResponse(
  input: DealEligibilityInput | null,
  corsHeaders: Record<string, string>,
) {
  const eligibility = input
    ? validateDealEligibility(input)
    : {
        eligible: false,
        eligibilityStatus: "INVALID" as const,
        reasonCode: "INVALID_DEAL_TYPE" as const,
        message:
          "This deal is not eligible for AI ad generation yet. Twofer deals must be free-item offers or at least 40% off a single item.",
      };
  if (eligibility.eligible) return null;
  return new Response(
    JSON.stringify({
      ...dealEligibilityErrorPayload(eligibility),
      error: "DEAL_NOT_ELIGIBLE_FOR_AI",
      error_code: "DEAL_NOT_ELIGIBLE_FOR_AI",
    }),
    { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ─── Stage 1: research ─────────────────────────────────────────────────────

/**
 * Research the menu item with web search. Returns description if useful, blank if unfamiliar.
 * Failures are silent — the copy stage works fine without research context.
 */
async function researchMenuItem(params: {
  openAiKey: string;
  itemHint: string;
  businessName: string;
  businessLocation: string;
  costContext?: AiCostContext;
}): Promise<ItemResearch> {
  const { openAiKey, itemHint, businessName, businessLocation, costContext } = params;
  const cleanHint = itemHint.trim().slice(0, 400);
  if (!cleanHint) {
    return { item_name: "", description: "", is_familiar: false };
  }

  const prompt = [
    "A cafe owner wrote the following note about a menu item they want to promote:",
    `"${cleanHint}"`,
    businessName ? `Business: ${businessName}.` : "",
    businessLocation ? `Location: ${businessLocation}.` : "",
    "",
    "Identify the menu item. If you know what it is, describe in 1-2 short sentences:",
    "  - What it is (kind of drink/pastry/dish)",
    "  - What makes it distinctive (flavor, origin, preparation)",
    "If the item is unfamiliar or the note is too vague, use web search to look it up.",
    "Be honest — if you genuinely cannot identify it after searching, set is_familiar to false.",
    "",
    'Respond in JSON only: {"item_name": "<short name>", "description": "<1-2 sentences>", "is_familiar": <bool>}',
  ]
    .filter(Boolean)
    .join("\n");

  // Stage 1a: use the standard model first; common cafe items do not need live lookup.
  const fallbackResult = await callResearchModel({
    openAiKey,
    model: CHAT_MODEL,
    prompt,
    cleanHint,
    isWebSearch: false,
    costContext,
  });
  if (fallbackResult?.is_familiar || shouldSkipWebSearchForMenuItem(cleanHint)) {
    return fallbackResult ?? { item_name: cleanHint.slice(0, 60), description: "", is_familiar: true };
  }

  // Stage 1b: use search only for unfamiliar, ambiguous, local, or branded items.
  const webSearchResult = await callResearchModel({
    openAiKey,
    model: RESEARCH_MODEL,
    prompt,
    cleanHint,
    isWebSearch: true,
    costContext,
  });
  if (webSearchResult) return webSearchResult;

  // Both failed — return the hint as item_name with no description
  return { item_name: cleanHint.slice(0, 60), description: "", is_familiar: false };
}

async function callResearchModel(params: {
  openAiKey: string;
  model: string;
  prompt: string;
  cleanHint: string;
  isWebSearch: boolean;
  costContext?: AiCostContext;
}): Promise<ItemResearch | null> {
  const { openAiKey, model, prompt, cleanHint, isWebSearch, costContext } = params;
  try {
    // gpt-4o-search-preview rejects temperature; standard chat models accept it.
    // chatCompletionTuning also maps the token/temperature params correctly for the
    // gpt-5 family (max_completion_tokens, no temperature) when CHAT_MODEL is the fallback.
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: prompt }],
      ...chatCompletionTuning(model, {
        maxTokens: 220,
        temperature: isWebSearch ? undefined : 0.4,
      }),
    };
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // Bound the (web-search) research call so a slow model can't, together with
      // copy + image, push total server time past the app's 120s invoke budget.
      // On timeout the catch below returns null → graceful fallback, never a hard error.
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      console.log(
        JSON.stringify({
          tag: "ai_ads_v2",
          event: "research_http",
          model,
          isWebSearch,
          status: res.status,
        }),
      );
      await logAdCost(costContext ?? null, {
        feature: "ad_research",
        model,
        endpoint: "chat.completions",
        webSearchCalls: isWebSearch ? 1 : 0,
        openaiRequestId: openAiRequestIdFromHeaders(res.headers),
        success: false,
        errorCode: `HTTP_${res.status}`,
        errorMessage: `Research call failed with HTTP ${res.status}.`,
      });
      return null;
    }
    const json = await res.json();
    await logAdCost(costContext ?? null, {
      feature: "ad_research",
      model,
      endpoint: "chat.completions",
      usage: json?.usage ?? null,
      webSearchCalls: isWebSearch ? 1 : 0,
      openaiRequestId: openAiRequestIdFromHeaders(res.headers),
      responseId: typeof json?.id === "string" ? json.id : null,
      success: true,
    });
    const content = json?.choices?.[0]?.message?.content ?? "";
    const text = typeof content === "string" ? content.trim() : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ItemResearch>;
    return {
      item_name: clip(typeof parsed.item_name === "string" ? parsed.item_name : cleanHint, 80),
      description: clip(typeof parsed.description === "string" ? parsed.description : "", 280),
      is_familiar: parsed.is_familiar === true,
    };
  } catch (e) {
    console.log(
      JSON.stringify({
        tag: "ai_ads_v2",
        event: "research_error",
        model,
        isWebSearch,
        err: String(e).slice(0, 200),
      }),
    );
    await logAdCost(costContext ?? null, {
      feature: "ad_research",
      model,
      endpoint: "chat.completions",
      webSearchCalls: isWebSearch ? 1 : 0,
      success: false,
      errorCode: "FETCH_ERROR",
      errorMessage: String(e).slice(0, 500),
    });
    return null;
  }
}

// ─── Stage 2: copy ─────────────────────────────────────────────────────────

async function generateCopy(params: {
  openAiKey: string;
  itemHint: string;
  research: ItemResearch;
  businessName: string;
  businessContext: BusinessContext;
  offerContract: DealOfferContract;
  offerScheduleSummary: string;
  quantityLimit: number | null;
  redemptionLimit: string;
  outputLanguage: OutputLanguage;
  revisionPreset?: string;
  revisionFeedback?: string;
  previousAd?: SingleAd;
  costContext: AiCostContext;
}): Promise<Pick<SingleAd, "headline" | "subheadline" | "short_description" | "push_notification" | "terms_summary" | "social_caption" | "locked_offer_line" | "locked_terms_line" | "copy_source" | "variant_count" | "selected_variant_index" | "validation_reason_codes" | "cta"> & { fallback_reason?: string; generator_version?: string; copy_latency_ms?: number }> {
  const {
    openAiKey,
    itemHint,
    research,
    businessName,
    businessContext,
    offerContract,
    offerScheduleSummary,
    quantityLimit,
    redemptionLimit,
    outputLanguage,
    revisionPreset,
    revisionFeedback,
    previousAd,
    costContext,
  } = params;

  // A previous ad is only passed in on revision calls (see the handler's generateCopy call).
  const isRevision = previousAd !== undefined;

  const copyStartedAt = Date.now();
  const selected = await generateValidatedDealCopy({
    contract: offerContract,
    requestCopy: async ({ attemptNumber, validationFeedback }) => {
      const { system, userText, jsonSchema } = buildAdCopyPrompt({
        itemHint,
        research,
        businessName,
        businessContext,
        offerScheduleSummary,
        quantityLimit,
        redemptionLimit,
        outputLanguage,
        revisionPreset,
        revisionFeedback,
        previousAd,
        offerContract,
        validationFeedback,
      });

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          response_format: { type: "json_schema", json_schema: jsonSchema },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userText },
          ],
          ...chatCompletionTuning(CHAT_MODEL, {
            maxTokens: 650,
            temperature: isRevision ? 0.7 : 0.6,
          }),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        await logAdCost(costContext, {
          feature: "ad_copy",
          model: CHAT_MODEL,
          endpoint: "chat.completions",
          openaiRequestId: openAiRequestIdFromHeaders(res.headers),
          success: false,
          errorCode: `HTTP_${res.status}`,
          errorMessage: body.slice(0, 500),
        });
        throw new Error(`OPENAI_COPY_${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      await logAdCost(costContext, {
        feature: "ad_copy",
        model: CHAT_MODEL,
        endpoint: "chat.completions",
        usage: json?.usage ?? null,
        openaiRequestId: openAiRequestIdFromHeaders(res.headers),
        responseId: typeof json?.id === "string" ? json.id : null,
        success: true,
      });
      const content = json?.choices?.[0]?.message?.content ?? "";
      try {
        return parseAiDealCopyVariants(typeof content === "string" ? content : "{}");
      } catch (e) {
        console.log(
          JSON.stringify({
            tag: "ai_ads_v2",
            event: "copy_parse_error",
            attemptNumber,
            err: String(e).slice(0, 200),
          }),
        );
        return [];
      }
    },
    logValidationFailure: ({ attemptNumber, reasonCodes }) => {
      console.log(
        JSON.stringify({
          tag: "ai_ads_v2",
          event: "copy_validation_failed",
          attemptNumber,
          dealType: offerContract.dealType,
          businessId: offerContract.businessId,
          locationId: offerContract.locationId,
          reasonCodes,
        }),
      );
    },
  });
  const copyLatencyMs = Date.now() - copyStartedAt;
  const shortDescription = clip(selected.short_description, DEAL_COPY_LIMITS.description);

  return {
    headline: clip(selected.headline, DEAL_COPY_LIMITS.headline),
    subheadline: shortDescription,
    short_description: shortDescription,
    push_notification: clip(selected.push_body || selected.push_notification, DEAL_COPY_LIMITS.pushBody),
    terms_summary: clip(selected.terms_summary, DEAL_COPY_LIMITS.terms),
    social_caption: selected.social_caption ? clip(selected.social_caption, DEAL_COPY_LIMITS.socialCaption) : undefined,
    locked_offer_line: selected.locked_offer_line,
    locked_terms_line: selected.locked_terms_line,
    copy_source: selected.copy_source,
    variant_count: selected.variant_count,
    selected_variant_index: selected.selected_variant_index,
    validation_reason_codes: selected.validation_reason_codes,
    fallback_reason: selected.fallback_reason,
    generator_version: selected.generator_version,
    copy_latency_ms: copyLatencyMs,
    cta: defaultCta(outputLanguage),
  };
}

function defaultCta(lang: OutputLanguage): string {
  if (lang === "es") return "Reclamar oferta";
  if (lang === "ko") return "딜 받기";
  return "Claim deal";
}

// ─── Stage 3: image ────────────────────────────────────────────────────────

type SupabaseClient = SupabaseClientBase<any, "public", "public", any, any>;
type AdQuota = { used: number; limit: number; remaining: number };

type AiCostContext = {
  admin: SupabaseClient;
  businessId: string;
  ownerUserId: string;
  requestGroupId: string;
};

async function logAdCost(
  ctx: AiCostContext | null,
  input: {
    feature: string;
    provider?: string;
    model: string;
    endpoint: string;
    usage?: AiUsageInput | null;
    webSearchCalls?: number;
    estimatedCostUsd?: number;
    openaiRequestId?: string | null;
    responseId?: string | null;
    success?: boolean;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  if (!ctx) return;
  await logAiCost(ctx.admin, {
    businessId: ctx.businessId,
    ownerUserId: ctx.ownerUserId,
    requestGroupId: ctx.requestGroupId,
    ...input,
  });
}

async function logImageAttempts(
  ctx: AiCostContext,
  feature: string,
  attempts: readonly OpenAiImageAttempt[],
): Promise<void> {
  for (const attempt of attempts) {
    await logAdCost(ctx, {
      feature,
      model: attempt.model,
      endpoint: attempt.endpoint,
      usage: attempt.usage,
      openaiRequestId: attempt.openaiRequestId,
      responseId: attempt.responseId,
      success: attempt.success,
      errorCode: attempt.errorCode,
      errorMessage: attempt.errorMessage,
    });
  }
}

async function logGeminiImageAttempts(
  ctx: AiCostContext,
  feature: string,
  attempts: readonly GeminiImageAttempt[],
): Promise<void> {
  for (const attempt of attempts) {
    await logAdCost(ctx, {
      feature,
      provider: "gemini",
      model: attempt.model,
      endpoint: attempt.endpoint,
      estimatedCostUsd: attempt.success ? attempt.estimatedCostUsd : 0,
      success: attempt.success,
      errorCode: attempt.errorCode,
      errorMessage: attempt.errorMessage,
    });
  }
}

type ImageQaTelemetry = {
  checked: boolean;
  attempts: number;
  missingItems: string[];
  regenerated: boolean;
  unavailable: boolean;
};

function skippedImageQaTelemetry(): ImageQaTelemetry {
  return {
    checked: false,
    attempts: 0,
    missingItems: [],
    regenerated: false,
    unavailable: false,
  };
}

async function fetchAdQuota(admin: SupabaseClient, businessId: string): Promise<AdQuota> {
  const monthlyLimit = Number.isFinite(DEFAULT_MONTHLY) && DEFAULT_MONTHLY > 0 ? DEFAULT_MONTHLY : 30;
  const { count } = await admin
    .from("ai_generation_logs")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .in("request_type", ["ad_variants", "ad_refine"])
    .eq("openai_called", true)
    .eq("success", true)
    .gte("created_at", utcMonthStartIso());
  const used = count ?? 0;
  return {
    used,
    limit: monthlyLimit,
    remaining: Math.max(0, monthlyLimit - used),
  };
}

function extractResponseOutputText(data: unknown): string | null {
  const out = (data as { output?: unknown[] })?.output;
  if (!Array.isArray(out)) return null;
  for (const item of out) {
    if (!item || typeof item !== "object") continue;
    const message = item as { type?: string; content?: unknown[] };
    if (message.type !== "message" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!part || typeof part !== "object") continue;
      const textPart = part as { type?: string; text?: string };
      if (textPart.type === "output_text" && typeof textPart.text === "string") return textPart.text;
    }
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function imageStylePresetFromRevision(params: {
  revisionPreset?: string;
  revisionFeedback?: string;
  photoTreatment: PhotoTreatment | null;
}): AiImageStylePreset {
  const text = `${params.revisionPreset ?? ""} ${params.revisionFeedback ?? ""}`.toLowerCase();
  if (/\bpremium|editorial|moodier|high[- ]end|upscale\b/i.test(text) || params.photoTreatment === "studiopolish") {
    return "premium-cafe";
  }
  if (/\bplayful|fun|funnier|cheerful\b/i.test(text)) {
    return "playful-twofer";
  }
  return "realistic-local-ad";
}

function requiredOfferItems(contract: DealOfferContract): { paidItem?: string; freeItem?: string } {
  if (contract.dealType === "PERCENT_OFF_SINGLE_ITEM") {
    return { paidItem: contract.singleItemDiscount?.itemName };
  }
  return {
    paidItem: contract.requiredPurchase?.itemName,
    freeItem: contract.freeReward?.itemName,
  };
}

function requestedVisualMotifs(itemHint: string): string[] {
  const cleanHint = itemHint.trim().replace(/\s+/g, " ");
  if (!cleanHint) return [];
  const motifs: string[] = [];
  const pattern = /\b(?:with|featuring|feature|including|include|show|add)\s+(?:an?\s+|the\s+)?([^.,;]+)/gi;
  for (const match of cleanHint.matchAll(pattern)) {
    const phrase = (match[1] ?? "")
      .replace(/\b(in|for|on)\s+the\s+(visual|image|ad|advertisement|poster)\b.*$/i, "")
      .replace(/^(obvious|visible|clear|clearly|prominent|playful)\s+/i, "")
      .trim();
    if (!phrase || phrase.length < 3) continue;
    if (/\b(text|headline|copy|price|discount|percent|off|coupon|code)\b|%/i.test(phrase)) continue;
    motifs.push(phrase.slice(0, 80));
  }
  return motifs.filter((value, index, list) => list.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, 2);
}

function qaRequiredVisualItems(contract: DealOfferContract, itemHint: string): string[] {
  return [...buildRequiredVisualItems(contract), ...requestedVisualMotifs(itemHint)]
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((value, index, list) => list.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, 4);
}

function safeImageMime(mimeType: string | null | undefined): string {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg" || mime === "image/webp" || mime === "image/png") return mime;
  return "image/png";
}

async function uploadGeneratedBytes(params: {
  admin: SupabaseClient;
  businessId: string;
  bytes: Uint8Array;
  contentType: string | null | undefined;
  provider: AiImageProvider;
  ts: number;
  rand: string;
}): Promise<string | null> {
  const path = `${params.businessId}/ai_ad_${params.provider}_${params.ts}_${params.rand}.png`;
  const { error } = await params.admin.storage
    .from("deal-photos")
    .upload(path, params.bytes, { contentType: safeImageMime(params.contentType), upsert: false });
  if (error) {
    console.log(
      JSON.stringify({
        tag: "ai_ads_v2",
        event: "generated_upload_err",
        provider: params.provider,
        err: error.message?.slice(0, 200),
      }),
    );
    return null;
  }
  return path;
}

function detectedItemText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => typeof item === "string" ? item : "")
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

async function findStockImageFallback(params: {
  admin: SupabaseClient;
  requiredVisualItems: readonly string[];
}): Promise<string | null> {
  try {
    const { data, error } = await params.admin
      .from("business_media_assets")
      .select("storage_path, detected_items, quality_score, brand_fit_score")
      .eq("source_type", "twofer_stock")
      .eq("approval_status", "approved")
      .eq("moderation_status", "approved")
      .eq("auto_use_eligible", true)
      .eq("commercial_ad_use_allowed", true)
      .order("quality_score", { ascending: false })
      .limit(25);
    if (error || !Array.isArray(data)) return null;
    const required = params.requiredVisualItems.map((item) => item.trim().toLowerCase()).filter(Boolean);
    const ranked = data
      .map((row) => {
        const storagePath = typeof row.storage_path === "string" ? row.storage_path.trim() : "";
        const detected = detectedItemText(row.detected_items);
        const matches = required.filter((item) => detected.includes(item)).length;
        const quality = typeof row.quality_score === "number" ? row.quality_score : 0;
        const brand = typeof row.brand_fit_score === "number" ? row.brand_fit_score : 0;
        return { storagePath, score: matches * 10 + quality + brand };
      })
      .filter((row) => row.storagePath)
      .sort((left, right) => right.score - left.score);
    return ranked[0]?.storagePath ?? null;
  } catch {
    return null;
  }
}

async function inspectGeneratedImageForOffer(params: {
  openAiKey: string;
  imageBytes: Uint8Array;
  requiredVisualItems: readonly string[];
  costContext: AiCostContext;
}): Promise<QuickDealImageQaResult | null> {
  const requiredVisualItems = params.requiredVisualItems.filter((item) => item.trim().length > 0);
  if (requiredVisualItems.length === 0) return null;

  try {
    const imageUrl = `data:image/png;base64,${bytesToBase64(params.imageBytes)}`;
    const responsesBody = {
      model: CHAT_MODEL,
      ...(isGpt5FamilyModel(CHAT_MODEL) ? {} : { temperature: 0.1 }),
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildQuickDealImageQaPrompt(requiredVisualItems) },
            { type: "input_image", image_url: imageUrl, detail: "low" },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: QUICK_DEAL_IMAGE_QA_SCHEMA.name,
          strict: QUICK_DEAL_IMAGE_QA_SCHEMA.strict,
          schema: QUICK_DEAL_IMAGE_QA_SCHEMA.schema,
        },
      },
    };

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(responsesBody),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      console.log(JSON.stringify({ tag: "ai_ads_v2", event: "image_qa_http", status: res.status }));
      await logAdCost(params.costContext, {
        feature: "image_qa",
        model: CHAT_MODEL,
        endpoint: "responses",
        openaiRequestId: openAiRequestIdFromHeaders(res.headers),
        success: false,
        errorCode: `HTTP_${res.status}`,
        errorMessage: `Image QA failed with HTTP ${res.status}.`,
      });
      return null;
    }
    const json = await res.json();
    await logAdCost(params.costContext, {
      feature: "image_qa",
      model: CHAT_MODEL,
      endpoint: "responses",
      usage: json?.usage ?? null,
      openaiRequestId: openAiRequestIdFromHeaders(res.headers),
      responseId: typeof json?.id === "string" ? json.id : null,
      success: true,
    });
    const text = extractResponseOutputText(json);
    if (!text) return null;
    return normalizeQuickDealImageQaResult(JSON.parse(text), requiredVisualItems);
  } catch (e) {
    console.log(JSON.stringify({ tag: "ai_ads_v2", event: "image_qa_error", err: String(e).slice(0, 200) }));
    await logAdCost(params.costContext, {
      feature: "image_qa",
      model: CHAT_MODEL,
      endpoint: "responses",
      success: false,
      errorCode: "FETCH_ERROR",
      errorMessage: String(e).slice(0, 500),
    });
    return null;
  }
}

type OpenAiProducedImage = {
  posterStoragePath: string | null;
  source: SingleAd["photo_source"];
  treatment: PhotoTreatment | null;
  prompt: string | null;
  qa: ImageQaTelemetry;
};

type ProducedImage = OpenAiProducedImage & {
  provider: AiImageProvider;
  model: string | null;
  estimatedCostUsd: number;
};

async function produceImageOpenAiOnly(params: {
  openAiKey: string;
  admin: SupabaseClient;
  userClient: SupabaseClient;
  businessId: string;
  photoPath: string | null;
  photoTreatment: PhotoTreatment | null;
  research: ItemResearch;
  itemHint: string;
  businessName: string;
  offerContract: DealOfferContract;
  costContext: AiCostContext;
}): Promise<OpenAiProducedImage> {
  const {
    openAiKey,
    admin,
    userClient,
    businessId,
    photoPath,
    photoTreatment,
    research,
    itemHint,
    businessName,
    offerContract,
    costContext,
  } = params;

  const ts = Date.now();
  const rand = crypto.randomUUID().slice(0, 8);
  const skippedQa = skippedImageQaTelemetry();

  // Path A — owner uploaded a photo
  if (photoPath) {
    if (!photoTreatment) {
      // No enhancement: copy the uploaded photo to a stable poster path
      // (the original is already in deal-photos; we just point the ad at it)
      return {
        posterStoragePath: photoPath,
        source: "uploaded_original",
        treatment: null,
        prompt: null,
        qa: skippedQa,
      };
    }

    const { data: signed, error: signedErr } = await userClient.storage
      .from("deal-photos")
      .createSignedUrl(photoPath, 60 * 60);
    if (signedErr || !signed?.signedUrl) {
      console.log(
        JSON.stringify({
          tag: "ai_ads_v2",
          event: "photo_signed_url_failed",
          err: signedErr?.message?.slice(0, 200),
        }),
      );
      return { posterStoragePath: photoPath, source: "uploaded_original", treatment: null, prompt: null, qa: skippedQa };
    }

    let imageBytes: Uint8Array;
    let imageMime = "image/png";
    try {
      const fetched = await fetch(signed.signedUrl);
      if (!fetched.ok) {
        return { posterStoragePath: photoPath, source: "uploaded_original", treatment: null, prompt: null, qa: skippedQa };
      }
      imageMime = fetched.headers.get("content-type") || "image/png";
      imageBytes = new Uint8Array(await fetched.arrayBuffer());
    } catch {
      return { posterStoragePath: photoPath, source: "uploaded_original", treatment: null, prompt: null, qa: skippedQa };
    }

    const enhancedResult = await enhanceUploadedPhotoWithTelemetry({
      openAiKey,
      imageBytes,
      imageMime,
      treatment: photoTreatment,
    });
    await logImageAttempts(costContext, "image_edit", enhancedResult.attempts);
    const enhanced = enhancedResult.bytes;

    if (!enhanced) {
      // Enhancement failed — fall back to the original photo so the user still gets an ad
      return { posterStoragePath: photoPath, source: "uploaded_original", treatment: null, prompt: null, qa: skippedQa };
    }

    const enhancedPath = `${businessId}/ai_ad_enhanced_${photoTreatment}_${ts}_${rand}.png`;
    const { error: upErr } = await admin.storage
      .from("deal-photos")
      .upload(enhancedPath, enhanced, { contentType: "image/png", upsert: false });
    if (upErr) {
      console.log(
        JSON.stringify({
          tag: "ai_ads_v2",
          event: "enhanced_upload_err",
          err: upErr.message?.slice(0, 200),
        }),
      );
      return { posterStoragePath: photoPath, source: "uploaded_original", treatment: null, prompt: null, qa: skippedQa };
    }
    return { posterStoragePath: enhancedPath, source: "uploaded_enhanced", treatment: photoTreatment, prompt: null, qa: skippedQa };
  }

  // Path B — no photo: generate via OpenAI Images (GPT image model)
  const requiredVisualItems = qaRequiredVisualItems(offerContract, itemHint);
  const itemName = requiredVisualItems.length > 0
    ? requiredVisualItems.join(" and ")
    : research.item_name || itemHint || "menu item";
  const prompt = buildPhotoAdImagePrompt({
    itemName,
    itemDescription: research.is_familiar ? research.description : "",
    businessName,
    requiredVisualItems,
  });
  let imageGeneration = await generatePhotoAdImageWithTelemetry(openAiKey, prompt);
  await logImageAttempts(costContext, "image_generation", imageGeneration.attempts);
  let png = imageGeneration.bytes;
  const qa: ImageQaTelemetry = {
    checked: requiredVisualItems.length > 1,
    attempts: 0,
    missingItems: [],
    regenerated: false,
    unavailable: false,
  };
  if (!png) {
    return { posterStoragePath: null, source: "generated", treatment: null, prompt, qa };
  }

  if (requiredVisualItems.length > 0) {
    const firstQa = await inspectGeneratedImageForOffer({
      openAiKey,
      imageBytes: png,
      requiredVisualItems,
      costContext,
    });
    qa.attempts = 1;
    if (!firstQa) {
      qa.unavailable = true;
    } else if (!firstQa.all_required_items_present) {
      qa.missingItems = firstQa.missing_items;
      console.log(
        JSON.stringify({
          tag: "ai_ads_v2",
          event: "image_missing_required_item",
          businessId,
          missingItems: qa.missingItems,
        }),
      );
      const retryPrompt = buildQuickDealImageRegenerationPrompt({
        basePrompt: prompt,
        requiredVisualItems,
        missingItems: firstQa.missing_items,
      });
      const retryGeneration = await generatePhotoAdImageWithTelemetry(openAiKey, retryPrompt);
      await logImageAttempts(costContext, "image_generation_retry", retryGeneration.attempts);
      const retryPng = retryGeneration.bytes;
      if (retryPng) {
        qa.regenerated = true;
        const retryQa = await inspectGeneratedImageForOffer({
          openAiKey,
          imageBytes: retryPng,
          requiredVisualItems,
          costContext,
        });
        qa.attempts = 2;
        if (!retryQa) {
          qa.unavailable = true;
          png = retryPng;
        } else if (retryQa.all_required_items_present || retryQa.missing_items.length <= firstQa.missing_items.length) {
          qa.missingItems = retryQa.missing_items;
          png = retryPng;
        }
      }
    }
  }
  if (qa.missingItems.length > 0 && !qa.unavailable) {
    return { posterStoragePath: null, source: "generated", treatment: null, prompt, qa };
  }
  const generatedPath = `${businessId}/ai_ad_generated_${ts}_${rand}.png`;
  const { error: upErr } = await admin.storage
    .from("deal-photos")
    .upload(generatedPath, png, { contentType: "image/png", upsert: false });
  if (upErr) {
    console.log(
      JSON.stringify({
        tag: "ai_ads_v2",
        event: "generated_upload_err",
        err: upErr.message?.slice(0, 200),
      }),
    );
    return { posterStoragePath: null, source: "generated", treatment: null, prompt, qa };
  }
  return { posterStoragePath: generatedPath, source: "generated", treatment: null, prompt, qa };
}

function withOpenAiImageMetadata(result: OpenAiProducedImage): ProducedImage {
  const usedOpenAiImage =
    result.source === "uploaded_enhanced" || result.source === "generated" || result.posterStoragePath === null;
  return {
    ...result,
    provider: usedOpenAiImage ? "openai" : "none",
    model: usedOpenAiImage ? RESOLVED_IMAGE_GENERATE_MODEL : null,
    estimatedCostUsd: 0,
  };
}

async function produceFallbackImage(params: {
  admin: SupabaseClient;
  prompt: string | null;
  qa: ImageQaTelemetry;
  requiredVisualItems: readonly string[];
  imageProviderConfig: AiImageProviderConfig;
}): Promise<ProducedImage> {
  if (params.imageProviderConfig.stockFallbackEnabled) {
    const stockPath = await findStockImageFallback({
      admin: params.admin,
      requiredVisualItems: params.requiredVisualItems,
    });
    if (stockPath) {
      return {
        posterStoragePath: stockPath,
        source: "stock",
        treatment: null,
        prompt: params.prompt,
        qa: params.qa,
        provider: "stock",
        model: null,
        estimatedCostUsd: 0,
      };
    }
  }

  return {
    posterStoragePath: null,
    source: "copy_only",
    treatment: null,
    prompt: params.prompt,
    qa: params.qa,
    provider: "none",
    model: null,
    estimatedCostUsd: 0,
  };
}

async function produceImage(params: {
  openAiKey: string;
  geminiApiKey: string | null | undefined;
  admin: SupabaseClient;
  userClient: SupabaseClient;
  businessId: string;
  photoPath: string | null;
  photoTreatment: PhotoTreatment | null;
  research: ItemResearch;
  itemHint: string;
  businessName: string;
  businessCategory?: string;
  offerContract: DealOfferContract;
  revisionPreset?: string;
  revisionFeedback?: string;
  imageProviderConfig: AiImageProviderConfig;
  costContext: AiCostContext;
}): Promise<ProducedImage> {
  const requiredVisualItems = qaRequiredVisualItems(params.offerContract, params.itemHint);
  const originalUploadedPhoto = (): ProducedImage => ({
    posterStoragePath: params.photoPath,
    source: "uploaded_original",
    treatment: null,
    prompt: null,
    qa: skippedImageQaTelemetry(),
    provider: "none",
    model: null,
    estimatedCostUsd: 0,
  });
  const openAiFallback = async (): Promise<ProducedImage> => {
    const result = await produceImageOpenAiOnly(params);
    const withMetadata = withOpenAiImageMetadata(result);
    if (withMetadata.posterStoragePath || withMetadata.source === "uploaded_original") {
      return withMetadata;
    }
    return produceFallbackImage({
      admin: params.admin,
      prompt: withMetadata.prompt,
      qa: withMetadata.qa,
      requiredVisualItems,
      imageProviderConfig: params.imageProviderConfig,
    });
  };

  if (params.imageProviderConfig.primaryProvider === "openai") {
    return openAiFallback();
  }

  if (params.imageProviderConfig.primaryProvider === "stock") {
    return produceFallbackImage({
      admin: params.admin,
      prompt: null,
      qa: skippedImageQaTelemetry(),
      requiredVisualItems,
      imageProviderConfig: params.imageProviderConfig,
    });
  }

  if (params.imageProviderConfig.primaryProvider === "none") {
    return {
      posterStoragePath: null,
      source: "copy_only",
      treatment: null,
      prompt: null,
      qa: skippedImageQaTelemetry(),
      provider: "none",
      model: null,
      estimatedCostUsd: 0,
    };
  }

  const useOpenAiFallback = params.imageProviderConfig.fallbackProvider === "openai";
  const ts = Date.now();
  const rand = crypto.randomUUID().slice(0, 8);
  const offerItems = requiredOfferItems(params.offerContract);
  const stylePreset = imageStylePresetFromRevision({
    revisionPreset: params.revisionPreset,
    revisionFeedback: params.revisionFeedback,
    photoTreatment: params.photoTreatment,
  });
  const prompt = buildGeminiAdImagePrompt({
    businessId: params.businessId,
    businessName: params.businessName,
    businessCategory: params.businessCategory,
    offerTitle: params.offerContract.canonicalOfferLine,
    offerDescription: params.offerContract.canonicalShortTerms,
    paidItem: offerItems.paidItem,
    freeItem: offerItems.freeItem,
    dealType: params.offerContract.dealType,
    visualNotes: params.itemHint,
    stylePreset,
    aspectRatio: "1:1",
    imageSize: "1K",
  });

  if (params.photoPath) {
    if (!params.photoTreatment) {
      return originalUploadedPhoto();
    }
    if (!params.imageProviderConfig.ownerPhotoReferenceEnabled) {
      return useOpenAiFallback ? openAiFallback() : originalUploadedPhoto();
    }

    const skippedQa = skippedImageQaTelemetry();
    const { data: signed, error: signedErr } = await params.userClient.storage
      .from("deal-photos")
      .createSignedUrl(params.photoPath, 60 * 60);
    if (signedErr || !signed?.signedUrl) {
      console.log(
        JSON.stringify({
          tag: "ai_ads_v2",
          event: "gemini_photo_signed_url_failed",
          err: signedErr?.message?.slice(0, 200),
        }),
      );
      return useOpenAiFallback ? openAiFallback() : originalUploadedPhoto();
    }

    let imageBytes: Uint8Array | null = null;
    let imageMime = "image/png";
    try {
      const fetched = await fetch(signed.signedUrl);
      if (fetched.ok) {
        imageMime = fetched.headers.get("content-type") || "image/png";
        imageBytes = new Uint8Array(await fetched.arrayBuffer());
      }
    } catch {
      imageBytes = null;
    }
    if (!imageBytes) {
      return useOpenAiFallback ? openAiFallback() : originalUploadedPhoto();
    }

    const photoPrompt = buildGeminiAdImagePrompt({
      businessId: params.businessId,
      businessName: params.businessName,
      businessCategory: params.businessCategory,
      offerTitle: params.offerContract.canonicalOfferLine,
      offerDescription: params.offerContract.canonicalShortTerms,
      paidItem: offerItems.paidItem,
      freeItem: offerItems.freeItem,
      dealType: params.offerContract.dealType,
      visualNotes: params.itemHint,
      referenceImages: [{ mimeType: safeImageMime(imageMime), base64: bytesToBase64(imageBytes) }],
      stylePreset,
      aspectRatio: "1:1",
      imageSize: "1K",
    });
    const gemini = await generateGeminiAdImageWithTelemetry({
      apiKey: params.geminiApiKey,
      model: params.imageProviderConfig.geminiModel,
      prompt: photoPrompt,
      aspectRatio: "1:1",
      imageSize: "1K",
      estimatedCostUsd: params.imageProviderConfig.geminiEstimatedCost1KUsd,
      referenceImages: [{ mimeType: safeImageMime(imageMime), base64: bytesToBase64(imageBytes) }],
    });
    await logGeminiImageAttempts(params.costContext, "image_edit", gemini.attempts);

    if (!gemini.bytes) {
      return useOpenAiFallback ? openAiFallback() : originalUploadedPhoto();
    }

    const enhancedPath = await uploadGeneratedBytes({
      admin: params.admin,
      businessId: params.businessId,
      bytes: gemini.bytes,
      contentType: gemini.mimeType,
      provider: "gemini",
      ts,
      rand,
    });
    if (!enhancedPath) {
      return useOpenAiFallback ? openAiFallback() : originalUploadedPhoto();
    }
    return {
      posterStoragePath: enhancedPath,
      source: "uploaded_enhanced",
      treatment: params.photoTreatment,
      prompt: gemini.prompt,
      qa: skippedQa,
      provider: "gemini",
      model: gemini.model,
      estimatedCostUsd: gemini.estimatedCostUsd,
    };
  }

  const gemini = await generateGeminiAdImageWithTelemetry({
    apiKey: params.geminiApiKey,
    model: params.imageProviderConfig.geminiModel,
    prompt,
    aspectRatio: "1:1",
    imageSize: "1K",
    estimatedCostUsd: params.imageProviderConfig.geminiEstimatedCost1KUsd,
  });
  await logGeminiImageAttempts(params.costContext, "image_generation", gemini.attempts);
  let imageBytes = gemini.bytes;
  let imageMimeType = gemini.mimeType;
  let imagePrompt = gemini.prompt;
  let estimatedCostUsd = gemini.estimatedCostUsd;
  const qa: ImageQaTelemetry = {
    checked: requiredVisualItems.length > 0,
    attempts: 0,
    missingItems: [],
    regenerated: gemini.attempts.some((attempt) => attempt.retry && attempt.success),
    unavailable: false,
  };

  if (imageBytes && requiredVisualItems.length > 0) {
    const firstQa = await inspectGeneratedImageForOffer({
      openAiKey: params.openAiKey,
      imageBytes,
      requiredVisualItems,
      costContext: params.costContext,
    });
    qa.attempts = 1;
    if (!firstQa) {
      qa.unavailable = true;
    } else if (!firstQa.all_required_items_present) {
      qa.missingItems = firstQa.missing_items;
      console.log(
        JSON.stringify({
          tag: "ai_ads_v2",
          event: "gemini_image_missing_required_item",
          businessId: params.businessId,
          missingItems: qa.missingItems,
        }),
      );
      const retryPrompt = buildQuickDealImageRegenerationPrompt({
        basePrompt: gemini.prompt,
        requiredVisualItems,
        missingItems: firstQa.missing_items,
      });
      const retryGeneration = await generateGeminiAdImageWithTelemetry({
        apiKey: params.geminiApiKey,
        model: params.imageProviderConfig.geminiModel,
        prompt: retryPrompt,
        aspectRatio: "1:1",
        imageSize: "1K",
        estimatedCostUsd: params.imageProviderConfig.geminiEstimatedCost1KUsd,
        retryOnFailure: false,
      });
      await logGeminiImageAttempts(params.costContext, "image_generation_retry", retryGeneration.attempts);
      if (retryGeneration.bytes) {
        qa.regenerated = true;
        const retryQa = await inspectGeneratedImageForOffer({
          openAiKey: params.openAiKey,
          imageBytes: retryGeneration.bytes,
          requiredVisualItems,
          costContext: params.costContext,
        });
        qa.attempts = 2;
        if (!retryQa) {
          qa.unavailable = true;
          imageBytes = retryGeneration.bytes;
          imageMimeType = retryGeneration.mimeType;
          imagePrompt = retryGeneration.prompt;
          estimatedCostUsd += retryGeneration.estimatedCostUsd;
        } else if (retryQa.all_required_items_present || retryQa.missing_items.length < firstQa.missing_items.length) {
          qa.missingItems = retryQa.missing_items;
          imageBytes = retryGeneration.bytes;
          imageMimeType = retryGeneration.mimeType;
          imagePrompt = retryGeneration.prompt;
          estimatedCostUsd += retryGeneration.estimatedCostUsd;
        }
      }
    }
  }
  if (qa.missingItems.length > 0 && !qa.unavailable) {
    imageBytes = null;
    imageMimeType = null;
  }

  if (imageBytes) {
    const generatedPath = await uploadGeneratedBytes({
      admin: params.admin,
      businessId: params.businessId,
      bytes: imageBytes,
      contentType: imageMimeType,
      provider: "gemini",
      ts,
      rand,
    });
    if (generatedPath) {
      return {
        posterStoragePath: generatedPath,
        source: "generated",
        treatment: null,
        prompt: imagePrompt,
        qa,
        provider: "gemini",
        model: gemini.model,
        estimatedCostUsd,
      };
    }
  }

  if (useOpenAiFallback) {
    const result = await openAiFallback();
    if (result.posterStoragePath || result.source === "stock" || result.source === "copy_only") {
      return result;
    }
  }

  return produceFallbackImage({
    admin: params.admin,
    prompt,
    qa,
    requiredVisualItems,
    imageProviderConfig: params.imageProviderConfig,
  });
}

// ─── Strong-deal phrase guarantee ──────────────────────────────────────────
// Mirror of lib/strong-deal-guard.ts. The publish guard (client + server)
// rejects copy that lacks an explicit strong-deal phrase. The model is told to
// include one, but we also guarantee it deterministically so a generated ad can
// never be blocked at publish. Every token below is accepted by both guards.
const STRONG_PHRASE_RE =
  /\bbogo\b|\b2\s*[- ]?\s*for\s*[- ]?\s*1\b|\btwo\s*for\s*one\b|\bbuy\s*one\s*get\s*one\b|\bget\s+one\s+free\b|(?:^|\s)free\b|\bon\s+the\s+house\b|\bcomplimentary\b|\b(?:4\d|[5-9]\d|100)\s*%\s*off\b|\bgratis\b|\b2\s*(?:x|por)\s*1\b|무료|반값|1\s*\+\s*1/i;

function offerFallbackSubline(lang: "en" | "es" | "ko", item: string): string {
  const it = item.trim().slice(0, 30);
  if (lang === "es") {
    return clip(it ? `Compra uno y llévate otro ${it} gratis.` : "Compra uno y llévate otro gratis.", 88);
  }
  if (lang === "ko") {
    return clip(it ? `${it} 하나 사면 하나 무료.` : "하나 사면 하나 무료.", 88);
  }
  return clip(it ? `Buy one ${it}, get one free.` : "Buy one, get one free.", 88);
}

/** Guarantee the copy carries a publishable offer phrase; rewrite the subline if not. */
function ensureOfferPhrase(
  copy: Pick<SingleAd, "headline" | "subheadline" | "short_description" | "push_notification" | "terms_summary" | "cta">,
  lang: OutputLanguage,
  item: string,
): Pick<SingleAd, "headline" | "subheadline" | "short_description" | "push_notification" | "terms_summary" | "cta"> {
  if (STRONG_PHRASE_RE.test(`${copy.headline} ${copy.subheadline} ${copy.terms_summary} ${copy.cta}`)) {
    return copy;
  }
  const fallback = offerFallbackSubline(lang, item);
  return { ...copy, subheadline: fallback, short_description: fallback };
}

function offerTelemetry(contract: DealOfferContract) {
  return {
    deal_type: contract.dealType,
    customer_value_percent: contract.customerValuePercent,
    required_purchase: contract.requiredPurchase
      ? {
          quantity: contract.requiredPurchase.quantity,
          item_name: contract.requiredPurchase.itemName,
        }
      : null,
    free_reward: contract.freeReward
      ? {
          quantity: contract.freeReward.quantity,
          item_name: contract.freeReward.itemName,
          discount_percent: contract.freeReward.discountPercent,
        }
      : null,
    single_item_discount: contract.singleItemDiscount
      ? {
          item_name: contract.singleItemDiscount.itemName,
          discount_percent: contract.singleItemDiscount.discountPercent,
        }
      : null,
  };
}

function copyRepairAttemptCount(source: AiDealCopySource | undefined): number {
  if (source === "AI_RETRY_VALIDATED") return 1;
  if (source === "DETERMINISTIC_FALLBACK") return 2;
  return 0;
}

function buildGenerationTelemetry(params: {
  offerContract: DealOfferContract;
  copy: Pick<SingleAd, "headline" | "short_description" | "copy_source" | "variant_count" | "selected_variant_index" | "validation_reason_codes"> & {
    fallback_reason?: string;
    generator_version?: string;
    copy_latency_ms?: number;
  };
  imageResult: Awaited<ReturnType<typeof produceImage>>;
  productionSuccess: boolean;
}) {
  const { offerContract, copy, imageResult, productionSuccess } = params;
  const validationRuleIds = copy.validation_reason_codes ?? [];
  const repairAttempts = copyRepairAttemptCount(copy.copy_source);
  const deterministicFallbackUsed = copy.copy_source === "DETERMINISTIC_FALLBACK";
  const events = ["quick_deal_ai_generated"];
  if (validationRuleIds.length > 0) events.push("quick_deal_ai_validation_failed");
  if (repairAttempts > 0) events.push("quick_deal_ai_repair_attempted");
  if (deterministicFallbackUsed) events.push("quick_deal_ai_fallback_used");
  if (imageResult.qa.missingItems.length > 0) events.push("quick_deal_ai_image_missing_required_item");

  return {
    events,
    success: productionSuccess,
    structured_offer: offerTelemetry(offerContract),
    generated: {
      headline: copy.headline,
      offer: copy.short_description,
      image_prompt: imageResult.prompt,
    },
    image_generation: {
      source: imageResult.source,
      treatment: imageResult.treatment,
      provider: imageResult.provider,
      model: imageResult.model,
      estimated_cost_usd: imageResult.estimatedCostUsd,
      produced_image: imageResult.posterStoragePath !== null,
    },
    required_visual_items: buildRequiredVisualItems(offerContract),
    validation_rule_ids: validationRuleIds,
    repair_attempts: repairAttempts,
    deterministic_fallback_used: deterministicFallbackUsed,
    copy: {
      source: copy.copy_source ?? null,
      variant_count: copy.variant_count ?? null,
      selected_variant_index: copy.selected_variant_index ?? null,
      generator_version: copy.generator_version ?? null,
      latency_ms: copy.copy_latency_ms ?? null,
      fallback_reason: copy.fallback_reason ?? null,
      validation_failure_count: validationRuleIds.length,
    },
    image_qa: imageResult.qa,
  };
}

// ─── HTTP handler ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    const imageProviderConfig = resolveAiImageProviderConfig();

    const userClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized. Please log in." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON in request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const businessId = typeof body.business_id === "string" ? body.business_id.trim() : "";
    if (!businessId) {
      return new Response(JSON.stringify({ error: "Missing business_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const quotaStatusOnly = body.quota_status_only === true || body.action === "quota_status";

    const photoPath = typeof body.photo_path === "string" ? body.photo_path.trim() : "";
    const hintText = typeof body.hint_text === "string" ? body.hint_text.trim() : "";
    const photoTreatmentRaw = typeof body.photo_treatment === "string"
      ? body.photo_treatment.trim().toLowerCase()
      : "";
    const photoTreatment: PhotoTreatment | null =
      VALID_PHOTO_TREATMENTS.has(photoTreatmentRaw as PhotoTreatment)
        ? (photoTreatmentRaw as PhotoTreatment)
        : null;

    const businessContext: BusinessContext =
      body.business_context && typeof body.business_context === "object" && !Array.isArray(body.business_context)
        ? (body.business_context as BusinessContext)
        : {};

    const offerScheduleSummary = typeof body.offer_schedule_summary === "string"
      ? body.offer_schedule_summary.trim().slice(0, 500)
      : "";
    const rawQuantityLimit = typeof body.quantity_limit === "number"
      ? body.quantity_limit
      : typeof body.quantity_limit === "string"
      ? Number(body.quantity_limit)
      : NaN;
    const quantityLimit = Number.isFinite(rawQuantityLimit) && rawQuantityLimit > 0
      ? Math.floor(rawQuantityLimit)
      : null;

    const redemptionLimit = typeof body.redemption_limit === "string"
      ? body.redemption_limit.trim().slice(0, 300)
      : "";

    const rawOutLang = typeof body.output_language === "string"
      ? body.output_language.trim().toLowerCase()
      : "en";
    const outputLanguage: OutputLanguage =
      rawOutLang === "es" || rawOutLang === "ko" ? rawOutLang : "en";
    const requestGroupId =
      typeof body.request_group_id === "string" && /^[0-9a-f-]{36}$/i.test(body.request_group_id.trim())
        ? body.request_group_id.trim()
        : crypto.randomUUID();

    const previousAdRaw = body.previous_ad;
    const revisionTargetRaw = typeof body.revision_target === "string"
      ? body.revision_target.trim().toLowerCase()
      : "";
    const revisionTarget: RevisionTarget | null =
      VALID_REVISION_TARGETS.has(revisionTargetRaw as RevisionTarget)
        ? (revisionTargetRaw as RevisionTarget)
        : null;
    const revisionPreset = typeof body.revision_preset === "string"
      ? body.revision_preset.trim().slice(0, 200)
      : "";
    const revisionFeedback = typeof body.revision_feedback === "string"
      ? body.revision_feedback.trim().slice(0, 800)
      : "";

    /** Strict object-not-array narrowing — protects coerceSingleAd from `previous_ad: []` exploits. */
    const previousAdIsObject =
      !!previousAdRaw && typeof previousAdRaw === "object" && !Array.isArray(previousAdRaw);
    const isRevision: boolean = revisionTarget !== null && previousAdIsObject;
    if (!quotaStatusOnly && !isRevision && !photoPath && !hintText) {
      return new Response(
        JSON.stringify({ error: "Provide at least a photo or a description of the offer." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Ownership check — must run before any expensive work
    const { data: business, error: bizErr } = await userClient
      .from("businesses")
      .select("id, owner_id, name")
      .eq("id", businessId)
      .single();
    if (bizErr || !business || business.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: "You do not own this business." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const businessName = typeof business.name === "string" ? business.name : "";

    if (quotaStatusOnly) {
      const quota = await fetchAdQuota(admin, businessId);
      return new Response(JSON.stringify({ ok: true, quota }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eligibilityInput = parseDealEligibilityInput(body.deal_eligibility);
    const eligibilityResponse = dealNotEligibleForAiResponse(eligibilityInput, corsHeaders);
    if (eligibilityResponse) return eligibilityResponse;
    const eligibilityResult = validateDealEligibility(eligibilityInput!);
    const offerContract = buildDealOfferContract({
      businessId,
      businessName,
      locationId: businessId,
      locationName: businessContext.address || businessContext.location || businessName,
      dealEligibility: eligibilityInput!,
      eligibilityResult,
      activeWindowHumanReadable: offerScheduleSummary,
      quantityLimit,
    });
    if (!offerContract) {
      return new Response(
        JSON.stringify({
          error: "DEAL_NOT_ELIGIBLE_FOR_AI",
          error_code: "DEAL_NOT_ELIGIBLE_FOR_AI",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    /**
     * Path-traversal guard: clients must only operate on photos under their own business folder.
     * Without this, a malicious client could pass `other-business-id/some.png` and either generate
     * an ad against another tenant's product photo, or have it republished as their own poster.
     */
    if (photoPath && !photoPath.startsWith(`${businessId}/`)) {
      return new Response(
        JSON.stringify({ error: "Invalid photo path." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Quota: monthly limit
    const startingQuota = await fetchAdQuota(admin, businessId);
    if (startingQuota.used >= startingQuota.limit) {
      return new Response(
        JSON.stringify({
          error: `Monthly AI limit reached (${startingQuota.limit}). Resets on the 1st.`,
          error_code: "MONTHLY_LIMIT",
          quota: { ...startingQuota, remaining: 0 },
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    /**
     * Cooldown — applied to BOTH initial generations and revisions to prevent abuse.
     * Revisions get a much shorter window (10s) because the user is actively iterating;
     * initial generations get the full configured cooldown.
     */
    const cooldownMs = isRevision ? 10_000 : Math.max(10, COOLDOWN_SEC) * 1000;
    const { data: recentCall } = await admin
      .from("ai_generation_logs")
      .select("id, created_at")
      .eq("business_id", businessId)
      .in("request_type", ["ad_variants", "ad_refine"])
      .eq("success", true)
      .gte("created_at", new Date(Date.now() - cooldownMs).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentCall) {
      const elapsedMs = Date.now() - new Date(recentCall.created_at as string).getTime();
      const waitSeconds = Math.max(1, Math.ceil((cooldownMs - elapsedMs) / 1000));
      return new Response(
        JSON.stringify({
          error: `Please wait ${waitSeconds}s before generating again.`,
          error_code: "COOLDOWN_ACTIVE",
          wait_seconds: waitSeconds,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    /**
     * Revision-cap — derived server-side from logs (NOT trusted from client).
     * Counts ad_refine rows since the most recent ad_variants row for this business.
     * Without this, a client could send revision_count: 0 forever to bypass the cap.
     */
    let derivedRevisionCount = 0;
    if (isRevision) {
      const { data: lastInitial } = await admin
        .from("ai_generation_logs")
        .select("created_at")
        .eq("business_id", businessId)
        .eq("request_type", "ad_variants")
        .eq("success", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const sinceIso = lastInitial?.created_at
        ? new Date(lastInitial.created_at as string).toISOString()
        : new Date(Date.now() - 60 * 60 * 1000).toISOString(); // fallback: last hour
      const { count: refineCount } = await admin
        .from("ai_generation_logs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("request_type", "ad_refine")
        .eq("success", true)
        .gte("created_at", sinceIso);
      derivedRevisionCount = refineCount ?? 0;
      if (derivedRevisionCount >= MAX_REVISION_COUNT) {
        return new Response(
          JSON.stringify({
            error: "You've revised this ad enough times. Start fresh with a new offer.",
            error_code: "REVISION_LIMIT",
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (!openAiKey) {
      return new Response(
        JSON.stringify({
          error: "AI is not configured for this account. Contact support.",
          error_code: "OPENAI_KEY_MISSING",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build a SingleAd by running the right stages ──
    const costContext: AiCostContext = {
      admin,
      businessId,
      ownerUserId: user.id,
      requestGroupId,
    };

    const previousAd = isRevision ? coerceSingleAd(previousAdRaw as Record<string, unknown>) : null;
    const sourceHint = hintText || previousAd?.item_research.item_name || "";

    let research: ItemResearch;
    if (isRevision && previousAd) {
      // Reuse research from the previous ad — revisions iterate, they don't re-look up
      research = previousAd.item_research;
    } else {
      research = await researchMenuItem({
        openAiKey,
        itemHint: sourceHint,
        businessName,
        businessLocation: businessContext.location ?? "",
        costContext,
      });
    }

    let copy: Pick<SingleAd, "headline" | "subheadline" | "short_description" | "push_notification" | "terms_summary" | "social_caption" | "locked_offer_line" | "locked_terms_line" | "copy_source" | "variant_count" | "selected_variant_index" | "validation_reason_codes" | "cta"> & {
      fallback_reason?: string;
      generator_version?: string;
      copy_latency_ms?: number;
    };
    if (isRevision && previousAd && revisionTarget === "image") {
      // Image-only revision: keep copy
      copy = {
        headline: previousAd.headline,
        subheadline: previousAd.subheadline,
        short_description: previousAd.short_description || previousAd.subheadline,
        push_notification: previousAd.push_notification || previousAd.headline,
        terms_summary: offerContract.canonicalShortTerms,
        social_caption: previousAd.social_caption,
        locked_offer_line: offerContract.canonicalOfferLine,
        locked_terms_line: offerContract.canonicalShortTerms,
        copy_source: previousAd.copy_source,
        variant_count: previousAd.variant_count,
        selected_variant_index: previousAd.selected_variant_index,
        validation_reason_codes: previousAd.validation_reason_codes,
        cta: previousAd.cta,
      };
    } else {
      try {
        copy = await generateCopy({
          openAiKey,
          itemHint: sourceHint,
          research,
          businessName,
          businessContext,
          offerContract,
          offerScheduleSummary,
          quantityLimit,
          redemptionLimit,
          outputLanguage,
          revisionPreset: revisionPreset || undefined,
          revisionFeedback: revisionFeedback || undefined,
          previousAd: previousAd ?? undefined,
          costContext,
        });
      } catch (e) {
        console.log(
          JSON.stringify({ tag: "ai_ads_v2", event: "copy_error", err: String(e).slice(0, 300) }),
        );
        await admin.from("ai_generation_logs").insert({
          business_id: businessId,
          user_id: user.id,
          request_type: "ad_variants",
          input_mode: photoPath ? "photo" : "text",
          request_hash: "copy_error_v3",
          prompt_version: AD_COPY_PROMPT_VERSION,
          model: CHAT_MODEL,
          success: false,
          failure_reason: String(e).slice(0, 100),
          openai_called: true,
          response_payload: {
            events: ["quick_deal_ai_generation_failed"],
            stage: "copy",
            structured_offer: offerTelemetry(offerContract),
          },
        });
        return new Response(
          JSON.stringify({ error: "AI copy generation failed. Tap try again.", error_code: "COPY_FAILED" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    let imageResult: Awaited<ReturnType<typeof produceImage>>;
    if (isRevision && previousAd && revisionTarget === "copy" && previousAd.poster_storage_path) {
      // Copy-only revision: keep the existing image. If there is no existing image,
      // fall through to image generation because every deal must have an image.
      imageResult = {
        posterStoragePath: previousAd.poster_storage_path ?? null,
        source: previousAd.photo_source === "copy_only" ? "generated" : previousAd.photo_source,
        treatment: previousAd.photo_treatment,
        prompt: null,
        qa: skippedImageQaTelemetry(),
        provider: previousAd.photo_source === "stock" ? "stock" : "none",
        model: null,
        estimatedCostUsd: 0,
      };
    } else {
      imageResult = await produceImage({
        openAiKey,
        geminiApiKey,
        admin,
        userClient,
        businessId,
        photoPath: photoPath || null,
        photoTreatment,
        research,
        itemHint: sourceHint,
        businessName,
        businessCategory: businessContext.category,
        offerContract,
        revisionPreset: revisionPreset || undefined,
        revisionFeedback: revisionFeedback || undefined,
        imageProviderConfig,
        costContext,
      });
    }

    const ad: SingleAd = {
      headline: copy.headline,
      subheadline: copy.subheadline,
      short_description: copy.short_description,
      push_notification: copy.push_notification,
      terms_summary: copy.terms_summary,
      social_caption: copy.social_caption,
      locked_offer_line: copy.locked_offer_line,
      locked_terms_line: copy.locked_terms_line,
      copy_source: copy.copy_source,
      variant_count: copy.variant_count,
      selected_variant_index: copy.selected_variant_index,
      validation_reason_codes: copy.validation_reason_codes,
      cta: copy.cta,
      item_research: research,
      photo_source: imageResult.source,
      photo_treatment: imageResult.treatment,
      poster_storage_path: imageResult.posterStoragePath,
    };

    /**
     * Copy-only is an intentional fallback when every image source fails. Unexpected null-image
     * states still fail closed so they do not burn quota.
     */
    const imageProductionFailed = imageResult.posterStoragePath === null && imageResult.source !== "copy_only";
    const productionSuccess = !imageProductionFailed;

    await admin.from("ai_generation_logs").insert({
      business_id: businessId,
      user_id: user.id,
      request_type: isRevision ? "ad_refine" : "ad_variants",
      input_mode: photoPath ? "photo" : "text",
      request_hash: `v3:${derivedRevisionCount}:${imageResult.source}:${imageResult.provider}`,
      prompt_version: AD_COPY_PROMPT_VERSION,
      model: CHAT_MODEL,
      success: productionSuccess,
      failure_reason: productionSuccess ? null : "IMAGE_NULL",
      openai_called: true,
      response_payload: buildGenerationTelemetry({
        offerContract,
        copy,
        imageResult,
        productionSuccess,
      }),
    });

    /** Quota only ticks on a real successful production (matches the log row above). */
    const updatedUsed = startingQuota.used + (productionSuccess ? 1 : 0);
    const quota = {
      used: updatedUsed,
      limit: startingQuota.limit,
      remaining: Math.max(0, startingQuota.limit - updatedUsed),
    };

    if (imageProductionFailed) {
      return new Response(
        JSON.stringify({
          error: "AI image generation failed. Try again.",
          error_code: "IMAGE_REQUIRED",
          quota,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ad, ads: [ad], quota }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.log(JSON.stringify({ tag: "ai_ads_v2", event: "fatal", err: String(e).slice(0, 400) }));
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function coerceSingleAd(raw: Record<string, unknown>): SingleAd {
  const research = (raw.item_research ?? {}) as Partial<ItemResearch>;
  const photoSourceRaw = typeof raw.photo_source === "string" ? raw.photo_source : "generated";
  const photoSource: SingleAd["photo_source"] =
    photoSourceRaw === "uploaded_original" ||
    photoSourceRaw === "uploaded_enhanced" ||
    photoSourceRaw === "stock" ||
    photoSourceRaw === "copy_only"
      ? photoSourceRaw
      : "generated";
  const photoTreatmentRaw = typeof raw.photo_treatment === "string" ? raw.photo_treatment : "";
  const photoTreatment: PhotoTreatment | null =
    VALID_PHOTO_TREATMENTS.has(photoTreatmentRaw as PhotoTreatment)
      ? (photoTreatmentRaw as PhotoTreatment)
      : null;
  const copySourceRaw = typeof raw.copy_source === "string" ? raw.copy_source : "";
  const copySource: AiDealCopySource | undefined =
    copySourceRaw === "AI_VALIDATED" ||
    copySourceRaw === "AI_RETRY_VALIDATED" ||
    copySourceRaw === "DETERMINISTIC_FALLBACK"
      ? copySourceRaw
      : undefined;

  const shortDescription = clip(
    typeof raw.short_description === "string"
      ? raw.short_description
      : typeof raw.subheadline === "string"
      ? raw.subheadline
      : "",
    220,
  );

  return {
    headline: clip(typeof raw.headline === "string" ? raw.headline : "", 70),
    subheadline: shortDescription,
    short_description: shortDescription,
    push_notification: clip(
      typeof raw.push_notification === "string" ? raw.push_notification : "",
      90,
    ),
    terms_summary: clip(
      typeof raw.terms_summary === "string" ? raw.terms_summary : shortDescription,
      240,
    ),
    social_caption: clip(typeof raw.social_caption === "string" ? raw.social_caption : "", 220) || undefined,
    locked_offer_line: clip(
      typeof raw.locked_offer_line === "string" ? raw.locked_offer_line : "",
      240,
    ) || undefined,
    locked_terms_line: clip(
      typeof raw.locked_terms_line === "string" ? raw.locked_terms_line : "",
      240,
    ) || undefined,
    copy_source: copySource,
    variant_count: typeof raw.variant_count === "number" && Number.isFinite(raw.variant_count)
      ? Math.max(0, Math.floor(raw.variant_count))
      : undefined,
    selected_variant_index:
      typeof raw.selected_variant_index === "number" && Number.isFinite(raw.selected_variant_index)
        ? Math.max(0, Math.floor(raw.selected_variant_index))
        : null,
    validation_reason_codes: Array.isArray(raw.validation_reason_codes)
      ? raw.validation_reason_codes.filter((code): code is string => typeof code === "string").slice(0, 12)
      : undefined,
    cta: clip(typeof raw.cta === "string" ? raw.cta : "", 26),
    item_research: {
      item_name: clip(typeof research.item_name === "string" ? research.item_name : "", 80),
      description: clip(typeof research.description === "string" ? research.description : "", 280),
      is_familiar: research.is_familiar === true,
    },
    photo_source: photoSource,
    photo_treatment: photoTreatment,
    poster_storage_path:
      typeof raw.poster_storage_path === "string" && raw.poster_storage_path.length > 0
        ? raw.poster_storage_path
        : null,
  };
}
