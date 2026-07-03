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
import { resolveOpenAiChatModel, chatCompletionTuning } from "../_shared/openai-chat-model.ts";
import { DEFAULT_MONTHLY_LIMIT, DEFAULT_COOLDOWN_SEC } from "../_shared/ai-limits.ts";
import { countAiQuotaUsage } from "../_shared/ai-quota-resets.ts";
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
  type AiImageAspectRatio,
  type AiImageProviderConfig,
  type AiImageStylePreset,
  type GeminiImageAttempt,
} from "../_shared/ai-image-provider.ts";
import { logAiCost, openAiRequestIdFromHeaders, type AiUsageInput } from "../_shared/ai-costs.ts";
import {
  generateStructuredText,
  resolveAiTextProviderConfig,
  type ProviderAttempt,
} from "../_shared/ai-text-provider.ts";
import { resolveGeminiTextModel } from "../_shared/gemini-text-provider.ts";
import { shouldSkipWebSearchForMenuItem } from "../_shared/ai-web-search-gate.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  INCLUDED_IMAGE_REVISIONS,
  commitChargeableImageRevisionCredit,
  releaseChargeableImageRevisionCredit,
  reserveChargeableImageRevisionCredit,
  type ChargeableImageRevisionReservation,
} from "../_shared/deal-credit-enforcement.ts";
import {
  getSuspendedPrimaryBusinessLocation,
  suspendedLocationResponseBody,
} from "../_shared/billing-suspension.ts";
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
  validateAiCopyAgainstOffer,
  type AiDealCopyVariant,
  type AiDealCopySource,
  type DealOfferContract,
  type ValidatedDealCopy,
} from "../../../lib/deal-offer-contract.ts";
import { evaluateAdCopyStyleGate } from "../../../lib/ad-copy-style-gate.ts";
import { buildDeterministicRevisionFallbackCopy } from "../../../lib/ai-revision-fallback-copy.ts";
import { checkAdCandidateDiversity } from "../../../lib/ad-candidate-diversity.ts";
import {
  CANDIDATE_JUDGE_PROMPT_VERSION,
  applyJudgeScoresToCandidates,
  buildCandidateJudgePrompt,
  normalizeCandidateJudgeResult,
  rankCandidatesDeterministically,
  type CandidateJudgeResult,
} from "../../../lib/candidate-judge.ts";
import { buildCategoryAdPlaybookPromptBlock } from "../../../lib/category-ad-playbooks.ts";
import {
  buildMerchantCreativeProfile,
  buildMerchantCreativeProfilePromptBlock,
  type MerchantCreativeProfile,
} from "../../../lib/merchant-creative-profile.ts";
import {
  dealEligibilityErrorPayload,
  validateDealEligibility,
  type DealEligibilityInput,
} from "../../../lib/deal-eligibility.ts";
import {
  QUICK_DEAL_IMAGE_QA_SCHEMA,
  buildAdImageQaPrompt,
  buildQuickDealImageRegenerationPrompt,
  normalizeQuickDealImageQaResult,
  normalizeSourceAwareImageQaResult,
  shouldFailClosedForImageQa,
  unavailableSourceAwareImageQaResult,
  type AdImageQaDecision,
  type AdImageQaSourceType,
  type QuickDealImageQaResult,
  type SourceAwareImageQaResult,
} from "../../../lib/quick-deal-image-qa.ts";
import {
  buildAdImageSelection,
  imageEditModeFromPhotoTreatment,
  imageSourceModeFromPhotoSource,
  normalizeMerchantImageEditMode,
  normalizeMerchantImageSourceMode,
  photoTreatmentFromImageEditMode,
  type AdImageSelection,
  type MerchantImageEditMode,
  type MerchantImageSourceMode,
} from "../../../lib/merchant-image-selection.ts";
import { validateMerchantImageEditInstruction } from "../../../lib/merchant-image-edit-policy.ts";
import {
  buildOfferDefinitionV1FromContract,
  type OfferDefinitionV1,
} from "../../../lib/offer-definition.ts";
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "../../../lib/supported-locales.ts";
import {
  buildPosterSpecFromOfferDefinition,
  choosePosterTemplateForOffer,
} from "../../../lib/poster/posterCopy.ts";
import type { PosterDraftV1, PosterStyleChoice } from "../../../lib/poster/posterTypes.ts";
import type {
  AdLocalizationBundle,
} from "../../../lib/ad-localization-schema.ts";
import {
  adLocalizationOfferFactsFromDefinition,
  generateVerifiedAdLocalizationBundle,
  type VerifiedAdLocalizationBundleResult,
} from "../_shared/ai-localization-provider.ts";

// Static anchors so Supabase's remote bundler includes the npm packages that
// `_shared/ai-image-provider.ts` imports lazily when Gemini returns JPEG bytes.
import "jpeg-js";
import "pngjs";

const CHAT_MODEL = resolveOpenAiChatModel();
const RESEARCH_MODEL = "gpt-4o-search-preview";
const DEFAULT_MONTHLY = DEFAULT_MONTHLY_LIMIT;
const COOLDOWN_SEC = DEFAULT_COOLDOWN_SEC;
const ITEM_RESEARCH_PROMPT_VERSION = "AI_ITEM_RESEARCH_V1";
const ITEM_RESEARCH_SCHEMA = {
  name: "item_research",
  strict: true,
  schema: {
    type: "object",
    properties: {
      item_name: { type: "string" },
      description: { type: "string" },
      is_familiar: { type: "boolean" },
    },
    required: ["item_name", "description", "is_familiar"],
    additionalProperties: false,
  },
} as const;

/** Included revision allowance. Extra image-affecting revisions must reserve a deal credit. */
const MAX_REVISION_COUNT = INCLUDED_IMAGE_REVISIONS;

const VALID_PHOTO_TREATMENTS: ReadonlySet<PhotoTreatment> = new Set([
  "touchup",
  "cleanbg",
  "studiopolish",
]);
const VALID_REVISION_TARGETS = new Set(["copy", "image", "both"] as const);

type RevisionTarget = "copy" | "image" | "both";

type AdCopyAlternative = {
  candidate_id?: string;
  strategy_id?: string;
  strategy_reason?: string;
  variant_index?: number | null;
  headline: string;
  short_description: string;
  push_notification?: string;
  social_caption?: string;
  cta?: string;
  selected?: boolean;
};

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
  copy_alternatives?: AdCopyAlternative[];
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
  /** Canonical image source choice, QA decision, and lineage. */
  image_selection?: AdImageSelection | null;
  /** Optional native-rendered poster draft. */
  poster?: PosterDraftV1 | null;
  /** Verified source plus target-language persuasive copy bundle, when PR3 multilingual flags are enabled. */
  localization_bundle?: AdLocalizationBundle | null;
  localization_status?: {
    source_locale: SupportedLocale;
    localization_bundle_hash: string;
    deterministic_fallback_locales: SupportedLocale[];
    transcreation_provider: string;
    transcreation_model: string;
    transcreation_skipped_reason?: string | null;
    semantic_qa_provider: string;
    semantic_qa_model: string;
    semantic_qa_skipped_reason?: string | null;
    repair_target_locales: SupportedLocale[];
  } | null;
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
 * Live web-search research (Stage 1b) is the only remaining OpenAI call on the
 * ad hot path. It is already double-gated (Gemini familiarity + common-item
 * list), but this flag lets it be disabled entirely for full cost control.
 * Default on so unfamiliar-item copy quality is preserved unless opted out.
 */
function webSearchResearchEnabled(): boolean {
  return envFlag("AI_AD_WEB_SEARCH_ENABLED", true);
}

/**
 * Research the menu item with web search. Returns description if useful, blank if unfamiliar.
 * Failures are silent — the copy stage works fine without research context.
 */
async function researchMenuItem(params: {
  openAiKey: string;
  geminiApiKey?: string | null;
  itemHint: string;
  businessName: string;
  businessLocation: string;
  costContext?: AiCostContext;
}): Promise<ItemResearch> {
  const { openAiKey, geminiApiKey, itemHint, businessName, businessLocation, costContext } = params;
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
    geminiApiKey,
    model: CHAT_MODEL,
    prompt,
    cleanHint,
    isWebSearch: false,
    costContext,
  });
  if (fallbackResult?.is_familiar || shouldSkipWebSearchForMenuItem(cleanHint)) {
    return fallbackResult ?? { item_name: cleanHint.slice(0, 60), description: "", is_familiar: true };
  }

  // Stage 1b: paid web search, only for unfamiliar/ambiguous/local/branded items.
  // Skipped entirely when web-search research is disabled.
  if (!webSearchResearchEnabled()) {
    return fallbackResult ?? { item_name: cleanHint.slice(0, 60), description: "", is_familiar: false };
  }
  const webSearchResult = await callResearchModel({
    openAiKey,
    geminiApiKey,
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

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parsePosterStyle(value: unknown): PosterStyleChoice {
  return value === "fresh" || value === "bold" || value === "premium" || value === "auto" ? value : "auto";
}

function parseCreativeRequest(value: unknown): {
  requestedFormat: "standard_card" | "poster_v1";
  posterEnabled: boolean;
  posterStyle: PosterStyleChoice;
  imageAspectRatio: AiImageAspectRatio;
} {
  const creative = recordValue(value);
  const poster = recordValue(creative?.poster);
  const requestedFormat =
    creative?.requested_format === "poster_v1" || poster?.enabled === true ? "poster_v1" : "standard_card";
  const posterEnabled = requestedFormat === "poster_v1" && poster?.enabled !== false;
  return {
    requestedFormat: posterEnabled ? "poster_v1" : "standard_card",
    posterEnabled,
    posterStyle: parsePosterStyle(poster?.style),
    imageAspectRatio: posterEnabled ? "4:5" : "1:1",
  };
}

function normalizeItemResearch(value: Partial<ItemResearch>, cleanHint: string): ItemResearch {
  return {
    item_name: clip(typeof value.item_name === "string" ? value.item_name : cleanHint, 80),
    description: clip(typeof value.description === "string" ? value.description : "", 280),
    is_familiar: value.is_familiar === true,
  };
}

async function callResearchModel(params: {
  openAiKey: string;
  geminiApiKey?: string | null;
  model: string;
  prompt: string;
  cleanHint: string;
  isWebSearch: boolean;
  costContext?: AiCostContext;
}): Promise<ItemResearch | null> {
  const { openAiKey, geminiApiKey, model, prompt, cleanHint, isWebSearch, costContext } = params;
  if (!isWebSearch) {
    try {
      const result = await generateStructuredText<typeof ITEM_RESEARCH_SCHEMA, ItemResearch>({
        operation: "merchant_context",
        systemPrompt: "Identify a menu item for local-business ad generation. Return only grounded JSON.",
        userPrompt: prompt,
        jsonSchema: ITEM_RESEARCH_SCHEMA,
        maxOutputTokens: 220,
        timeoutMs: 12_000,
        generationRunId: costContext?.requestGroupId ?? crypto.randomUUID(),
        promptVersion: ITEM_RESEARCH_PROMPT_VERSION,
        reasoningLevel: "low",
      }, {
        openAiApiKey: openAiKey,
        geminiApiKey,
        admin: costContext?.admin,
        config: resolveAiTextProviderConfig(),
      });
      if (costContext) await logTextProviderAttempts(costContext, "ad_research", result.attempts);
      return normalizeItemResearch(result.value, cleanHint);
    } catch (e) {
      const attempts = (e as { attempts?: ProviderAttempt[] })?.attempts ?? [];
      if (costContext) await logTextProviderAttempts(costContext, "ad_research", attempts);
      console.log(
        JSON.stringify({
          tag: "ai_ads_v2",
          event: "research_router_error",
          model,
          errorCode: (e as { errorCode?: string })?.errorCode ?? "AI_RESEARCH_FAILED",
        }),
      );
      return null;
    }
  }

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
    return normalizeItemResearch(parsed, cleanHint);
  } catch {
    console.log(
      JSON.stringify({
        tag: "ai_ads_v2",
        event: "research_error",
        model,
        isWebSearch,
        errorCode: "FETCH_ERROR",
      }),
    );
    await logAdCost(costContext ?? null, {
      feature: "ad_research",
      model,
      endpoint: "chat.completions",
      webSearchCalls: isWebSearch ? 1 : 0,
      success: false,
      errorCode: "FETCH_ERROR",
      errorMessage: "Ad research failed before a usable response was returned.",
    });
    return null;
  }
}

// ─── Stage 2: copy ─────────────────────────────────────────────────────────

async function generateCopy(params: {
  openAiKey: string;
  geminiApiKey?: string | null;
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
  creativeFormat?: "standard_card" | "poster_v1";
  costContext: AiCostContext;
}): Promise<Pick<SingleAd, "headline" | "subheadline" | "short_description" | "push_notification" | "terms_summary" | "social_caption" | "locked_offer_line" | "locked_terms_line" | "copy_source" | "variant_count" | "selected_variant_index" | "validation_reason_codes" | "cta"> & {
  fallback_reason?: string;
  generator_version?: string;
  copy_latency_ms?: number;
  provider_attempts?: ProviderAttempt[];
  provider?: string;
  model?: string;
  provider_fallback_used?: boolean;
  provider_fallback_reason?: string;
  copy_quality?: CopyQualityTelemetry[];
  judge_attempts?: ProviderAttempt[];
  judge_provider?: string;
  judge_model?: string;
  copy_alternatives?: AdCopyAlternative[];
}> {
  const {
    openAiKey,
    geminiApiKey,
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
    creativeFormat = "standard_card",
    costContext,
  } = params;

  // A previous ad is only passed in on revision calls (see the handler's generateCopy call).
  const isRevision = previousAd !== undefined;

  const copyStartedAt = Date.now();
  const providerAttempts: ProviderAttempt[] = [];
  const copyQuality: CopyQualityTelemetry[] = [];
  const judgeAttempts: ProviderAttempt[] = [];
  let copyProvider: string | undefined;
  let copyModel: string | undefined;
  let judgeProvider: string | undefined;
  let judgeModel: string | undefined;
  let providerFallbackUsed = false;
  let providerFallbackReason: string | undefined;
  let latestPreparedVariants: AiDealCopyVariant[] = [];
  const merchantProfile = buildMerchantCreativeProfile({
    businessId: offerContract.businessId,
    businessName,
    category: businessContext.category,
    tone: businessContext.tone,
    location: businessContext.location,
    address: businessContext.address,
    description: businessContext.description,
    itemHint,
    research,
  });
  let selected = await generateValidatedDealCopy({
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
        merchantCreativeProfile: merchantProfile,
        creativeFormat,
      });

      let result: Awaited<ReturnType<typeof generateStructuredText<typeof jsonSchema>>>;
      try {
        result = await generateStructuredText<typeof jsonSchema>({
          operation: isRevision ? "copy_revision" : attemptNumber === 1 ? "creative_candidates" : "creative_repair",
          systemPrompt: system,
          userPrompt: userText,
          jsonSchema,
          maxOutputTokens: 1400,
          timeoutMs: 12_000,
          generationRunId: costContext.requestGroupId,
          promptVersion: AD_COPY_PROMPT_VERSION,
          reasoningLevel: "medium",
        }, {
          openAiApiKey: openAiKey,
          geminiApiKey,
          admin: costContext.admin,
          config: resolveAiTextProviderConfig(),
          isRevision,
        });
      } catch (e) {
        const attempts = (e as { attempts?: ProviderAttempt[] })?.attempts ?? [];
        providerAttempts.push(...attempts);
        await logTextProviderAttempts(costContext, "ad_copy", attempts);
        if ((e as { errorClass?: string })?.errorClass === "provider_output_invalid") {
          return [];
        }
        throw e;
      }

      providerAttempts.push(...result.attempts);
      await logTextProviderAttempts(costContext, "ad_copy", result.attempts);
      copyProvider = result.provider;
      copyModel = result.model;
      providerFallbackUsed = providerFallbackUsed || result.fallbackUsed;
      providerFallbackReason = result.fallbackReason ?? providerFallbackReason;
      const content = JSON.stringify(result.value);
      try {
        const variants = parseAiDealCopyVariants(content);
        const creativeBrief = result.value && typeof result.value === "object"
          ? (result.value as { creativeBrief?: unknown }).creativeBrief
          : null;
        const prepared = await prepareCopyCandidates({
          variants,
          creativeBrief,
          attemptNumber,
          generationProvider: result.provider,
          openAiKey,
          geminiApiKey,
          businessContext,
          merchantProfile,
          offerContract,
          costContext,
          creativeFormat,
        });
        copyQuality.push(prepared.telemetry);
        judgeAttempts.push(...prepared.judgeAttempts);
        judgeProvider = prepared.judgeProvider ?? judgeProvider;
        judgeModel = prepared.judgeModel ?? judgeModel;
        latestPreparedVariants = prepared.variants;
        if (!isRevision || !previousAd) return prepared.variants;
        const changed = prepared.variants.filter((variant) => hasVisibleRevisionCopyChange(variant, previousAd));
        const feedbackMatched = filterRevisionCandidatesByFeedback({
          candidates: changed,
          previousAd,
          revisionFeedback,
        });
        latestPreparedVariants = feedbackMatched;
        if (changed.length === 0) {
          console.log(
            JSON.stringify({
              tag: "ai_ads_v2",
              event: "revision_no_visible_copy_change",
              attemptNumber,
              businessId: offerContract.businessId,
            }),
          );
        }
        if (changed.length > 0 && feedbackMatched.length === 0) {
          console.log(
            JSON.stringify({
              tag: "ai_ads_v2",
              event: "revision_feedback_no_candidate_match",
              attemptNumber,
              businessId: offerContract.businessId,
            }),
          );
        }
        return feedbackMatched;
      } catch {
        console.log(
          JSON.stringify({
            tag: "ai_ads_v2",
            event: "copy_parse_error",
            attemptNumber,
            errorCode: "COPY_PREPARATION_FAILED",
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
  if (
    isRevision &&
    previousAd &&
    shouldUseDeterministicRevisionCopyFallback({
      selected,
      previousAd,
      revisionFeedback,
    })
  ) {
    const revisionFallback = buildDeterministicRevisionFallbackCopy({
      contract: offerContract,
      feedback: revisionFeedback,
      avoidHeadlines: [
        previousAd.headline,
        previousAd.poster?.copy?.headline,
        selected.headline,
      ],
    });
    const fallbackValidation = validateAiCopyAgainstOffer(revisionFallback, offerContract);
    if (fallbackValidation.valid && hasVisibleRevisionCopyChange(revisionFallback, previousAd)) {
      console.log(
        JSON.stringify({
          tag: "ai_ads_v2",
          event: "revision_deterministic_copy_fallback",
          businessId: offerContract.businessId,
          previousCopySource: selected.copy_source,
        }),
      );
      selected = {
        ...selected,
        ...revisionFallback,
        push_notification: revisionFallback.push_body || revisionFallback.push_notification,
        push_body: revisionFallback.push_body || revisionFallback.push_notification,
        terms_summary: offerContract.canonicalShortTerms,
        locked_offer_line: offerContract.canonicalOfferLine,
        locked_terms_line: offerContract.canonicalShortTerms,
        copy_source: "DETERMINISTIC_FALLBACK" satisfies AiDealCopySource,
        selected_variant_index: null,
        validation_reason_codes: [
          ...new Set([
            ...selected.validation_reason_codes,
            "REVISION_DETERMINISTIC_FALLBACK",
          ]),
        ],
        fallback_reason: [
          selected.fallback_reason,
          "REVISION_NO_VISIBLE_COPY_CHANGE",
        ].filter(Boolean).join(","),
      };
    }
  }
  const copyLatencyMs = Date.now() - copyStartedAt;
  const shortDescription = clip(selected.short_description, DEAL_COPY_LIMITS.description);
  const copyAlternatives = buildCopyAlternatives({
    variants: latestPreparedVariants,
    selected,
    offerContract,
    cta: defaultCta(outputLanguage),
  });

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
    provider_attempts: providerAttempts,
    provider: copyProvider,
    model: copyModel,
    provider_fallback_used: providerFallbackUsed,
    provider_fallback_reason: providerFallbackReason,
    copy_quality: copyQuality,
    judge_attempts: judgeAttempts,
    judge_provider: judgeProvider,
    judge_model: judgeModel,
    copy_alternatives: copyAlternatives,
    cta: defaultCta(outputLanguage),
  };
}

function cleanForComparison(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

function copyKey(copy: Pick<AiDealCopyVariant, "headline" | "short_description" | "push_notification">): string {
  return [
    cleanForComparison(copy.headline),
    cleanForComparison(copy.short_description),
    cleanForComparison(copy.push_notification),
  ].join("|");
}

function sameCopy(left: AiDealCopyVariant, right: AiDealCopyVariant): boolean {
  const leftId = typeof left.candidate_id === "string" ? left.candidate_id.trim() : "";
  const rightId = typeof right.candidate_id === "string" ? right.candidate_id.trim() : "";
  if (leftId && rightId && leftId === rightId) return true;
  return copyKey(left) === copyKey(right);
}

function buildCopyAlternatives(params: {
  variants: AiDealCopyVariant[];
  selected: ValidatedDealCopy;
  offerContract: DealOfferContract;
  cta: string;
}): AdCopyAlternative[] {
  if (params.selected.copy_source === "DETERMINISTIC_FALLBACK") return [];

  const valid: AiDealCopyVariant[] = [];
  const seen = new Set<string>();
  const originalIndexes = new Map<string, number>();
  params.variants.forEach((variant, index) => {
    const key = copyKey(variant);
    if (key && !originalIndexes.has(key)) originalIndexes.set(key, index);
  });
  for (const variant of params.variants) {
    if (!validateAiCopyAgainstOffer(variant, params.offerContract).valid) continue;
    const key = copyKey(variant);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    valid.push(variant);
  }

  const selectedIndex = valid.findIndex((variant) => sameCopy(variant, params.selected));
  const ordered = selectedIndex >= 0
    ? [valid[selectedIndex]!, ...valid.filter((_, index) => index !== selectedIndex)]
    : [params.selected, ...valid.filter((variant) => !sameCopy(variant, params.selected))];

  const alternatives = ordered.slice(0, 5).map((variant, index) => ({
    ...(variant.candidate_id ? { candidate_id: clip(variant.candidate_id, 64) } : {}),
    ...(variant.strategy_id ? { strategy_id: clip(variant.strategy_id, 64) } : {}),
    ...(variant.strategy_reason ? { strategy_reason: clip(variant.strategy_reason, 180) } : {}),
    variant_index: originalIndexes.get(copyKey(variant)) ?? (sameCopy(variant, params.selected) ? params.selected.selected_variant_index : index),
    headline: clip(variant.headline, DEAL_COPY_LIMITS.headline),
    short_description: clip(variant.short_description, DEAL_COPY_LIMITS.description),
    push_notification: clip(variant.push_body || variant.push_notification, DEAL_COPY_LIMITS.pushBody),
    ...(variant.social_caption ? { social_caption: clip(variant.social_caption, DEAL_COPY_LIMITS.socialCaption) } : {}),
    cta: clip(variant.cta || params.cta, 26),
    selected: sameCopy(variant, params.selected),
  }));

  return alternatives.length > 1 ? alternatives : [];
}

function defaultCta(lang: OutputLanguage): string {
  if (lang === "es") return "Reclamar oferta";
  if (lang === "ko") return "딜 받기";
  return "Claim deal";
}

// ─── Stage 3: image ────────────────────────────────────────────────────────

type CopyQualityTelemetry = {
  attempt_number: 1 | 2;
  creative_brief?: unknown;
  style_gate_rejected: Array<{
    candidate_id: string;
    reasons: string[];
  }>;
  diversity: {
    checked: boolean;
    ok: boolean;
    hard_failures: Array<{ code: string; candidate_ids: string[]; score?: number }>;
    warnings: Array<{ code: string; candidate_ids: string[]; score?: number }>;
  };
  preliminary_scores: Array<{
    candidate_id: string;
    strategy_id: string | null;
    score: number;
  }>;
  judge: {
    enabled: boolean;
    used: boolean;
    skipped_reason: string | null;
    provider: string | null;
    model: string | null;
    pass: boolean | null;
    winner_candidate_id: string | null;
    ranked_candidate_ids: string[];
    hard_failures: Array<{ candidate_id: string; code: string }>;
    feedback: string[];
  };
};

type SupabaseClient = SupabaseClientBase<any, "public", "public", any, any>;
type AdQuota = { used: number; limit: number; remaining: number };

type AiCostContext = {
  admin: SupabaseClient;
  businessId: string;
  ownerUserId: string;
  requestGroupId: string;
};

function envFlag(name: string, fallback = false): boolean {
  const raw = Deno.env.get(name);
  if (raw == null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function outputLanguageToSupportedLocale(lang: OutputLanguage): SupportedLocale {
  if (lang === "es") return "es-US";
  if (lang === "ko") return "ko-KR";
  return "en-US";
}

function shouldBuildLocalizationBundle(): boolean {
  return envFlag("AI_V5_DETERMINISTIC_LANGUAGE_FALLBACK_ENABLED", false) ||
    envFlag("AI_V5_PERSUASIVE_TRANSCRATION_ENABLED", false);
}

function uniqueCleanText(values: readonly unknown[], max = 20): string[] {
  const out: string[] = [];
  for (const value of values) {
    const clean = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    if (!clean || out.some((existing) => existing.toLowerCase() === clean.toLowerCase())) continue;
    out.push(clean.slice(0, 160));
    if (out.length >= max) break;
  }
  return out;
}

function protectedTermsForLocalization(definition: OfferDefinitionV1): string[] {
  return uniqueCleanText([
    definition.merchantName,
    definition.locationName,
    ...definition.qualifyingItems.map((item) => item.displayName),
    ...definition.reward.displayNames,
  ]);
}

function localizationImageAltText(params: {
  businessName: string;
  headline: string;
  offerLine: string;
}): string {
  return clip(
    [
      params.businessName,
      params.headline || params.offerLine,
      "deal image",
    ].filter(Boolean).join(" - "),
    140,
  );
}

function envNumber(name: string, fallback: number): number {
  const raw = Number(Deno.env.get(name));
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

function candidateId(candidate: AiDealCopyVariant, index: number): string {
  return candidate.candidate_id || `candidate_${index + 1}`;
}

function styleGateCopy(candidate: AiDealCopyVariant) {
  return {
    displayHook: candidate.headline,
    supportingLine: candidate.short_description,
    cta: candidate.cta ?? "Claim deal",
    pushTitle: candidate.push_title ?? candidate.headline,
    pushBody: candidate.push_body ?? candidate.push_notification,
    socialCaption: candidate.social_caption ?? "",
  };
}

function offerFactsForJudge(contract: DealOfferContract): string {
  return [
    `Deal type: ${contract.dealType}`,
    `Locked offer line: ${contract.canonicalOfferLine}`,
    contract.requiredPurchase
      ? `Customer buys ${contract.requiredPurchase.quantity} ${contract.requiredPurchase.itemName}.`
      : "",
    contract.freeReward
      ? `Customer gets ${contract.freeReward.quantity} ${contract.freeReward.itemName} free.`
      : "",
    contract.singleItemDiscount
      ? `Customer gets ${contract.singleItemDiscount.discountPercent}% off one ${contract.singleItemDiscount.itemName}.`
      : "",
    `Terms are app-rendered metadata: ${contract.canonicalShortTerms}`,
  ].filter(Boolean).join("\n");
}

function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return [...items]
    .map((item, index) => {
      hash ^= index + 0x9e3779b9;
      hash = Math.imul(hash, 16777619);
      return { item, sort: hash >>> 0 };
    })
    .sort((left, right) => left.sort - right.sort)
    .map(({ item }) => item);
}

function makeJudgeConfig() {
  const base = resolveAiTextProviderConfig();
  return {
    ...base,
    routerEnabled: true,
    primaryProvider: "gemini" as const,
    fallbackEnabled: false,
    fallbackProvider: "openai" as const,
    geminiTextModel: resolveGeminiTextModel(Deno.env, "GEMINI_JUDGE_MODEL"),
    primaryTimeoutMs: envNumber("AI_JUDGE_TIMEOUT_MS", 9_000),
    fallbackTimeoutMs: envNumber("AI_JUDGE_TIMEOUT_MS", 9_000),
    transientRetryMax: 0,
    retryAfterFullTimeout: false,
  };
}

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

async function logTextProviderAttempts(
  ctx: AiCostContext,
  feature: string,
  attempts: readonly ProviderAttempt[],
): Promise<void> {
  for (const attempt of attempts) {
    await logAdCost(ctx, {
      feature,
      provider: attempt.provider,
      model: attempt.model,
      endpoint: attempt.provider === "gemini" ? "models.generateContent" : "chat.completions",
      estimatedCostUsd: attempt.estimatedCostUsd,
      success: attempt.success,
      errorCode: attempt.errorCode ?? attempt.errorClass ?? null,
      errorMessage: attempt.errorClass ?? null,
      openaiRequestId: attempt.provider === "openai" ? attempt.requestId ?? null : null,
      responseId: null,
    });
  }
}

function normalizeRevisionCopyText(value: string | null | undefined): string {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9%+\s-]/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

function hasVisibleRevisionCopyChange(candidate: AiDealCopyVariant, previousAd: SingleAd): boolean {
  const nextHeadline = normalizeRevisionCopyText(candidate.headline);
  const nextDescription = normalizeRevisionCopyText(candidate.short_description);
  const nextPush = normalizeRevisionCopyText(candidate.push_body || candidate.push_notification);
  const previousHeadlines = [
    previousAd.headline,
    previousAd.poster?.copy?.headline,
  ].map(normalizeRevisionCopyText).filter(Boolean);
  const previousDescription = normalizeRevisionCopyText(previousAd.short_description || previousAd.subheadline);
  const previousPush = normalizeRevisionCopyText(previousAd.push_notification);

  return (
    (nextHeadline.length > 0 && !previousHeadlines.includes(nextHeadline)) ||
    (nextDescription.length > 0 && nextDescription !== previousDescription) ||
    (nextPush.length > 0 && nextPush !== previousPush)
  );
}

type RevisionFeedbackIntent = {
  active: boolean;
  requiresHeadlineChange: boolean;
  wantsShorter: boolean;
  wantsDirect: boolean;
  wantsLocal: boolean;
  wantsWarmer: boolean;
  wantsPremium: boolean;
  bannedTerms: string[];
};

const REVISION_BANNED_TERM_STOPLIST = new Set([
  "it",
  "that",
  "this",
  "copy",
  "text",
  "wording",
  "headline",
  "title",
  "poster",
  "top part",
]);

function extractBannedRevisionTerms(feedback: string): string[] {
  const phrases = new Set<string>();
  const patterns = [
    /\b(?:do not|dont|don't)\s+(?:say|use|include|mention|write)\s+"?([^".,;!?]+)"?/gi,
    /\b(?:remove|avoid|drop)\s+(?:the\s+)?(?:word|phrase|copy|text)?\s*"?([^".,;!?]+)"?/gi,
    /\b(?:without|no)\s+"?([^".,;!?]{3,60})"?/gi,
  ];
  for (const pattern of patterns) {
    for (const match of feedback.matchAll(pattern)) {
      const phrase = normalizeRevisionCopyText(match[1]);
      if (!phrase || REVISION_BANNED_TERM_STOPLIST.has(phrase)) continue;
      if (phrase.split(/\s+/).length > 6) continue;
      phrases.add(phrase);
    }
  }
  return [...phrases].slice(0, 4);
}

function parseRevisionFeedbackIntent(feedback: string | undefined): RevisionFeedbackIntent {
  const normalized = normalizeRevisionCopyText(feedback);
  if (!normalized) {
    return {
      active: false,
      requiresHeadlineChange: false,
      wantsShorter: false,
      wantsDirect: false,
      wantsLocal: false,
      wantsWarmer: false,
      wantsPremium: false,
      bannedTerms: [],
    };
  }
  return {
    active: true,
    requiresHeadlineChange:
      /\b(?:ad copy|caption|headline|heading|hero|main copy|main line|main message|opening|poster copy|poster headline|poster text|tagline|title|top|top copy|top text|wording)\b/.test(normalized),
    wantsShorter: /\b(?:shorter|too long|less text|fewer words|trim|tighten|concise)\b/.test(normalized),
    wantsDirect: /\b(?:actual ad|awkward|boring|clear|confusing|direct|doesn t make sense|doesn t read right|full offer|generic|make sense|natural|plain|read right|reads weird|real ad|simple|sounds off|whole deal|whole offer)\b/.test(normalized),
    wantsLocal: /\b(?:local|nearby|neighborhood|neighbourhood|regulars|community|around here)\b/.test(normalized),
    wantsWarmer: /\b(?:appetizing|appealing|friendlier|friendly|inviting|less cold|more human|tasty|warmer)\b/.test(normalized),
    wantsPremium: /\b(?:premium|professional|upscale|classy|elevated|polished|less cheap)\b/.test(normalized),
    bannedTerms: extractBannedRevisionTerms(feedback ?? ""),
  };
}

function revisionFeedbackMentionsImageOnly(feedback: string | undefined): boolean {
  const normalized = normalizeRevisionCopyText(feedback);
  if (!normalized) return false;
  const mentionsImage = /\b(?:image|photo|picture|pic|background|crop|lighting|angle|composition|visual|brighter|darker)\b/.test(normalized);
  if (!mentionsImage) return false;
  const intent = parseRevisionFeedbackIntent(feedback);
  return !intent.requiresHeadlineChange &&
    !intent.wantsShorter &&
    !intent.wantsDirect &&
    !intent.wantsLocal &&
    !intent.wantsWarmer &&
    !intent.wantsPremium;
}

function shouldUseDeterministicRevisionCopyFallback(params: {
  selected: AiDealCopyVariant;
  previousAd: SingleAd;
  revisionFeedback?: string;
}): boolean {
  if (revisionFeedbackMentionsImageOnly(params.revisionFeedback)) return false;
  const intent = parseRevisionFeedbackIntent(params.revisionFeedback);
  if (intent.requiresHeadlineChange && !revisionHeadlineChanged(params.selected, params.previousAd)) return true;
  if (hasVisibleRevisionCopyChange(params.selected, params.previousAd)) return false;
  return true;
}

function revisionHeadlineChanged(candidate: AiDealCopyVariant, previousAd: SingleAd): boolean {
  const nextHeadline = normalizeRevisionCopyText(candidate.headline);
  if (!nextHeadline) return false;
  const previousHeadlines = [
    previousAd.headline,
    previousAd.poster?.copy?.headline,
  ].map(normalizeRevisionCopyText).filter(Boolean);
  return !previousHeadlines.includes(nextHeadline);
}

function revisionCandidateVisibleLength(candidate: AiDealCopyVariant): number {
  return [
    candidate.headline,
    candidate.short_description,
    candidate.push_body || candidate.push_notification,
    candidate.social_caption,
  ].filter(Boolean).join(" ").length;
}

function revisionPreviousVisibleLength(previousAd: SingleAd): number {
  return [
    previousAd.headline,
    previousAd.short_description || previousAd.subheadline,
    previousAd.push_notification,
    previousAd.social_caption,
  ].filter(Boolean).join(" ").length;
}

function scoreRevisionFeedbackFit(params: {
  candidate: AiDealCopyVariant;
  previousAd: SingleAd;
  intent: RevisionFeedbackIntent;
}): { hardFailReasons: string[]; softScore: number } {
  const { candidate, previousAd, intent } = params;
  if (!intent.active) return { hardFailReasons: [], softScore: 0 };

  const hardFailReasons: string[] = [];
  let softScore = 0;
  const text = normalizeRevisionCopyText([
    candidate.headline,
    candidate.short_description,
    candidate.push_body || candidate.push_notification,
    candidate.social_caption,
  ].filter(Boolean).join(" "));

  for (const banned of intent.bannedTerms) {
    if (banned && text.includes(banned)) hardFailReasons.push("uses_banned_feedback_term");
  }

  const headlineChanged = revisionHeadlineChanged(candidate, previousAd);
  if (intent.requiresHeadlineChange && !headlineChanged) {
    hardFailReasons.push("headline_unchanged_for_headline_feedback");
  }
  if (headlineChanged) softScore += 2;

  if (intent.wantsShorter) {
    const previousLength = revisionPreviousVisibleLength(previousAd);
    const nextLength = revisionCandidateVisibleLength(candidate);
    softScore += nextLength <= Math.max(80, previousLength * 0.88) ? 5 : -3;
  }

  if (intent.wantsDirect) {
    if (candidate.headline.length <= 58 && candidate.short_description.length <= 145) softScore += 3;
    if (/[;:]/.test(candidate.headline)) softScore -= 1;
  }

  if (intent.wantsLocal) {
    if (candidate.strategy_id === "local_discovery" || candidate.strategy_id === "merchant_specific") softScore += 3;
    if (/\b(?:local|nearby|neighborhood|regulars|community|around here|on your way)\b/.test(text)) softScore += 1;
  }

  if (intent.wantsWarmer) {
    if (/\b(?:you|your|treat|favorite|bring|share|break|stop by|on us)\b/.test(text)) softScore += 2;
  }

  if (intent.wantsPremium) {
    if (candidate.strategy_id === "product_desire" || /\b(?:crafted|polished|elevated|signature)\b/.test(text)) softScore += 2;
    if (/\b(?:cheap|bargain|steal)\b/.test(text)) softScore -= 3;
  }

  return { hardFailReasons, softScore };
}

function filterRevisionCandidatesByFeedback(params: {
  candidates: AiDealCopyVariant[];
  previousAd: SingleAd;
  revisionFeedback?: string;
}): AiDealCopyVariant[] {
  const intent = parseRevisionFeedbackIntent(params.revisionFeedback);
  if (!intent.active) return params.candidates;

  const scored = params.candidates.map((candidate) => ({
    candidate,
    ...scoreRevisionFeedbackFit({ candidate, previousAd: params.previousAd, intent }),
  }));
  const hardPassed = scored.filter((entry) => entry.hardFailReasons.length === 0);
  if (hardPassed.length === 0) return [];

  const positiveMatches = hardPassed.filter((entry) => entry.softScore > 0);
  const pool = positiveMatches.length > 0 ? positiveMatches : hardPassed;
  return pool
    .sort((left, right) => right.softScore - left.softScore)
    .map((entry) => entry.candidate);
}

function normalizePosterHeadlineText(value: string | null | undefined): string {
  return typeof value === "string"
    ? value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9%+\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    : "";
}

function stripPosterHeadlineFillers(value: string): string {
  return normalizePosterHeadlineText(value)
    .replace(/^(?:try\s+our|try\s+the|our|the|a|an|any|one|1)\s+/, "")
    .replace(/\s+(?:deal|offer|special|promo)$/g, "")
    .trim();
}

function posterOfferItemNames(contract: DealOfferContract): string[] {
  return [
    contract.requiredPurchase?.itemName,
    contract.freeReward?.itemName,
    contract.singleItemDiscount?.itemName,
  ]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map(stripPosterHeadlineFillers)
    .filter(Boolean);
}

function isPosterItemOnlyHeadline(headline: string, itemName: string): boolean {
  const cleanHeadline = stripPosterHeadlineFillers(headline);
  const cleanItem = stripPosterHeadlineFillers(itemName);
  if (!cleanHeadline || !cleanItem) return false;
  if (cleanHeadline === cleanItem) return true;

  const headlineWords = cleanHeadline.split(/\s+/).filter((word) => word.length > 1);
  const itemWords = new Set(cleanItem.split(/\s+/).filter((word) => word.length > 1));
  return headlineWords.length >= 2 && headlineWords.every((word) => itemWords.has(word));
}

function posterHeadlineGateReasons(candidate: AiDealCopyVariant, contract: DealOfferContract): string[] {
  const headline = normalizePosterHeadlineText(candidate.headline);
  const reasons: string[] = [];
  if (!headline) return reasons;
  if (/^try\s+our\b/.test(headline)) reasons.push("POSTER_HEADLINE_TRY_OUR");
  if (posterOfferItemNames(contract).some((itemName) => isPosterItemOnlyHeadline(headline, itemName))) {
    reasons.push("POSTER_HEADLINE_ITEM_ONLY");
  }

  const canonicalOffer = normalizePosterHeadlineText(contract.canonicalOfferLine);
  if (canonicalOffer && headline === canonicalOffer) {
    reasons.push("POSTER_HEADLINE_REPEATS_LOCKED_OFFER");
  }
  return [...new Set(reasons)];
}

async function prepareCopyCandidates(params: {
  variants: AiDealCopyVariant[];
  creativeBrief: unknown;
  attemptNumber: 1 | 2;
  generationProvider?: string;
  openAiKey: string;
  geminiApiKey?: string | null;
  businessContext: BusinessContext;
  merchantProfile: MerchantCreativeProfile;
  offerContract: DealOfferContract;
  costContext: AiCostContext;
  creativeFormat: "standard_card" | "poster_v1";
}): Promise<{
  variants: AiDealCopyVariant[];
  telemetry: CopyQualityTelemetry;
  judgeAttempts: ProviderAttempt[];
  judgeProvider?: string;
  judgeModel?: string;
}> {
  const telemetry: CopyQualityTelemetry = {
    attempt_number: params.attemptNumber,
    creative_brief: params.creativeBrief,
    style_gate_rejected: [],
    diversity: {
      checked: false,
      ok: true,
      hard_failures: [],
      warnings: [],
    },
    preliminary_scores: [],
    judge: {
      enabled: envFlag("AI_V3_INDEPENDENT_JUDGE_ENABLED", false),
      used: false,
      skipped_reason: null,
      provider: null,
      model: null,
      pass: null,
      winner_candidate_id: null,
      ranked_candidate_ids: [],
      hard_failures: [],
      feedback: [],
    },
  };

  const styleSafe = params.variants.filter((variant, index) => {
    const gate = evaluateAdCopyStyleGate({
      copy: styleGateCopy(variant),
      provenance: {
        displayHook: "ai_generated",
        supportingLine: "ai_generated",
        cta: "ai_generated",
        pushTitle: "ai_generated",
        pushBody: "ai_generated",
        socialCaption: "ai_generated",
      },
      requiredSpecificTerms: params.offerContract.aiRules.mustUseExactItemNames,
    });
    const posterReasons = params.creativeFormat === "poster_v1"
      ? posterHeadlineGateReasons(variant, params.offerContract)
      : [];
    if (gate.ok && posterReasons.length === 0) return true;
    telemetry.style_gate_rejected.push({
      candidate_id: candidateId(variant, index),
      reasons: [...new Set([
        ...gate.failures.flatMap((failure) => failure.reasons),
        ...posterReasons,
      ])],
    });
    return false;
  });

  const hasStrategyMetadata = styleSafe.some((variant) => variant.strategy_id);
  if (hasStrategyMetadata) {
    const diversity = checkAdCandidateDiversity(styleSafe);
    telemetry.diversity = {
      checked: true,
      ok: diversity.ok,
      hard_failures: diversity.hardFailures.map((issue) => ({
        code: issue.code,
        candidate_ids: issue.candidateIds,
        ...(typeof issue.score === "number" ? { score: issue.score } : {}),
      })),
      warnings: diversity.warnings.map((issue) => ({
        code: issue.code,
        candidate_ids: issue.candidateIds,
        ...(typeof issue.score === "number" ? { score: issue.score } : {}),
      })),
    };
    if (!diversity.ok) {
      return { variants: [], telemetry, judgeAttempts: [] };
    }
  }

  const ranked = rankCandidatesDeterministically(styleSafe, params.offerContract, params.merchantProfile);
  telemetry.preliminary_scores = ranked.map((variant, index) => ({
    candidate_id: candidateId(variant, index),
    strategy_id: variant.strategy_id ?? null,
    score: variant.preliminary_score ?? 0,
  }));

  if (!telemetry.judge.enabled) {
    telemetry.judge.skipped_reason = "feature_flag_disabled";
    return { variants: ranked, telemetry, judgeAttempts: [] };
  }
  if (params.generationProvider === "gemini") {
    telemetry.judge.skipped_reason = "same_provider_fallback";
    return { variants: ranked, telemetry, judgeAttempts: [] };
  }
  if (!params.geminiApiKey) {
    telemetry.judge.skipped_reason = "gemini_api_key_missing";
    return { variants: ranked, telemetry, judgeAttempts: [] };
  }

  const judgeCandidates = ranked
    .filter((variant) => validateAiCopyAgainstOffer(variant, params.offerContract).valid)
    .slice(0, 5);
  if (judgeCandidates.length < 2) {
    telemetry.judge.skipped_reason = "fewer_than_two_valid_candidates";
    return { variants: ranked, telemetry, judgeAttempts: [] };
  }

  const shuffled = seededShuffle(judgeCandidates, `${params.costContext.requestGroupId}:${params.attemptNumber}`);
  const { system, userText, jsonSchema } = buildCandidateJudgePrompt({
    offerFacts: offerFactsForJudge(params.offerContract),
    categoryPlaybookBlock: buildCategoryAdPlaybookPromptBlock(params.businessContext.category),
    merchantProfileBlock: buildMerchantCreativeProfilePromptBlock(params.merchantProfile),
    creativeBrief: params.creativeBrief,
    candidates: shuffled,
  });

  try {
    const result = await generateStructuredText<typeof jsonSchema, CandidateJudgeResult>({
      operation: "candidate_judge",
      systemPrompt: system,
      userPrompt: userText,
      jsonSchema,
      maxOutputTokens: 780,
      timeoutMs: envNumber("AI_JUDGE_TIMEOUT_MS", 9_000),
      generationRunId: params.costContext.requestGroupId,
      promptVersion: CANDIDATE_JUDGE_PROMPT_VERSION,
      reasoningLevel: "medium",
    }, {
      openAiApiKey: params.openAiKey,
      geminiApiKey: params.geminiApiKey,
      admin: params.costContext.admin,
      config: makeJudgeConfig(),
    });
    await logTextProviderAttempts(params.costContext, "candidate_judge", result.attempts);
    const judge = normalizeCandidateJudgeResult(result.value);
    telemetry.judge.used = judge !== null;
    telemetry.judge.provider = result.provider;
    telemetry.judge.model = result.model;
    telemetry.judge.pass = judge?.pass ?? false;
    telemetry.judge.winner_candidate_id = judge?.winnerCandidateId ?? null;
    telemetry.judge.ranked_candidate_ids = judge?.rankedCandidateIds ?? [];
    telemetry.judge.hard_failures = judge?.hardFailReasons.map((reason) => ({
      candidate_id: reason.candidateId,
      code: reason.code,
    })) ?? [];
    telemetry.judge.feedback = judge?.conciseFeedback ?? [];
    if (!judge) {
      telemetry.judge.skipped_reason = "judge_output_invalid";
      return {
        variants: ranked,
        telemetry,
        judgeAttempts: result.attempts,
        judgeProvider: result.provider,
        judgeModel: result.model,
      };
    }
    return {
      variants: applyJudgeScoresToCandidates(ranked, judge),
      telemetry,
      judgeAttempts: result.attempts,
      judgeProvider: result.provider,
      judgeModel: result.model,
    };
  } catch (e) {
    const attempts = (e as { attempts?: ProviderAttempt[] })?.attempts ?? [];
    await logTextProviderAttempts(params.costContext, "candidate_judge", attempts);
    telemetry.judge.skipped_reason = "judge_unavailable";
    telemetry.judge.feedback = ["Candidate judge unavailable."];
    return { variants: ranked, telemetry, judgeAttempts: attempts };
  }
}

type ImageQaTelemetry = {
  checked: boolean;
  attempts: number;
  missingItems: string[];
  regenerated: boolean;
  unavailable: boolean;
  sourceType: AdImageQaSourceType;
  decision: AdImageQaDecision;
  hardFailReasons: string[];
  warningCodes: string[];
  merchantOverrideAllowed: boolean;
  merchantOverrideAcknowledged: boolean;
  sourceAware: SourceAwareImageQaResult | null;
};

function imageQaTelemetryFromSourceAware(
  sourceAware: SourceAwareImageQaResult,
  attempts = 0,
  regenerated = false,
): ImageQaTelemetry {
  return {
    checked: sourceAware.checked,
    attempts,
    missingItems: sourceAware.missingItems,
    regenerated,
    unavailable: !sourceAware.available,
    sourceType: sourceAware.sourceType,
    decision: sourceAware.decision,
    hardFailReasons: sourceAware.hardFailReasons,
    warningCodes: sourceAware.warningCodes,
    merchantOverrideAllowed: sourceAware.merchantOverrideAllowed,
    merchantOverrideAcknowledged: sourceAware.merchantOverrideAcknowledged,
    sourceAware,
  };
}

function skippedImageQaTelemetry(sourceType: AdImageQaSourceType = "deterministic_fallback"): ImageQaTelemetry {
  return imageQaTelemetryFromSourceAware(
    normalizeSourceAwareImageQaResult({
      raw: { 
        all_required_items_present: true,
        items: [],
        missing_items: [],
        has_readable_text: false,
        has_forbidden_logo_or_brand: false,
        has_qr_code: false,
        has_unrelated_mascot_or_animal: false,
        has_crop_or_overlay_risk: false,
        forbidden_elements: [],
        crop_or_overlay_issues: [],
        notes: "Image QA not required for this source.",
      },
      requiredVisualItems: [],
      sourceType,
    }),
  );
}

function originalPhotoQaTelemetry(merchantOverrideAcknowledged: boolean): ImageQaTelemetry {
  return imageQaTelemetryFromSourceAware(
    unavailableSourceAwareImageQaResult({
      sourceType: "merchant_original",
      merchantOverrideAcknowledged,
    }),
  );
}

function producedImageSelection(params: {
  image: ProducedImageBase;
  sourcePhotoPath: string | null;
  editMode: MerchantImageEditMode;
  selectedAt?: string;
}): AdImageSelection {
  return buildAdImageSelection({
    photoSource: params.image.source,
    editMode: params.editMode,
    sourcePhotoPath: params.sourcePhotoPath,
    selectedStoragePath: params.image.posterStoragePath,
    provider: params.image.provider,
    model: params.image.model,
    promptVersion: params.image.prompt ? "image_prompt_v3" : null,
    qa: {
      checked: params.image.qa.checked,
      sourceType: imageSourceModeFromPhotoSource(params.image.source),
      decision: params.image.qa.decision,
      hardFailReasons: params.image.qa.hardFailReasons,
      warningCodes: params.image.qa.warningCodes,
      missingItems: params.image.qa.missingItems,
      unavailable: params.image.qa.unavailable,
      merchantOverrideAllowed: params.image.qa.merchantOverrideAllowed,
      merchantOverrideAcknowledged: params.image.qa.merchantOverrideAcknowledged,
    },
  });
}

function withImageSelection(
  image: ProducedImageBase,
  params: {
    sourcePhotoPath: string | null;
    editMode: MerchantImageEditMode;
  },
): ProducedImage {
  return {
    ...image,
    selection: producedImageSelection({
      image,
      sourcePhotoPath: params.sourcePhotoPath,
      editMode: params.editMode,
    }),
  };
}

async function fetchAdQuota(admin: SupabaseClient, businessId: string): Promise<AdQuota> {
  const monthlyLimit = Number.isFinite(DEFAULT_MONTHLY) && DEFAULT_MONTHLY > 0 ? DEFAULT_MONTHLY : 30;
  const { used } = await countAiQuotaUsage(admin, {
    businessId,
    scope: "ad_generation",
    monthStartIso: utcMonthStartIso(),
  });
  return {
    used,
    limit: monthlyLimit,
    remaining: Math.max(0, monthlyLimit - used),
  };
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

function visionQaPrimaryProvider(): "gemini" | "openai" {
  const configured = (Deno.env.get("AI_VISION_PRIMARY_PROVIDER") ?? "gemini").trim().toLowerCase();
  return configured === "openai" ? "openai" : "gemini";
}

function visionQaFallbackEnabled(): boolean {
  return envFlag("AI_VISION_FALLBACK_ENABLED", true);
}

function makeImageQaConfig() {
  let geminiTextModel = "gemini";
  let geminiConfigured = true;
  try {
    geminiTextModel = resolveGeminiTextModel(Deno.env, "GEMINI_JUDGE_MODEL");
  } catch {
    geminiConfigured = false;
    console.log(JSON.stringify({
      tag: "ai_ads_v2",
      event: "gemini_image_qa_config_error",
      errorCode: "AI_TEXT_CONFIG_INVALID",
    }));
  }
  // Vision QA defaults to Gemini (cheap, multimodal) with OpenAI as a guarded
  // fallback. This keeps the offer image inspection off the expensive OpenAI
  // reasoning model on the hot path. If the Gemini judge model is misconfigured,
  // QA falls back to OpenAI so the guardrail never silently disappears.
  const requestedPrimary = visionQaPrimaryProvider();
  const primaryProvider: "gemini" | "openai" =
    requestedPrimary === "gemini" && !geminiConfigured ? "openai" : requestedPrimary;
  const fallbackProvider: "gemini" | "openai" = primaryProvider === "gemini" ? "openai" : "gemini";
  const fallbackEnabled =
    fallbackProvider === "gemini"
      ? geminiConfigured && visionQaFallbackEnabled()
      : visionQaFallbackEnabled();
  return {
    routerEnabled: true,
    primaryProvider,
    fallbackEnabled,
    fallbackProvider,
    circuitBreakerEnabled: false,
    openAiModel: CHAT_MODEL,
    geminiTextModel,
    primaryTimeoutMs: envNumber("AI_VISION_PRIMARY_TIMEOUT_MS", 25_000),
    fallbackTimeoutMs: envNumber("AI_VISION_FALLBACK_TIMEOUT_MS", 14_000),
    transientRetryMax: 0,
    retryAfterFullTimeout: false,
  };
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

function imageRevisionInstruction(params: {
  revisionPreset?: string;
  revisionFeedback?: string;
}): string | undefined {
  const raw = `${params.revisionPreset ?? ""} ${params.revisionFeedback ?? ""}`
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 500);
  if (!raw) return undefined;
  const text = raw.toLowerCase();
  const directives: string[] = [];
  if (text.includes("revisepresettryanotherimage") || /\btry another|different image|new image\b/.test(text)) {
    directives.push("Create a clearly different composition from the previous image while preserving the same required offer item identities.");
  }
  if (text.includes("revisepresetgenangle") || /\bdifferent angle|another angle\b/.test(text)) {
    directives.push("Change the camera angle and product placement; do not reuse the same framing.");
  }
  if (text.includes("revisepresetgenbrighter") || text.includes("revisepresetphotobrighter") || /\bbrighter|cleaner|vibrant\b/.test(text)) {
    directives.push("Make the image brighter, cleaner, and higher contrast with natural daylight.");
  }
  if (text.includes("revisepresetgenmoodier") || /\bmoodier|editorial|premium\b/.test(text)) {
    directives.push("Make the image more premium and editorial with richer lighting and a more deliberate product-photo composition.");
  }
  if (text.includes("revisepresetphotocrop") || /\btighter crop|closer crop|crop\b/.test(text)) {
    directives.push("Use a noticeably tighter crop while keeping the full required item visible and away from unsafe edges.");
  }
  if (text.includes("revisepresetphotobg") || /\bdifferent background|background\b/.test(text)) {
    directives.push("Replace the background with a visibly different clean cafe surface or backdrop.");
  }
  if (directives.length === 0) {
    directives.push(`Apply this merchant image revision as style, lighting, crop, composition, or background guidance only: ${raw}`);
  }
  return [
    ...directives,
    "Do not add text, prices, discounts, QR codes, logos, watermarks, people, characters, or unrelated props.",
    "Do not change the offer item identities or invent extra offer items.",
  ].join(" ");
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

async function findStockImageFallbacks(params: {
  admin: SupabaseClient;
  requiredVisualItems: readonly string[];
}): Promise<string[]> {
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
    if (error || !Array.isArray(data)) return [];
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
    return ranked.map((row) => row.storagePath);
  } catch {
    return [];
  }
}

async function inspectGeneratedImageForOffer(params: {
  openAiKey: string;
  geminiApiKey?: string | null;
  imageBytes: Uint8Array;
  requiredVisualItems: readonly string[];
  costContext: AiCostContext;
  sourceType?: AdImageQaSourceType;
}): Promise<QuickDealImageQaResult | null> {
  const requiredVisualItems = params.requiredVisualItems.filter((item) => item.trim().length > 0);
  try {
    const result = await generateStructuredText<typeof QUICK_DEAL_IMAGE_QA_SCHEMA, QuickDealImageQaResult>(
      {
        operation: "image_qa",
        systemPrompt: "You are Twofer's image quality inspector. Return JSON only.",
        userPrompt: buildAdImageQaPrompt({
          sourceType: params.sourceType ?? "ai_generated",
          requiredVisualItems,
        }),
        jsonSchema: QUICK_DEAL_IMAGE_QA_SCHEMA,
        imageInputs: [{ bytes: params.imageBytes, mimeType: "image/png" }],
        maxOutputTokens: 900,
        timeoutMs: envNumber("AI_VISION_PRIMARY_TIMEOUT_MS", 25_000),
        generationRunId: params.costContext.requestGroupId,
        promptVersion: "AI_IMAGE_QA_V1",
        reasoningLevel: "low",
      },
      {
        openAiApiKey: params.openAiKey,
        geminiApiKey: params.geminiApiKey,
        admin: params.costContext.admin,
        config: makeImageQaConfig(),
      },
    );
    await logTextProviderAttempts(params.costContext, "image_qa", result.attempts);
    return normalizeQuickDealImageQaResult(result.value, requiredVisualItems);
  } catch (e) {
    const attempts = (e as { attempts?: ProviderAttempt[] })?.attempts ?? [];
    await logTextProviderAttempts(params.costContext, "image_qa", attempts);
    console.log(JSON.stringify({ tag: "ai_ads_v2", event: "image_qa_error", errorCode: "AI_IMAGE_QA_UNAVAILABLE" }));
    return null;
  }
}

async function sourceAwareQaForImageBytes(params: {
  openAiKey: string;
  geminiApiKey?: string | null;
  imageBytes: Uint8Array;
  requiredVisualItems: readonly string[];
  costContext: AiCostContext;
  sourceType: AdImageQaSourceType;
  merchantOverrideAcknowledged?: boolean;
}): Promise<SourceAwareImageQaResult> {
  const requiredVisualItems = params.requiredVisualItems.filter((item) => item.trim().length > 0);
  const raw = await inspectGeneratedImageForOffer({
    openAiKey: params.openAiKey,
    geminiApiKey: params.geminiApiKey,
    imageBytes: params.imageBytes,
    requiredVisualItems,
    costContext: params.costContext,
    sourceType: params.sourceType,
  });
  return normalizeSourceAwareImageQaResult({
    raw,
    requiredVisualItems,
    sourceType: params.sourceType,
    merchantOverrideAcknowledged: params.merchantOverrideAcknowledged,
  });
}

function imageQaBlocksAutomaticSelection(qa: ImageQaTelemetry): boolean {
  return qa.decision === "block" || qa.hardFailReasons.length > 0;
}

async function fetchUploadedDealPhotoBytes(params: {
  userClient: SupabaseClient;
  photoPath: string;
  eventName: string;
}): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const { data: signed, error: signedErr } = await params.userClient.storage
    .from("deal-photos")
    .createSignedUrl(params.photoPath, 60 * 60);
  if (signedErr || !signed?.signedUrl) {
    console.log(
      JSON.stringify({
        tag: "ai_ads_v2",
        event: params.eventName,
        err: signedErr?.message?.slice(0, 200),
      }),
    );
    return null;
  }

  try {
    const fetched = await fetch(signed.signedUrl);
    if (!fetched.ok) {
      console.log(JSON.stringify({ tag: "ai_ads_v2", event: `${params.eventName}_fetch_failed`, status: fetched.status }));
      return null;
    }
    return {
      mimeType: fetched.headers.get("content-type") || "image/png",
      bytes: new Uint8Array(await fetched.arrayBuffer()),
    };
  } catch {
    console.log(JSON.stringify({ tag: "ai_ads_v2", event: `${params.eventName}_fetch_error`, errorCode: "FETCH_ERROR" }));
    return null;
  }
}

async function qaMerchantOriginalPhoto(params: {
  openAiKey: string;
  geminiApiKey?: string | null;
  imageBytes: Uint8Array;
  requiredVisualItems: readonly string[];
  costContext: AiCostContext;
  merchantOverrideAcknowledged: boolean;
}): Promise<ImageQaTelemetry> {
  const sourceAware = await sourceAwareQaForImageBytes({
    openAiKey: params.openAiKey,
    geminiApiKey: params.geminiApiKey,
    imageBytes: params.imageBytes,
    requiredVisualItems: params.requiredVisualItems,
    costContext: params.costContext,
    sourceType: "merchant_original",
    merchantOverrideAcknowledged: params.merchantOverrideAcknowledged,
  });
  return imageQaTelemetryFromSourceAware(sourceAware, 1);
}

async function fetchApprovedStockImageBytes(params: {
  admin: SupabaseClient;
  stockPath: string;
}): Promise<Uint8Array | null> {
  const { data: signed, error: signedErr } = await params.admin.storage
    .from("deal-photos")
    .createSignedUrl(params.stockPath, 60 * 60);
  if (signedErr || !signed?.signedUrl) {
    console.log(
      JSON.stringify({
        tag: "ai_ads_v2",
        event: "stock_signed_url_failed",
        err: signedErr?.message?.slice(0, 200),
      }),
    );
    return null;
  }

  try {
    const fetched = await fetch(signed.signedUrl);
    if (!fetched.ok) {
      console.log(JSON.stringify({ tag: "ai_ads_v2", event: "stock_fetch_failed", status: fetched.status }));
      return null;
    }
    return new Uint8Array(await fetched.arrayBuffer());
  } catch {
    console.log(JSON.stringify({ tag: "ai_ads_v2", event: "stock_fetch_error", errorCode: "FETCH_ERROR" }));
    return null;
  }
}

async function qaApprovedStockFallback(params: {
  admin: SupabaseClient;
  openAiKey: string;
  geminiApiKey?: string | null;
  stockPath: string;
  requiredVisualItems: readonly string[];
  costContext: AiCostContext;
}): Promise<ImageQaTelemetry | null> {
  const imageBytes = await fetchApprovedStockImageBytes({
    admin: params.admin,
    stockPath: params.stockPath,
  });
  if (!imageBytes) {
    const sourceAware = unavailableSourceAwareImageQaResult({ sourceType: "approved_stock" });
    const telemetry = imageQaTelemetryFromSourceAware(sourceAware, 0);
    console.log(
      JSON.stringify({
        tag: "ai_ads_v2",
        event: "stock_image_qa_blocked",
        decision: telemetry.decision,
        hardFailReasons: telemetry.hardFailReasons,
      }),
    );
    return null;
  }

  const sourceAware = await sourceAwareQaForImageBytes({
    openAiKey: params.openAiKey,
    geminiApiKey: params.geminiApiKey,
    imageBytes,
    requiredVisualItems: params.requiredVisualItems,
    costContext: params.costContext,
    sourceType: "approved_stock",
  });
  const telemetry = imageQaTelemetryFromSourceAware(sourceAware, 1);
  if (shouldFailClosedForImageQa(sourceAware)) {
    console.log(
      JSON.stringify({
        tag: "ai_ads_v2",
        event: "stock_image_qa_blocked",
        decision: telemetry.decision,
        hardFailReasons: telemetry.hardFailReasons.slice(0, 8),
        missingItems: telemetry.missingItems.slice(0, 8),
      }),
    );
    return null;
  }
  return telemetry;
}

type OpenAiProducedImage = {
  posterStoragePath: string | null;
  source: SingleAd["photo_source"];
  treatment: PhotoTreatment | null;
  prompt: string | null;
  qa: ImageQaTelemetry;
};

type ProducedImageBase = OpenAiProducedImage & {
  provider: AiImageProvider;
  model: string | null;
  estimatedCostUsd: number;
};

type ProducedImage = ProducedImageBase & {
  selection: AdImageSelection;
};

async function produceImageOpenAiOnly(params: {
  openAiKey: string;
  geminiApiKey?: string | null;
  admin: SupabaseClient;
  userClient: SupabaseClient;
  businessId: string;
  photoPath: string | null;
  photoTreatment: PhotoTreatment | null;
  research: ItemResearch;
  itemHint: string;
  businessName: string;
  offerContract: DealOfferContract;
  imageEditMode: MerchantImageEditMode;
  customImageEditInstruction?: string;
  merchantOverrideAcknowledged: boolean;
  revisionPreset?: string;
  revisionFeedback?: string;
  costContext: AiCostContext;
  imageAspectRatio: AiImageAspectRatio;
}): Promise<OpenAiProducedImage> {
  const {
    openAiKey,
    geminiApiKey,
    admin,
    userClient,
    businessId,
    photoPath,
    photoTreatment,
    research,
    itemHint,
    businessName,
    offerContract,
    merchantOverrideAcknowledged,
    costContext,
  } = params;

  const ts = Date.now();
  const rand = crypto.randomUUID().slice(0, 8);
  const requiredVisualItems = buildRequiredVisualItems(offerContract);
  let originalQa = originalPhotoQaTelemetry(merchantOverrideAcknowledged);
  const originalPhotoResult = (): OpenAiProducedImage => ({
    posterStoragePath: photoPath,
    source: "uploaded_original",
    treatment: null,
    prompt: null,
    qa: originalQa,
  });

  // Path A — owner uploaded a photo
  if (photoPath) {
    const uploadedPhoto = await fetchUploadedDealPhotoBytes({
      userClient,
      photoPath,
      eventName: "photo_signed_url_failed",
    });
    if (uploadedPhoto) {
      originalQa = await qaMerchantOriginalPhoto({
        openAiKey,
        geminiApiKey,
        imageBytes: uploadedPhoto.bytes,
        requiredVisualItems,
        costContext,
        merchantOverrideAcknowledged,
      });
    }

    if (!photoTreatment) {
      // No enhancement: copy the uploaded photo to a stable poster path
      // (the original is already in deal-photos; we just point the ad at it)
      if (!imageQaBlocksAutomaticSelection(originalQa)) return originalPhotoResult();
      console.log(
        JSON.stringify({
          tag: "ai_ads_v2",
          event: "merchant_original_image_qa_blocked",
          hardFailReasons: originalQa.hardFailReasons.slice(0, 8),
          missingItems: originalQa.missingItems.slice(0, 8),
        }),
      );
    } else if (!uploadedPhoto) {
      return originalPhotoResult();
    } else {
      const imageBytes = uploadedPhoto.bytes;
      const imageMime = uploadedPhoto.mimeType;

      // Source guard anchor: customEditInstruction: params.imageEditMode === "custom"
      const enhancedResult = await enhanceUploadedPhotoWithTelemetry({
        openAiKey,
        imageBytes,
        imageMime,
        treatment: photoTreatment,
        customEditInstruction: [
          params.imageEditMode === "custom" ? params.customImageEditInstruction : undefined,
          imageRevisionInstruction({
            revisionPreset: params.revisionPreset,
            revisionFeedback: params.revisionFeedback,
          }),
        ].filter(Boolean).join(" "),
      });
      await logImageAttempts(costContext, "image_edit", enhancedResult.attempts);
      const enhanced = enhancedResult.bytes;

      if (!enhanced) {
        // Enhancement failed — fall back to the original photo only if QA did not hard-block it.
        if (!imageQaBlocksAutomaticSelection(originalQa)) return originalPhotoResult();
      } else {
        const editQa = await sourceAwareQaForImageBytes({
          openAiKey,
          geminiApiKey,
          imageBytes: enhanced,
          requiredVisualItems,
          costContext,
          sourceType: "merchant_ai_edit",
        });
        if (shouldFailClosedForImageQa(editQa)) {
          if (!imageQaBlocksAutomaticSelection(originalQa)) return originalPhotoResult();
        } else {
          const editQaTelemetry = imageQaTelemetryFromSourceAware(editQa, requiredVisualItems.length > 0 ? 1 : 0);

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
            if (!imageQaBlocksAutomaticSelection(originalQa)) return originalPhotoResult();
          } else {
            return { posterStoragePath: enhancedPath, source: "uploaded_enhanced", treatment: photoTreatment, prompt: null, qa: editQaTelemetry };
          }
        }
      }
    }
  }

  // Path B — no photo: generate via OpenAI Images (GPT image model)
  const itemName = requiredVisualItems.length > 0
    ? requiredVisualItems.join(" and ")
    : research.item_name || itemHint || "menu item";
  const prompt = buildPhotoAdImagePrompt({
    itemName,
    itemDescription: research.is_familiar ? research.description : "",
    businessName,
    requiredVisualItems,
    visualRevisionInstruction: imageRevisionInstruction({
      revisionPreset: params.revisionPreset,
      revisionFeedback: params.revisionFeedback,
    }),
    aspectRatio: params.imageAspectRatio === "4:5" ? "4:5" : "1:1",
  });
  let imageGeneration = await generatePhotoAdImageWithTelemetry(openAiKey, prompt);
  await logImageAttempts(costContext, "image_generation", imageGeneration.attempts);
  let png = imageGeneration.bytes;
  const qa: ImageQaTelemetry = imageQaTelemetryFromSourceAware(
    normalizeSourceAwareImageQaResult({
      raw: {
        all_required_items_present: true,
        items: [],
        missing_items: [],
        has_readable_text: false,
        has_forbidden_logo_or_brand: false,
        has_qr_code: false,
        has_unrelated_mascot_or_animal: false,
        has_crop_or_overlay_risk: false,
        forbidden_elements: [],
        crop_or_overlay_issues: [],
        notes: requiredVisualItems.length > 0 ? "Image QA pending." : "No required visual items for this offer.",
      },
      requiredVisualItems: [],
      sourceType: "ai_generated",
    }),
  );
  if (!png) {
    return { posterStoragePath: null, source: "generated", treatment: null, prompt, qa };
  }

  if (requiredVisualItems.length > 0) {
    const firstQa = await inspectGeneratedImageForOffer({
      openAiKey,
      geminiApiKey,
      imageBytes: png,
      requiredVisualItems,
      costContext,
      sourceType: "ai_generated",
    });
    qa.attempts = 1;
    if (!firstQa) {
      Object.assign(
        qa,
        imageQaTelemetryFromSourceAware(
          unavailableSourceAwareImageQaResult({ sourceType: "ai_generated" }),
          1,
          qa.regenerated,
        ),
      );
    } else if (!firstQa.all_required_items_present) {
      Object.assign(
        qa,
        imageQaTelemetryFromSourceAware(
          normalizeSourceAwareImageQaResult({
            raw: firstQa,
            requiredVisualItems,
            sourceType: "ai_generated",
          }),
          1,
          qa.regenerated,
        ),
      );
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
          geminiApiKey,
          imageBytes: retryPng,
          requiredVisualItems,
          costContext,
          sourceType: "ai_generated",
        });
        qa.attempts = 2;
        if (!retryQa) {
          Object.assign(
            qa,
            imageQaTelemetryFromSourceAware(
              unavailableSourceAwareImageQaResult({ sourceType: "ai_generated" }),
              2,
              true,
            ),
          );
        } else if (retryQa.all_required_items_present || retryQa.missing_items.length < firstQa.missing_items.length) {
          Object.assign(
            qa,
            imageQaTelemetryFromSourceAware(
              normalizeSourceAwareImageQaResult({
                raw: retryQa,
                requiredVisualItems,
                sourceType: "ai_generated",
              }),
              2,
              true,
            ),
          );
          png = retryPng;
        }
      }
    } else {
      Object.assign(
        qa,
        imageQaTelemetryFromSourceAware(
          normalizeSourceAwareImageQaResult({
            raw: firstQa,
            requiredVisualItems,
            sourceType: "ai_generated",
          }),
          1,
          qa.regenerated,
        ),
      );
    }
  }
  if (qa.unavailable || qa.hardFailReasons.length > 0 || (qa.missingItems.length > 0 && !qa.unavailable)) {
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

function withOpenAiImageMetadata(result: OpenAiProducedImage): ProducedImageBase {
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
  openAiKey: string;
  geminiApiKey?: string | null;
  prompt: string | null;
  requiredVisualItems: readonly string[];
  imageProviderConfig: AiImageProviderConfig;
  costContext: AiCostContext;
  sourcePhotoPath?: string | null;
  editMode?: MerchantImageEditMode;
}): Promise<ProducedImage> {
  if (params.imageProviderConfig.stockFallbackEnabled) {
    const stockPaths = await findStockImageFallbacks({
      admin: params.admin,
      requiredVisualItems: params.requiredVisualItems,
    });
    const maxStockQaCandidates = Math.max(1, Math.min(envNumber("AI_STOCK_QA_CANDIDATE_LIMIT", 3), 10));
    for (const stockPath of stockPaths.slice(0, maxStockQaCandidates)) {
      const stockQa = await qaApprovedStockFallback({
        admin: params.admin,
        openAiKey: params.openAiKey,
        geminiApiKey: params.geminiApiKey,
        stockPath,
        requiredVisualItems: params.requiredVisualItems,
        costContext: params.costContext,
      });
      if (!stockQa) continue;
      return withImageSelection(
        {
          posterStoragePath: stockPath,
          source: "stock",
          treatment: null,
          prompt: params.prompt,
          qa: stockQa,
          provider: "stock",
          model: null,
          estimatedCostUsd: 0,
        },
        {
          sourcePhotoPath: params.sourcePhotoPath ?? null,
          editMode: params.editMode ?? "none",
        },
      );
    }
  }

  return withImageSelection(
    {
      posterStoragePath: null,
      source: "copy_only",
      treatment: null,
      prompt: params.prompt,
      qa: skippedImageQaTelemetry("deterministic_fallback"),
      provider: "none",
      model: null,
      estimatedCostUsd: 0,
    },
    {
      sourcePhotoPath: params.sourcePhotoPath ?? null,
      editMode: params.editMode ?? "none",
    },
  );
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
  imageSourceMode: MerchantImageSourceMode;
  imageEditMode: MerchantImageEditMode;
  customImageEditInstruction?: string;
  merchantOverrideAcknowledged: boolean;
  revisionPreset?: string;
  revisionFeedback?: string;
  imageProviderConfig: AiImageProviderConfig;
  costContext: AiCostContext;
  imageAspectRatio: AiImageAspectRatio;
}): Promise<ProducedImage> {
  const requiredVisualItems = buildRequiredVisualItems(params.offerContract);
  const originalUploadedPhoto = async (): Promise<ProducedImage> => {
    let qa = originalPhotoQaTelemetry(params.merchantOverrideAcknowledged);
    if (params.photoPath) {
      const uploadedPhoto = await fetchUploadedDealPhotoBytes({
        userClient: params.userClient,
        photoPath: params.photoPath,
        eventName: "merchant_original_photo_signed_url_failed",
      });
      if (uploadedPhoto) {
        qa = await qaMerchantOriginalPhoto({
          openAiKey: params.openAiKey,
          geminiApiKey: params.geminiApiKey,
          imageBytes: uploadedPhoto.bytes,
          requiredVisualItems,
          costContext: params.costContext,
          merchantOverrideAcknowledged: params.merchantOverrideAcknowledged,
        });
      }
    }
    return withImageSelection(
      {
        posterStoragePath: params.photoPath,
        source: "uploaded_original",
        treatment: null,
        prompt: null,
        qa,
        provider: "none",
        model: null,
        estimatedCostUsd: 0,
      },
      {
        sourcePhotoPath: params.photoPath,
        editMode: "none",
      },
    );
  };
  const generateWithoutSourcePhoto = async (): Promise<ProducedImage> =>
    produceImage({
      ...params,
      photoPath: null,
      photoTreatment: null,
      imageSourceMode: "ai_generated",
      imageEditMode: "none",
      customImageEditInstruction: undefined,
    });
  const originalUploadedPhotoOrFallback = async (): Promise<ProducedImage> => {
    const original = await originalUploadedPhoto();
    if (!imageQaBlocksAutomaticSelection(original.qa)) return original;
    console.log(
      JSON.stringify({
        tag: "ai_ads_v2",
        event: "merchant_original_image_qa_blocked",
        hardFailReasons: original.qa.hardFailReasons.slice(0, 8),
        missingItems: original.qa.missingItems.slice(0, 8),
      }),
    );
    return generateWithoutSourcePhoto();
  };
  const openAiFallback = async (): Promise<ProducedImage> => {
    const result = await produceImageOpenAiOnly(params);
    const withMetadata = withOpenAiImageMetadata(result);
    if (withMetadata.posterStoragePath || withMetadata.source === "uploaded_original") {
      return withImageSelection(withMetadata, {
        sourcePhotoPath: params.photoPath,
        editMode: withMetadata.source === "uploaded_enhanced" ? params.imageEditMode : "none",
      });
    }
    return produceFallbackImage({
      admin: params.admin,
      openAiKey: params.openAiKey,
      geminiApiKey: params.geminiApiKey,
      prompt: withMetadata.prompt,
      requiredVisualItems,
      imageProviderConfig: params.imageProviderConfig,
      costContext: params.costContext,
      sourcePhotoPath: params.photoPath,
      editMode: params.imageEditMode,
    });
  };

  if (params.imageSourceMode === "approved_stock") {
    return produceFallbackImage({
      admin: params.admin,
      openAiKey: params.openAiKey,
      geminiApiKey: params.geminiApiKey,
      prompt: null,
      requiredVisualItems,
      imageProviderConfig: params.imageProviderConfig,
      costContext: params.costContext,
      sourcePhotoPath: null,
      editMode: "none",
    });
  }

  if (params.imageSourceMode === "deterministic_fallback") {
    return withImageSelection(
      {
        posterStoragePath: null,
        source: "copy_only",
        treatment: null,
        prompt: null,
        qa: skippedImageQaTelemetry("deterministic_fallback"),
        provider: "none",
        model: null,
        estimatedCostUsd: 0,
      },
      {
        sourcePhotoPath: null,
        editMode: "none",
      },
    );
  }

  if (params.imageProviderConfig.primaryProvider === "openai") {
    return openAiFallback();
  }

  if (params.imageProviderConfig.primaryProvider === "stock") {
    return produceFallbackImage({
      admin: params.admin,
      openAiKey: params.openAiKey,
      geminiApiKey: params.geminiApiKey,
      prompt: null,
      requiredVisualItems,
      imageProviderConfig: params.imageProviderConfig,
      costContext: params.costContext,
      sourcePhotoPath: params.photoPath,
      editMode: params.imageEditMode,
    });
  }

  if (params.imageProviderConfig.primaryProvider === "none") {
    return withImageSelection(
      {
        posterStoragePath: null,
        source: "copy_only",
        treatment: null,
        prompt: null,
        qa: skippedImageQaTelemetry("deterministic_fallback"),
        provider: "none",
        model: null,
        estimatedCostUsd: 0,
      },
      {
        sourcePhotoPath: params.photoPath,
        editMode: params.imageEditMode,
      },
    );
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
  const revisionImageInstruction = imageRevisionInstruction({
    revisionPreset: params.revisionPreset,
    revisionFeedback: params.revisionFeedback,
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
    customEditInstruction: revisionImageInstruction,
    stylePreset,
    aspectRatio: params.imageAspectRatio,
    imageSize: "1K",
  });

  if (params.photoPath) {
    if (!params.photoTreatment) {
      return originalUploadedPhotoOrFallback();
    }
    if (!params.imageProviderConfig.ownerPhotoReferenceEnabled) {
      return useOpenAiFallback ? openAiFallback() : originalUploadedPhotoOrFallback();
    }

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
      return useOpenAiFallback ? openAiFallback() : originalUploadedPhotoOrFallback();
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
      return useOpenAiFallback ? openAiFallback() : originalUploadedPhotoOrFallback();
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
      referenceImages: [{ mimeType: safeImageMime(imageMime), base64: bytesToBase64(imageBytes) }],
      customEditInstruction: [
        params.imageEditMode === "custom" ? params.customImageEditInstruction : undefined,
        revisionImageInstruction,
      ].filter(Boolean).join(" "),
      stylePreset,
      aspectRatio: params.imageAspectRatio,
      imageSize: "1K",
    });
    const gemini = await generateGeminiAdImageWithTelemetry({
      apiKey: params.geminiApiKey,
      model: params.imageProviderConfig.geminiModel,
      prompt: photoPrompt,
      aspectRatio: params.imageAspectRatio,
      imageSize: "1K",
      estimatedCostUsd: params.imageProviderConfig.geminiEstimatedCost1KUsd,
      referenceImages: [{ mimeType: safeImageMime(imageMime), base64: bytesToBase64(imageBytes) }],
    });
    await logGeminiImageAttempts(params.costContext, "image_edit", gemini.attempts);

    if (!gemini.bytes) {
      return useOpenAiFallback ? openAiFallback() : originalUploadedPhotoOrFallback();
    }

    const editQa = await sourceAwareQaForImageBytes({
      openAiKey: params.openAiKey,
      geminiApiKey: params.geminiApiKey,
      imageBytes: gemini.bytes,
      requiredVisualItems,
      costContext: params.costContext,
      sourceType: "merchant_ai_edit",
    });
    if (shouldFailClosedForImageQa(editQa)) {
      return useOpenAiFallback ? openAiFallback() : originalUploadedPhotoOrFallback();
    }
    const editQaTelemetry = imageQaTelemetryFromSourceAware(editQa, requiredVisualItems.length > 0 ? 1 : 0);

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
      return useOpenAiFallback ? openAiFallback() : originalUploadedPhotoOrFallback();
    }
    return withImageSelection(
      {
        posterStoragePath: enhancedPath,
        source: "uploaded_enhanced",
        treatment: params.photoTreatment,
        prompt: gemini.prompt,
        qa: editQaTelemetry,
        provider: "gemini",
        model: gemini.model,
        estimatedCostUsd: gemini.estimatedCostUsd,
      },
      {
        sourcePhotoPath: params.photoPath,
        editMode: params.imageEditMode,
      },
    );
  }

  const gemini = await generateGeminiAdImageWithTelemetry({
    apiKey: params.geminiApiKey,
    model: params.imageProviderConfig.geminiModel,
    prompt,
    aspectRatio: params.imageAspectRatio,
    imageSize: "1K",
    estimatedCostUsd: params.imageProviderConfig.geminiEstimatedCost1KUsd,
  });
  await logGeminiImageAttempts(params.costContext, "image_generation", gemini.attempts);
  let imageBytes = gemini.bytes;
  let imageMimeType = gemini.mimeType;
  let imagePrompt = gemini.prompt;
  let estimatedCostUsd = gemini.estimatedCostUsd;
  const qa: ImageQaTelemetry = imageQaTelemetryFromSourceAware(
    normalizeSourceAwareImageQaResult({
      raw: {
        all_required_items_present: true,
        items: [],
        missing_items: [],
        has_readable_text: false,
        has_forbidden_logo_or_brand: false,
        has_qr_code: false,
        has_unrelated_mascot_or_animal: false,
        has_crop_or_overlay_risk: false,
        forbidden_elements: [],
        crop_or_overlay_issues: [],
        notes: requiredVisualItems.length > 0 ? "Image QA pending." : "No required visual items for this offer.",
      },
      requiredVisualItems: [],
      sourceType: "ai_generated",
    }),
    0,
    gemini.attempts.some((attempt) => attempt.retry && attempt.success),
  );

  if (imageBytes && requiredVisualItems.length > 0) {
    const firstQa = await inspectGeneratedImageForOffer({
      openAiKey: params.openAiKey,
      geminiApiKey: params.geminiApiKey,
      imageBytes,
      requiredVisualItems,
      costContext: params.costContext,
      sourceType: "ai_generated",
    });
    qa.attempts = 1;
    if (!firstQa) {
      Object.assign(
        qa,
        imageQaTelemetryFromSourceAware(
          unavailableSourceAwareImageQaResult({ sourceType: "ai_generated" }),
          1,
          qa.regenerated,
        ),
      );
    } else if (!firstQa.all_required_items_present) {
      Object.assign(
        qa,
        imageQaTelemetryFromSourceAware(
          normalizeSourceAwareImageQaResult({
            raw: firstQa,
            requiredVisualItems,
            sourceType: "ai_generated",
          }),
          1,
          qa.regenerated,
        ),
      );
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
        aspectRatio: params.imageAspectRatio,
        imageSize: "1K",
        estimatedCostUsd: params.imageProviderConfig.geminiEstimatedCost1KUsd,
        retryOnFailure: false,
      });
      await logGeminiImageAttempts(params.costContext, "image_generation_retry", retryGeneration.attempts);
      if (retryGeneration.bytes) {
        qa.regenerated = true;
        const retryQa = await inspectGeneratedImageForOffer({
          openAiKey: params.openAiKey,
          geminiApiKey: params.geminiApiKey,
          imageBytes: retryGeneration.bytes,
          requiredVisualItems,
          costContext: params.costContext,
          sourceType: "ai_generated",
        });
        qa.attempts = 2;
        if (!retryQa) {
          Object.assign(
            qa,
            imageQaTelemetryFromSourceAware(
              unavailableSourceAwareImageQaResult({ sourceType: "ai_generated" }),
              2,
              true,
            ),
          );
        } else if (retryQa.all_required_items_present || retryQa.missing_items.length < firstQa.missing_items.length) {
          Object.assign(
            qa,
            imageQaTelemetryFromSourceAware(
              normalizeSourceAwareImageQaResult({
                raw: retryQa,
                requiredVisualItems,
                sourceType: "ai_generated",
              }),
              2,
              true,
            ),
          );
          imageBytes = retryGeneration.bytes;
          imageMimeType = retryGeneration.mimeType;
          imagePrompt = retryGeneration.prompt;
          estimatedCostUsd += retryGeneration.estimatedCostUsd;
        }
      }
    } else {
      Object.assign(
        qa,
        imageQaTelemetryFromSourceAware(
          normalizeSourceAwareImageQaResult({
            raw: firstQa,
            requiredVisualItems,
            sourceType: "ai_generated",
          }),
          1,
          qa.regenerated,
        ),
      );
    }
  }
  if (qa.unavailable || qa.hardFailReasons.length > 0 || (qa.missingItems.length > 0 && !qa.unavailable)) {
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
      return withImageSelection(
        {
          posterStoragePath: generatedPath,
          source: "generated",
          treatment: null,
          prompt: imagePrompt,
          qa,
          provider: "gemini",
          model: gemini.model,
          estimatedCostUsd,
        },
        {
          sourcePhotoPath: null,
          editMode: "none",
        },
      );
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
    openAiKey: params.openAiKey,
    geminiApiKey: params.geminiApiKey,
    prompt,
    requiredVisualItems,
    imageProviderConfig: params.imageProviderConfig,
    costContext: params.costContext,
    sourcePhotoPath: params.photoPath,
    editMode: params.imageEditMode,
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

function providerAttemptTelemetry(attempt: ProviderAttempt) {
  return {
    provider: attempt.provider,
    model: attempt.model,
    operation: attempt.operation,
    success: attempt.success,
    latency_ms: attempt.latencyMs,
    error_class: attempt.errorClass ?? null,
    error_code: attempt.errorCode ?? null,
    input_tokens: attempt.inputTokens ?? null,
    cached_input_tokens: attempt.cachedInputTokens ?? null,
    reasoning_tokens: attempt.reasoningTokens ?? null,
    output_tokens: attempt.outputTokens ?? null,
    estimated_cost_usd: attempt.estimatedCostUsd ?? null,
  };
}

function localizationTelemetry(result: VerifiedAdLocalizationBundleResult | null) {
  if (!result) return { enabled: false };
  const repairEntries = Object.entries(result.repairs);
  const qaReviewTelemetry = (qa: VerifiedAdLocalizationBundleResult["semanticQa"]) => ({
    provider: qa.provider,
    model: qa.model,
    prompt_version: qa.promptVersion,
    fallback_used: qa.fallbackUsed,
    fallback_reason: qa.fallbackReason ?? null,
    skipped_reason: qa.skippedReason ?? null,
    attempts: qa.attempts.map(providerAttemptTelemetry),
    decisions_by_locale: Object.fromEntries(
      Object.entries(qa.reviews).map(([locale, review]) => [
        locale,
        review
          ? {
              decision: review.decision,
              hard_fail_reasons: review.hardFailReasons,
              scores: review.scores,
              feedback_count: review.conciseFeedback.length,
            }
          : null,
      ]),
    ),
  });
  return {
    enabled: true,
    source_locale: result.bundle.sourceLocale,
    source_creative_hash: result.bundle.sourceCreativeHash,
    localization_bundle_hash: result.bundle.localizationBundleHash,
    deterministic_fallback_locales: result.bundle.deterministicFallbackLocales,
    transcreation: {
      provider: result.transcreation.provider,
      model: result.transcreation.model,
      prompt_version: result.transcreation.promptVersion,
      fallback_used: result.transcreation.fallbackUsed,
      fallback_reason: result.transcreation.fallbackReason ?? null,
      skipped_reason: result.transcreation.skippedReason ?? null,
      attempts: result.transcreation.attempts.map(providerAttemptTelemetry),
    },
    deterministic_qa: Object.fromEntries(
      Object.entries(result.deterministicQa).map(([locale, qa]) => [
        locale,
        qa
          ? {
              decision: qa.decision,
              hard_fail_reasons: qa.hardFailReasons,
              scores: qa.scores,
              feedback_count: qa.conciseFeedback.length,
            }
          : null,
        ]),
    ),
    semantic_qa: qaReviewTelemetry(result.semanticQa),
    repaired_semantic_qa: qaReviewTelemetry(result.repairedSemanticQa),
    repairs: {
      target_locales: result.repairTargetLocales,
      count: repairEntries.length,
      by_locale: Object.fromEntries(
        repairEntries.map(([locale, repair]) => [
          locale,
          repair
            ? {
                provider: repair.provider,
                model: repair.model,
                prompt_version: repair.promptVersion,
                fallback_used: repair.fallbackUsed,
                fallback_reason: repair.fallbackReason ?? null,
                skipped_reason: repair.skippedReason ?? null,
                attempts: repair.attempts.map(providerAttemptTelemetry),
              }
            : null,
        ]),
      ),
    },
  };
}

function buildGenerationTelemetry(params: {
  offerContract: DealOfferContract;
  copy: Pick<SingleAd, "headline" | "short_description" | "copy_source" | "variant_count" | "selected_variant_index" | "validation_reason_codes"> & {
    fallback_reason?: string;
    generator_version?: string;
    copy_latency_ms?: number;
    provider_attempts?: ProviderAttempt[];
    provider?: string;
    model?: string;
    provider_fallback_used?: boolean;
    provider_fallback_reason?: string;
    copy_quality?: CopyQualityTelemetry[];
    judge_attempts?: ProviderAttempt[];
    judge_provider?: string;
    judge_model?: string;
    copy_alternatives?: AdCopyAlternative[];
  };
  imageResult: Awaited<ReturnType<typeof produceImage>>;
  productionSuccess: boolean;
  totalLatencyMs: number;
  localizationResult?: VerifiedAdLocalizationBundleResult | null;
  posterDraft?: PosterDraftV1 | null;
  requestedCreativeFormat?: "standard_card" | "poster_v1";
}) {
  const { offerContract, copy, imageResult, productionSuccess, totalLatencyMs } = params;
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
    total_latency_ms: totalLatencyMs,
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
      requested_aspect_ratio: params.posterDraft?.aspect_ratio ?? "1:1",
    },
    poster: params.posterDraft
      ? {
          requested_format: params.requestedCreativeFormat ?? "poster_v1",
          template_id: params.posterDraft.template_id,
          aspect_ratio: params.posterDraft.aspect_ratio,
          policy_passed: params.posterDraft.policy.passed,
          policy_reason_codes: params.posterDraft.policy.reasonCodes,
          rendered_asset_path: params.posterDraft.rendered_asset_path,
        }
      : { requested_format: params.requestedCreativeFormat ?? "standard_card" },
    image_selection: imageResult.selection,
    image_lineage: imageResult.selection.lineage,
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
      provider: copy.provider ?? null,
      model: copy.model ?? null,
      provider_fallback_used: copy.provider_fallback_used ?? false,
      provider_fallback_reason: copy.provider_fallback_reason ?? null,
      alternative_count: copy.copy_alternatives?.length ?? 0,
      quality: copy.copy_quality ?? [],
      judge: {
        provider: copy.judge_provider ?? null,
        model: copy.judge_model ?? null,
        attempts: (copy.judge_attempts ?? []).map(providerAttemptTelemetry),
      },
      provider_attempts: (copy.provider_attempts ?? []).map(providerAttemptTelemetry),
    },
    localization: localizationTelemetry(params.localizationResult ?? null),
    image_qa: imageResult.qa,
  };
}

// ─── HTTP handler ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const requestStartedAtMs = Date.now();
  const corsHeaders = getCorsHeaders(req);
  let adminForCreditRelease: SupabaseClient | null = null;
  let chargeableRevisionCredit: ChargeableImageRevisionReservation | null = null;

  async function releaseReservedChargeableRevision(reason: string) {
    if (!adminForCreditRelease || !chargeableRevisionCredit) return;
    const reservation = chargeableRevisionCredit;
    chargeableRevisionCredit = null;
    try {
      await releaseChargeableImageRevisionCredit(adminForCreditRelease as any, reservation, reason);
    } catch {
      console.log(
        JSON.stringify({
          tag: "ai_ads_v2",
          event: "deal_credit_release_failed",
          reason,
          errorCode: "DEAL_CREDIT_RELEASE_FAILED",
        }),
      );
    }
  }

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
    adminForCreditRelease = admin;

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
    const fallbackSourceMode: MerchantImageSourceMode = photoPath
      ? photoTreatment
        ? "merchant_ai_edit"
        : "merchant_original"
      : "ai_generated";
    const requestedImageSourceMode = normalizeMerchantImageSourceMode(body.image_source_mode, fallbackSourceMode);
    const imageSourceMode =
      !photoPath && (requestedImageSourceMode === "merchant_original" || requestedImageSourceMode === "merchant_ai_edit")
        ? "ai_generated"
        : requestedImageSourceMode;
    const imageEditMode = normalizeMerchantImageEditMode(
      body.image_edit_mode,
      imageEditModeFromPhotoTreatment(photoTreatment),
    );
    const customEditInstruction = validateMerchantImageEditInstruction(body.custom_image_edit_instruction);
    if (imageSourceMode === "merchant_ai_edit" && imageEditMode === "custom" && !customEditInstruction.instruction) {
      return new Response(
        JSON.stringify({
          error: "Describe the custom image edit you want, or choose a preset polish option.",
          error_code: "IMAGE_EDIT_INSTRUCTION_REQUIRED",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (imageSourceMode === "merchant_ai_edit" && imageEditMode === "custom" && !customEditInstruction.ok) {
      return new Response(
        JSON.stringify({
          error: "Custom image edit instructions cannot change offer facts, add text/logos/QR codes, or introduce unrelated elements.",
          error_code: "IMAGE_EDIT_INSTRUCTION_REJECTED",
          reason_codes: customEditInstruction.reasonCodes,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const merchantImageWarningOverrideAcknowledged =
      body.merchant_image_warning_override_acknowledged === true;
    const effectivePhotoPath =
      imageSourceMode === "merchant_original" || imageSourceMode === "merchant_ai_edit"
        ? photoPath
        : "";
    const effectivePhotoTreatment =
      imageSourceMode === "merchant_ai_edit"
        ? imageEditMode === "custom"
          ? "studiopolish"
          : photoTreatmentFromImageEditMode(imageEditMode) ?? photoTreatment
        : null;
    const customImageEditInstruction =
      imageSourceMode === "merchant_ai_edit" && imageEditMode === "custom"
        ? customEditInstruction.instruction
        : undefined;

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
    const creativeRequest = parseCreativeRequest(body.creative);
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

    // Ownership check — must run before any expensive work. Read the business
    // row with the admin client, then compare it against the authenticated user;
    // user-scoped selects cannot reliably read owner_id after column grants/RLS.
    const { data: business, error: bizErr } = await admin
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

    const suspendedLocation = await getSuspendedPrimaryBusinessLocation(admin as any, businessId);
    if (suspendedLocation) {
      return new Response(JSON.stringify(suspendedLocationResponseBody("generate or revise deals")), {
        status: 403,
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
        const creditDecision = await reserveChargeableImageRevisionCredit(admin as any, {
          businessId,
          isRevision,
          revisionTarget,
          revisionNumber: derivedRevisionCount + 1,
          requestGroupId,
        });
        if (!creditDecision.ok) {
          return new Response(
            JSON.stringify({
              error: creditDecision.errorMessage,
              error_code: creditDecision.errorCode,
            }),
            { status: creditDecision.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        chargeableRevisionCredit = creditDecision.reservation;
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
        geminiApiKey,
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
      provider_attempts?: ProviderAttempt[];
      provider?: string;
      model?: string;
      provider_fallback_used?: boolean;
      provider_fallback_reason?: string;
      copy_quality?: CopyQualityTelemetry[];
      judge_attempts?: ProviderAttempt[];
      judge_provider?: string;
      judge_model?: string;
      copy_alternatives?: AdCopyAlternative[];
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
        copy_alternatives: previousAd.copy_alternatives,
        validation_reason_codes: previousAd.validation_reason_codes,
        cta: previousAd.cta,
      };
    } else {
      try {
        copy = await generateCopy({
          openAiKey,
          geminiApiKey,
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
          creativeFormat: creativeRequest.requestedFormat,
          costContext,
        });
      } catch {
        console.log(
          JSON.stringify({ tag: "ai_ads_v2", event: "copy_error", errorCode: "COPY_FAILED" }),
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
          failure_reason: "COPY_FAILED",
          openai_called: true,
          response_payload: {
            events: ["quick_deal_ai_generation_failed"],
            stage: "copy",
            total_latency_ms: Date.now() - requestStartedAtMs,
            structured_offer: offerTelemetry(offerContract),
          },
        });
        await releaseReservedChargeableRevision("copy_failed");
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
      imageResult = withImageSelection(
        {
          posterStoragePath: previousAd.poster_storage_path ?? null,
          source: previousAd.photo_source === "copy_only" ? "generated" : previousAd.photo_source,
          treatment: previousAd.photo_treatment,
          prompt: null,
          qa: previousAd.photo_source === "uploaded_original"
            ? originalPhotoQaTelemetry(previousAd.image_selection?.qa.merchantOverrideAcknowledged === true)
            : skippedImageQaTelemetry(imageSourceModeFromPhotoSource(previousAd.photo_source)),
          provider: previousAd.photo_source === "stock" ? "stock" : "none",
          model: null,
          estimatedCostUsd: 0,
        },
        {
          sourcePhotoPath: previousAd.image_selection?.sourcePhotoPath ?? (effectivePhotoPath || null),
          editMode: previousAd.image_selection?.editMode ?? imageEditModeFromPhotoTreatment(previousAd.photo_treatment),
        },
      );
    } else {
      imageResult = await produceImage({
        openAiKey,
        geminiApiKey,
        admin,
        userClient,
        businessId,
        photoPath: effectivePhotoPath || null,
        photoTreatment: effectivePhotoTreatment,
        imageSourceMode,
        imageEditMode,
        customImageEditInstruction,
        merchantOverrideAcknowledged: merchantImageWarningOverrideAcknowledged,
        research,
        itemHint: sourceHint,
        businessName,
        businessCategory: businessContext.category,
        offerContract,
        revisionPreset: revisionPreset || undefined,
        revisionFeedback: revisionFeedback || undefined,
        imageProviderConfig,
        costContext,
        imageAspectRatio: creativeRequest.imageAspectRatio,
      });
    }

    const sourceLocale = outputLanguageToSupportedLocale(outputLanguage);
    const offerDefinition = buildOfferDefinitionV1FromContract(offerContract, {
      dealEligibility: eligibilityInput!,
      redemptionLimit,
      schedule: {
        mode: "summary_only",
        summary: offerScheduleSummary,
      },
      sourceAssetIds: imageResult.posterStoragePath ? [imageResult.posterStoragePath] : [],
    });
    const posterDraft = creativeRequest.posterEnabled
      ? buildPosterSpecFromOfferDefinition({
          definition: offerDefinition,
          enabled: true,
          templateId: choosePosterTemplateForOffer(
            creativeRequest.posterStyle,
            offerDefinition,
            businessContext.category,
          ),
          sourceAssetPath: imageResult.posterStoragePath,
          renderedAssetPath: null,
          headline: copy.headline,
          subline: copy.short_description || copy.subheadline,
          businessCategory: businessContext.category,
          compositionPlan: imageResult.prompt,
        })
      : null;
    let localizationResult: VerifiedAdLocalizationBundleResult | null = null;
    if (shouldBuildLocalizationBundle()) {
      const merchantProfile = buildMerchantCreativeProfile({
        businessId,
        businessName,
        category: businessContext.category,
        tone: businessContext.tone,
        location: businessContext.location,
        address: businessContext.address,
        description: businessContext.description,
        itemHint: sourceHint,
        research,
      });
      localizationResult = await generateVerifiedAdLocalizationBundle({
        request: {
          adVersionId: `draft:${requestGroupId}`,
          sourceLocale,
          targetLocales: [...SUPPORTED_LOCALES],
          sourceCreative: {
            strategy: copy.copy_source ?? null,
            headline: copy.headline,
            supportingCopy: copy.short_description || copy.subheadline,
            imageAltText: localizationImageAltText({
              businessName,
              headline: copy.headline,
              offerLine: offerDefinition.canonicalOfferLine,
            }),
          },
          creativeBrief: {
            targetCustomerMoment: "",
            exactCustomerHook: offerDefinition.canonicalOfferLine,
            desiredFeeling: "",
            naturalLanguageDirection: "",
          },
          offerFacts: adLocalizationOfferFactsFromDefinition(offerDefinition),
          protectedTerms: protectedTermsForLocalization(offerDefinition),
          localizedTerms: [],
          merchantProfile,
          generationRunId: requestGroupId,
        },
        offerDefinition,
        deps: {
          openAiApiKey: openAiKey,
          geminiApiKey,
          admin,
          config: resolveAiTextProviderConfig(),
        },
        providerEnabled: envFlag("AI_V5_PERSUASIVE_TRANSCRATION_ENABLED", false),
        repairEnabled: envFlag("AI_V5_TRANSLATION_QA_ENABLED", false),
        semanticQaEnabled: envFlag("AI_V5_TRANSLATION_QA_ENABLED", false),
      });
      await logTextProviderAttempts(costContext, "ad_localization_transcreation", localizationResult.transcreation.attempts);
      await logTextProviderAttempts(costContext, "ad_localization_translation_qa", localizationResult.semanticQa.attempts);
      await logTextProviderAttempts(costContext, "ad_localization_repaired_translation_qa", localizationResult.repairedSemanticQa.attempts);
      for (const repair of Object.values(localizationResult.repairs)) {
        if (repair) await logTextProviderAttempts(costContext, "ad_localization_repair", repair.attempts);
      }
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
      copy_alternatives: copy.copy_alternatives,
      validation_reason_codes: copy.validation_reason_codes,
      cta: copy.cta,
      item_research: research,
      photo_source: imageResult.source,
      photo_treatment: imageResult.treatment,
      poster_storage_path: imageResult.posterStoragePath,
      image_selection: imageResult.selection,
      poster: posterDraft,
      localization_bundle: localizationResult?.bundle ?? null,
      localization_status: localizationResult
        ? {
            source_locale: localizationResult.bundle.sourceLocale,
            localization_bundle_hash: localizationResult.bundle.localizationBundleHash,
            deterministic_fallback_locales: localizationResult.bundle.deterministicFallbackLocales,
            transcreation_provider: localizationResult.transcreation.provider,
            transcreation_model: localizationResult.transcreation.model,
            transcreation_skipped_reason: localizationResult.transcreation.skippedReason ?? null,
            semantic_qa_provider: localizationResult.semanticQa.provider,
            semantic_qa_model: localizationResult.semanticQa.model,
            semantic_qa_skipped_reason: localizationResult.semanticQa.skippedReason ?? null,
            repair_target_locales: localizationResult.repairTargetLocales,
          }
        : null,
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
      model: copy.model ?? CHAT_MODEL,
      success: productionSuccess,
      failure_reason: productionSuccess ? null : "IMAGE_NULL",
      openai_called:
        (copy.provider_attempts ?? []).some((attempt) => attempt.provider === "openai") ||
        (localizationResult?.transcreation.attempts ?? []).some((attempt) => attempt.provider === "openai") ||
        (localizationResult?.semanticQa.attempts ?? []).some((attempt) => attempt.provider === "openai") ||
        (localizationResult?.repairedSemanticQa.attempts ?? []).some((attempt) => attempt.provider === "openai") ||
        Object.values(localizationResult?.repairs ?? {}).some((repair) =>
          (repair?.attempts ?? []).some((attempt) => attempt.provider === "openai")
        ) ||
        imageResult.provider === "openai" ||
        !isRevision,
      response_payload: buildGenerationTelemetry({
        offerContract,
        copy,
        imageResult,
        productionSuccess,
        totalLatencyMs: Date.now() - requestStartedAtMs,
        localizationResult,
        posterDraft,
        requestedCreativeFormat: creativeRequest.requestedFormat,
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
      await releaseReservedChargeableRevision("image_failed");
      return new Response(
        JSON.stringify({
          error: "AI image generation failed. Try again.",
          error_code: "IMAGE_REQUIRED",
          quota,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (chargeableRevisionCredit) {
      const reservation = chargeableRevisionCredit;
      await commitChargeableImageRevisionCredit(admin as any, reservation);
      chargeableRevisionCredit = null;
    }

    return new Response(JSON.stringify({ ad, ads: [ad], quota }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    await releaseReservedChargeableRevision("server_error");
    console.log(JSON.stringify({ tag: "ai_ads_v2", event: "fatal", errorCode: "SERVER_ERROR" }));
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function coerceCopyAlternatives(raw: unknown): AdCopyAlternative[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AdCopyAlternative[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const option = value as Record<string, unknown>;
    const headline = clip(typeof option.headline === "string" ? option.headline : "", DEAL_COPY_LIMITS.headline);
    const shortDescription = clip(
      typeof option.short_description === "string" ? option.short_description : "",
      DEAL_COPY_LIMITS.description,
    );
    if (!headline || !shortDescription) continue;
    out.push({
      ...(typeof option.candidate_id === "string" ? { candidate_id: clip(option.candidate_id, 64) } : {}),
      ...(typeof option.strategy_id === "string" ? { strategy_id: clip(option.strategy_id, 64) } : {}),
      ...(typeof option.strategy_reason === "string" ? { strategy_reason: clip(option.strategy_reason, 180) } : {}),
      variant_index: typeof option.variant_index === "number" && Number.isFinite(option.variant_index)
        ? Math.max(0, Math.floor(option.variant_index))
        : out.length,
      headline,
      short_description: shortDescription,
      push_notification: clip(
        typeof option.push_notification === "string" ? option.push_notification : headline,
        DEAL_COPY_LIMITS.pushBody,
      ),
      ...(typeof option.social_caption === "string"
        ? { social_caption: clip(option.social_caption, DEAL_COPY_LIMITS.socialCaption) }
        : {}),
      ...(typeof option.cta === "string" ? { cta: clip(option.cta, 26) } : {}),
      ...(typeof option.selected === "boolean" ? { selected: option.selected } : {}),
    });
    if (out.length >= 5) break;
  }
  return out.length > 1 ? out : undefined;
}

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
  const posterStoragePath =
    typeof raw.poster_storage_path === "string" && raw.poster_storage_path.length > 0
      ? raw.poster_storage_path
      : null;
  const rawImageSelection =
    raw.image_selection && typeof raw.image_selection === "object" && !Array.isArray(raw.image_selection)
      ? (raw.image_selection as AdImageSelection)
      : null;
  const imageSelection = rawImageSelection ?? producedImageSelection({
    image: {
      posterStoragePath,
      source: photoSource,
      treatment: photoTreatment,
      prompt: null,
      qa: photoSource === "uploaded_original"
        ? originalPhotoQaTelemetry(false)
        : skippedImageQaTelemetry(imageSourceModeFromPhotoSource(photoSource)),
      provider: photoSource === "stock" ? "stock" : "none",
      model: null,
      estimatedCostUsd: 0,
    },
    sourcePhotoPath: photoSource === "uploaded_original" || photoSource === "uploaded_enhanced"
      ? posterStoragePath
      : null,
    editMode: imageEditModeFromPhotoTreatment(photoTreatment),
  });

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
    copy_alternatives: coerceCopyAlternatives(raw.copy_alternatives),
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
    poster_storage_path: posterStoragePath,
    image_selection: imageSelection,
    poster: recordValue(raw.poster) as PosterDraftV1 | null,
  };
}
