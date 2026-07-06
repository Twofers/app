import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import {
  getSuspendedLocationFromDealRows,
  suspendedLocationResponseBody,
} from "../_shared/billing-suspension.ts";
import {
  businessVerificationRequiredResponseBody,
  getUnverifiedLocationFromDealRows,
} from "../_shared/business-verification.ts";
import { validateExactLocalizationApprovalPayload } from "../_shared/localization-approval-validation.ts";
import { validatePosterSpecV1 } from "../../../lib/poster/posterAdSpec.ts";
import type { OfferDefinitionV1 } from "../../../lib/offer-definition.ts";

type PublishOfferVersionBody = {
  business_id?: unknown;
  offer_definition?: unknown;
  deal_rows?: unknown;
  idempotency_key?: unknown;
  ad_spec?: unknown;
};

type OfferDefinitionPayload = {
  schemaVersion?: unknown;
  status?: unknown;
  merchantId?: unknown;
  locationId?: unknown;
  offerType?: unknown;
  canonicalOfferSentence?: unknown;
  canonicalTermsLine?: unknown;
  disclosureLine?: unknown;
  qualifyingItems?: unknown;
  reward?: unknown;
};

type AdSpecPayload = {
  adSpecVersion?: unknown;
  creative_format?: unknown;
  poster?: unknown;
  rendererVersion?: unknown;
  templateVersion?: unknown;
  channels?: unknown;
  offer?: unknown;
  composedCard?: unknown;
  localization?: unknown;
};

type ComposedCardPayload = {
  presentation?: unknown;
  presentationHash?: unknown;
  selectedTemplateId?: unknown;
  alternateTemplateIds?: unknown;
  merchantStyleOverrideUsed?: unknown;
  compositeQa?: unknown;
  screenshotQa?: unknown;
};

type ComposedPresentationPayload = {
  specVersion?: unknown;
  templateId?: unknown;
  themeId?: unknown;
  imageAssetId?: unknown;
  imageSourceType?: unknown;
  textPanel?: unknown;
  textZone?: unknown;
  rendererVersion?: unknown;
};

type CompositeQaPayload = {
  decision?: unknown;
  hardFailReasons?: unknown;
};

type ScreenshotQaPayload = {
  required?: unknown;
  decision?: unknown;
};

type LocalizationPayload = {
  schemaVersion?: unknown;
  sourceLocale?: unknown;
  enabledLocales?: unknown;
  sourceCreativeHash?: unknown;
  localizationBundleHash?: unknown;
  deterministicFallbackLocales?: unknown;
  localeRendererVersion?: unknown;
  localizedTermSnapshot?: unknown;
  translationQaSummary?: unknown;
  localePresentationOverrides?: unknown;
  approval?: unknown;
  localizations?: unknown;
};

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  const corsHeaders = getCorsHeaders(req);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function cleanIdempotencyKey(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function coerceDealRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => {
    return !!row && typeof row === "object" && !Array.isArray(row);
  });
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => cleanText(item).length > 0);
}

function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item)).filter(Boolean)
    : [];
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function recordKeys(value: unknown): string[] {
  return Object.keys(recordValue(value) ?? {});
}

function translationQaRollup(value: unknown): Record<string, string> {
  const summary = recordValue(value);
  if (!summary) return {};
  const out: Record<string, string> = {};
  for (const [locale, rawQa] of Object.entries(summary)) {
    const qa = recordValue(rawQa);
    if (!qa) continue;
    const status = cleanText(qa.translationStatus);
    const decision = cleanText(qa.qaDecision);
    out[locale] = [status, decision].filter(Boolean).join(":") || "unknown";
  }
  return out;
}

function isExactPresentationApprovalRequired(): boolean {
  return Deno.env.get("AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED") === "true";
}

function isCompositeScreenshotQaRequired(): boolean {
  return Deno.env.get("AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED") === "true";
}

function isExactLocalizationApprovalRequired(): boolean {
  return Deno.env.get("AI_V5_EXACT_LOCALIZATION_APPROVAL_ENABLED") === "true";
}

function validateOfferDefinitionPayload(value: unknown): { valid: boolean; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reasonCodes: ["NOT_OBJECT"] };
  }
  const definition = value as OfferDefinitionPayload;
  if (definition.schemaVersion !== 1) reasonCodes.push("INVALID_SCHEMA_VERSION");
  if (definition.status !== "draft") reasonCodes.push("INVALID_STATUS");
  if (!cleanText(definition.merchantId)) reasonCodes.push("MISSING_MERCHANT_ID");
  if (!cleanText(definition.locationId)) reasonCodes.push("MISSING_LOCATION_ID");
  if (!cleanText(definition.offerType)) reasonCodes.push("MISSING_OFFER_TYPE");
  if (!cleanText(definition.canonicalOfferSentence)) reasonCodes.push("MISSING_CANONICAL_SENTENCE");
  if (!cleanText(definition.canonicalTermsLine)) reasonCodes.push("MISSING_TERMS");
  if (!cleanText(definition.disclosureLine)) reasonCodes.push("MISSING_DISCLOSURE");
  if (!Array.isArray(definition.qualifyingItems) || definition.qualifyingItems.length < 1) {
    reasonCodes.push("MISSING_QUALIFYING_ITEM");
  }
  if (!definition.reward || typeof definition.reward !== "object" || Array.isArray(definition.reward)) {
    reasonCodes.push("MISSING_REWARD");
  }
  return { valid: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}

function validateAdSpecPayload(value: unknown, offerDefinition: unknown): { valid: boolean; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  if (value == null) {
    if (isExactPresentationApprovalRequired()) {
      reasonCodes.push("MISSING_COMPOSED_CARD_APPROVAL");
    }
    if (isExactLocalizationApprovalRequired()) {
      reasonCodes.push("MISSING_LOCALIZATION_APPROVAL");
    }
    return { valid: reasonCodes.length === 0, reasonCodes };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reasonCodes: ["NOT_OBJECT"] };
  }
  const spec = value as AdSpecPayload;
  if (spec.adSpecVersion !== 1) reasonCodes.push("INVALID_AD_SPEC_VERSION");
  const creativeFormat = cleanText(spec.creative_format) || "standard_card";
  if (creativeFormat !== "standard_card" && creativeFormat !== "poster_v1") {
    reasonCodes.push("INVALID_CREATIVE_FORMAT");
  }
  if (creativeFormat === "poster_v1" || spec.poster != null) {
    const businessId = cleanText((offerDefinition as OfferDefinitionPayload | null)?.merchantId);
    const posterValidation = validatePosterSpecV1(spec.poster, {
      offerDefinition: offerDefinition as OfferDefinitionV1,
      businessId,
    });
    if (!posterValidation.valid) {
      reasonCodes.push(...posterValidation.reasonCodes);
    }
  }
  if (!cleanText(spec.rendererVersion)) reasonCodes.push("MISSING_RENDERER_VERSION");
  if (!cleanText(spec.templateVersion)) reasonCodes.push("MISSING_TEMPLATE_VERSION");
  if (!spec.offer || typeof spec.offer !== "object" || Array.isArray(spec.offer)) {
    reasonCodes.push("MISSING_OFFER");
  }
  if (!spec.channels || typeof spec.channels !== "object" || Array.isArray(spec.channels)) {
    reasonCodes.push("MISSING_CHANNELS");
  }
  if (spec.composedCard != null) {
    reasonCodes.push(...validateComposedCardPayload(spec.composedCard));
  } else if (isExactPresentationApprovalRequired()) {
    reasonCodes.push("MISSING_COMPOSED_CARD_APPROVAL");
  }
  if (spec.localization != null) {
    reasonCodes.push(...validateLocalizationPayload(spec.localization));
  } else if (isExactLocalizationApprovalRequired()) {
    reasonCodes.push("MISSING_LOCALIZATION_APPROVAL");
  }
  if (isExactLocalizationApprovalRequired()) {
    reasonCodes.push(...validateExactLocalizationApprovalPayload({
      localization: spec.localization,
      composedCard: spec.composedCard,
      offerDefinition,
      exactRequired: true,
    }));
  }
  return { valid: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}

function validateLocalizationPayload(value: unknown): string[] {
  const reasonCodes: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["LOCALIZATION_NOT_OBJECT"];
  }
  const localization = value as LocalizationPayload;
  if (localization.schemaVersion !== 1) reasonCodes.push("INVALID_LOCALIZATION_SCHEMA_VERSION");
  const sourceLocale = cleanText(localization.sourceLocale);
  if (!["en-US", "es-US", "ko-KR"].includes(sourceLocale)) reasonCodes.push("INVALID_LOCALIZATION_SOURCE_LOCALE");
  if (!isStringArray(localization.enabledLocales)) {
    reasonCodes.push("INVALID_LOCALIZATION_ENABLED_LOCALES");
  }
  if (!/^adsrc_[0-9a-f]{8}$/i.test(cleanText(localization.sourceCreativeHash))) {
    reasonCodes.push("INVALID_SOURCE_CREATIVE_HASH");
  }
  if (!/^adloc_[0-9a-f]{8}$/i.test(cleanText(localization.localizationBundleHash))) {
    reasonCodes.push("INVALID_LOCALIZATION_BUNDLE_HASH");
  }
  if (!isStringArray(localization.deterministicFallbackLocales)) {
    reasonCodes.push("INVALID_DETERMINISTIC_FALLBACK_LOCALES");
  }
  if (!cleanText(localization.localeRendererVersion)) reasonCodes.push("MISSING_LOCALE_RENDERER_VERSION");
  if (!localization.localizedTermSnapshot || typeof localization.localizedTermSnapshot !== "object" || Array.isArray(localization.localizedTermSnapshot)) {
    reasonCodes.push("INVALID_LOCALIZED_TERM_SNAPSHOT");
  }
  if (!localization.translationQaSummary || typeof localization.translationQaSummary !== "object" || Array.isArray(localization.translationQaSummary)) {
    reasonCodes.push("INVALID_TRANSLATION_QA_SUMMARY");
  }
  if (!localization.localizations || typeof localization.localizations !== "object" || Array.isArray(localization.localizations)) {
    reasonCodes.push("INVALID_AD_LOCALIZATIONS");
    return reasonCodes;
  }
  const localizations = localization.localizations as Record<string, unknown>;
  const enabledLocales = isStringArray(localization.enabledLocales) ? localization.enabledLocales : [];
  for (const locale of enabledLocales) {
    if (!localizations[locale]) reasonCodes.push("MISSING_AD_LOCALIZATION");
  }
  for (const [locale, row] of Object.entries(localizations)) {
    if (!["en-US", "es-US", "ko-KR"].includes(locale)) reasonCodes.push("UNSUPPORTED_AD_LOCALIZATION_LOCALE");
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      reasonCodes.push("INVALID_AD_LOCALIZATION_ROW");
      continue;
    }
    const record = row as Record<string, unknown>;
    if ("exactOfferLine" in record || "termsLine" in record) {
      reasonCodes.push("AD_LOCALIZATION_EXACT_OFFER_FIELDS_NOT_ALLOWED");
    }
    if (!cleanText(record.headline)) reasonCodes.push("MISSING_AD_LOCALIZATION_HEADLINE");
    if (!cleanText(record.imageAltText)) reasonCodes.push("MISSING_AD_LOCALIZATION_ALT_TEXT");
    if (!/^adlocrow_[0-9a-f]{8}$/i.test(cleanText(record.localizationHash))) {
      reasonCodes.push("INVALID_AD_LOCALIZATION_HASH");
    }
    if (!Array.isArray(record.qaReasonCodes)) reasonCodes.push("INVALID_AD_LOCALIZATION_QA_REASONS");
  }
  return reasonCodes;
}

function validateComposedCardPayload(value: unknown): string[] {
  const reasonCodes: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["COMPOSED_CARD_NOT_OBJECT"];
  }
  const composed = value as ComposedCardPayload;
  const presentation = composed.presentation as ComposedPresentationPayload | null;
  if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) {
    reasonCodes.push("MISSING_PRESENTATION_SPEC");
  } else {
    if (!cleanText(presentation.specVersion)) reasonCodes.push("MISSING_PRESENTATION_SPEC_VERSION");
    if (!cleanText(presentation.rendererVersion)) reasonCodes.push("MISSING_PRESENTATION_RENDERER_VERSION");
    if (!cleanText(presentation.templateId)) reasonCodes.push("MISSING_SELECTED_TEMPLATE");
    if (!cleanText(presentation.themeId)) reasonCodes.push("MISSING_PRESENTATION_THEME");
    if (!cleanText(presentation.imageAssetId)) reasonCodes.push("MISSING_PRESENTATION_IMAGE_ASSET");
    if (!cleanText(presentation.imageSourceType)) reasonCodes.push("MISSING_PRESENTATION_IMAGE_SOURCE");
    if (!cleanText(presentation.textPanel)) reasonCodes.push("MISSING_PRESENTATION_TEXT_PANEL");
    if (!cleanText(presentation.textZone)) reasonCodes.push("MISSING_PRESENTATION_TEXT_ZONE");
    if (cleanText(composed.selectedTemplateId) && cleanText(composed.selectedTemplateId) !== cleanText(presentation.templateId)) {
      reasonCodes.push("SELECTED_TEMPLATE_MISMATCH");
    }
  }
  const presentationHash = cleanText(composed.presentationHash);
  if (!/^adp_[0-9a-f]{16}$/i.test(presentationHash)) {
    reasonCodes.push("INVALID_PRESENTATION_HASH");
  }
  if (!Array.isArray(composed.alternateTemplateIds)) {
    reasonCodes.push("INVALID_ALTERNATE_TEMPLATES");
  }
  if (typeof composed.merchantStyleOverrideUsed !== "boolean") {
    reasonCodes.push("INVALID_STYLE_OVERRIDE_FLAG");
  }
  const compositeQa = composed.compositeQa as CompositeQaPayload | null;
  if (!compositeQa || typeof compositeQa !== "object" || Array.isArray(compositeQa)) {
    reasonCodes.push("MISSING_COMPOSITE_QA");
  } else {
    const decision = cleanText(compositeQa.decision);
    if (!["pass", "repair", "block", "unavailable"].includes(decision)) {
      reasonCodes.push("INVALID_COMPOSITE_QA_DECISION");
    }
    if (decision === "block" || decision === "unavailable") {
      reasonCodes.push("BLOCKED_COMPOSITE_QA");
    }
    if (!Array.isArray(compositeQa.hardFailReasons)) {
      reasonCodes.push("INVALID_COMPOSITE_QA_REASONS");
    }
  }
  const screenshotQa = composed.screenshotQa as ScreenshotQaPayload | null;
  if (!screenshotQa || typeof screenshotQa !== "object" || Array.isArray(screenshotQa)) {
    reasonCodes.push("MISSING_SCREENSHOT_QA");
  } else if (isCompositeScreenshotQaRequired() && screenshotQa.required === true && screenshotQa.decision !== "pass") {
    reasonCodes.push("SCREENSHOT_QA_REQUIRED");
  }
  return reasonCodes;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse(req, { error: "Unauthorized. Please log in." }, 401);
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    let body: PublishOfferVersionBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(req, { error: "Invalid JSON in request body" }, 400);
    }

    const businessId = typeof body.business_id === "string" ? body.business_id.trim() : "";
    if (!businessId || !isUuid(businessId)) {
      return jsonResponse(req, { error: "Missing or invalid business_id" }, 400);
    }

    const idempotencyKey = cleanIdempotencyKey(body.idempotency_key);
    if (idempotencyKey.length < 12) {
      return jsonResponse(req, { error: "Missing idempotency_key" }, 400);
    }

    const dealRows = coerceDealRows(body.deal_rows);
    if (dealRows.length < 1) {
      return jsonResponse(req, { error: "deal_rows must be a non-empty array" }, 400);
    }
    if (dealRows.some((row) => row.business_id !== businessId)) {
      return jsonResponse(req, { error: "Deal row business_id mismatch" }, 403);
    }

    const offerDefinition = body.offer_definition as OfferDefinitionPayload;
    const validation = validateOfferDefinitionPayload(offerDefinition);
    if (!validation.valid) {
      return jsonResponse(
        req,
        {
          error: "Invalid offer definition",
          error_code: "INVALID_OFFER_DEFINITION",
          reason_codes: validation.reasonCodes,
        },
        400,
      );
    }
    if (offerDefinition.merchantId !== businessId) {
      return jsonResponse(req, { error: "Offer definition business mismatch" }, 403);
    }

    const { data: business, error: businessError } = await admin
      .from("businesses")
      .select("id, owner_id")
      .eq("id", businessId)
      .maybeSingle();
    if (businessError || !business || business.owner_id !== user.id) {
      return jsonResponse(req, { error: "Business not found for owner" }, 403);
    }

    // Independent of billing/verification: publishing requires the owner to have
    // explicitly accepted the business terms at least once (any document_version),
    // same rule can_business_publish() applies. Accepting terms never bypasses the
    // billing or verification checks below, and vice versa.
    const { data: termsAcceptance, error: termsError } = await admin
      .from("terms_acceptances")
      .select("id")
      .eq("business_id", businessId)
      .eq("document_type", "business_terms")
      .limit(1)
      .maybeSingle();
    if (termsError) throw termsError;
    if (!termsAcceptance) {
      return jsonResponse(
        req,
        {
          error: "Business terms must be accepted before publishing offers.",
          error_code: "TERMS_REQUIRED",
        },
        403,
      );
    }

    const suspendedLocation = await getSuspendedLocationFromDealRows(admin as any, businessId, dealRows);
    if (suspendedLocation) {
      return jsonResponse(req, suspendedLocationResponseBody("publish or schedule deals"), 403);
    }

    const unverifiedLocation = await getUnverifiedLocationFromDealRows(admin as any, businessId, dealRows);
    if (unverifiedLocation) {
      return jsonResponse(req, businessVerificationRequiredResponseBody("publish or schedule deals"), 403);
    }

    const adSpec =
      body.ad_spec && typeof body.ad_spec === "object" && !Array.isArray(body.ad_spec)
        ? body.ad_spec
        : null;
    const adSpecValidation = validateAdSpecPayload(adSpec, offerDefinition);
    if (!adSpecValidation.valid) {
      return jsonResponse(
        req,
        {
          error: "Invalid ad spec",
          error_code: "INVALID_AD_SPEC",
          reason_codes: adSpecValidation.reasonCodes,
        },
        400,
      );
    }

    const { data, error } = await admin.rpc("publish_offer_versioned_deal", {
      p_business_id: businessId,
      p_owner_user_id: user.id,
      p_offer_definition: offerDefinition,
      p_deal_rows: dealRows,
      p_idempotency_key: idempotencyKey,
      p_ad_spec: adSpec,
    });

    if (error) {
      const message = String(error.message ?? "");
      const missingRpc =
        error.code === "42883" ||
        message.includes("publish_offer_versioned_deal") ||
        message.toLowerCase().includes("could not find the function");
      if (missingRpc) {
        return jsonResponse(
          req,
          {
            error: "Versioned publish is not available until the OfferVersion migration is applied.",
            error_code: "PUBLISH_OFFER_VERSION_UNAVAILABLE",
          },
          503,
        );
      }
      console.error("[publish-offer-version] rpc failed", error);
      return jsonResponse(
        req,
        {
          error: "Could not publish this offer.",
          error_code: "PUBLISH_OFFER_VERSION_FAILED",
        },
        500,
      );
    }

    const publishedDeals = Array.isArray(data) ? data : [];
    const firstDeal = publishedDeals[0] as { deal_id?: unknown } | undefined;
    const adSpecForContext = adSpec as {
      adSpecVersion?: unknown;
      rendererVersion?: unknown;
      templateVersion?: unknown;
      source?: unknown;
      composedCard?: {
        presentationHash?: unknown;
        selectedTemplateId?: unknown;
        alternateTemplateIds?: unknown;
        merchantStyleOverrideUsed?: unknown;
        compositeQa?: { decision?: unknown; repairCodes?: unknown; hardFailReasons?: unknown };
        screenshotQa?: { required?: unknown; decision?: unknown; triggerCodes?: unknown };
      };
      localization?: {
        sourceLocale?: unknown;
        enabledLocales?: unknown;
        sourceCreativeHash?: unknown;
        localizationBundleHash?: unknown;
        deterministicFallbackLocales?: unknown;
        localeRendererVersion?: unknown;
        localePresentationOverrides?: unknown;
        translationQaSummary?: unknown;
        semanticQaSummary?: {
          provider?: unknown;
          model?: unknown;
          skippedReason?: unknown;
          repairTargetLocales?: unknown;
        };
        approval?: {
          approvalHash?: unknown;
          policyVersion?: unknown;
          reviewPolicyVersion?: unknown;
          localizedTermSnapshotHash?: unknown;
          localePresentationOverridesHash?: unknown;
          localizationRowHashes?: unknown;
        };
        localizations?: unknown;
      };
    } | null;
    const composedForContext = adSpecForContext?.composedCard;
    const localizationForContext = adSpecForContext?.localization;
    const enabledLocalizationLocales = cleanStringArray(localizationForContext?.enabledLocales);
    const deterministicFallbackLocales = cleanStringArray(localizationForContext?.deterministicFallbackLocales);
    const repairTargetLocales = cleanStringArray(localizationForContext?.semanticQaSummary?.repairTargetLocales);
    const localePresentationOverrideLocales = recordKeys(localizationForContext?.localePresentationOverrides);
    const localizationRowLocales = recordKeys(localizationForContext?.localizations);
    try {
      await admin.from("app_analytics_events").insert({
        event_name: "ai_ad_versioned_publish",
        user_id: user.id,
        business_id: businessId,
        deal_id: typeof firstDeal?.deal_id === "string" ? firstDeal.deal_id : null,
        context: {
          deal_count: publishedDeals.length,
          ad_spec_version:
            typeof adSpecForContext?.adSpecVersion === "number" ? adSpecForContext.adSpecVersion : null,
          renderer_version:
            typeof adSpecForContext?.rendererVersion === "string" ? adSpecForContext.rendererVersion : null,
          template_version:
            typeof adSpecForContext?.templateVersion === "string" ? adSpecForContext.templateVersion : null,
          source: typeof adSpecForContext?.source === "string" ? adSpecForContext.source : null,
          composed_presentation_hash:
            typeof composedForContext?.presentationHash === "string" ? composedForContext.presentationHash : null,
          selected_template_id:
            typeof composedForContext?.selectedTemplateId === "string" ? composedForContext.selectedTemplateId : null,
          alternate_template_count: Array.isArray(composedForContext?.alternateTemplateIds)
            ? composedForContext.alternateTemplateIds.length
            : 0,
          merchant_style_override_used:
            typeof composedForContext?.merchantStyleOverrideUsed === "boolean"
              ? composedForContext.merchantStyleOverrideUsed
              : false,
          composite_qa_decision:
            typeof composedForContext?.compositeQa?.decision === "string" ? composedForContext.compositeQa.decision : null,
          composite_qa_repair_count: Array.isArray(composedForContext?.compositeQa?.repairCodes)
            ? composedForContext.compositeQa.repairCodes.length
            : 0,
          screenshot_qa_required:
            typeof composedForContext?.screenshotQa?.required === "boolean" ? composedForContext.screenshotQa.required : false,
          screenshot_qa_decision:
            typeof composedForContext?.screenshotQa?.decision === "string" ? composedForContext.screenshotQa.decision : null,
          localization_present: Boolean(localizationForContext),
          localization_source_locale:
            typeof localizationForContext?.sourceLocale === "string" ? localizationForContext.sourceLocale : null,
          localization_enabled_locales: enabledLocalizationLocales.join(","),
          localization_enabled_locale_count: enabledLocalizationLocales.length,
          localization_source_creative_hash:
            typeof localizationForContext?.sourceCreativeHash === "string" ? localizationForContext.sourceCreativeHash : null,
          localization_bundle_hash:
            typeof localizationForContext?.localizationBundleHash === "string" ? localizationForContext.localizationBundleHash : null,
          localization_locale_renderer_version:
            typeof localizationForContext?.localeRendererVersion === "string" ? localizationForContext.localeRendererVersion : null,
          deterministic_localization_fallback_locales: deterministicFallbackLocales.join(","),
          deterministic_localization_fallback_count: deterministicFallbackLocales.length,
          translation_qa_decision_by_locale: translationQaRollup(localizationForContext?.translationQaSummary),
          semantic_qa_provider:
            typeof localizationForContext?.semanticQaSummary?.provider === "string"
              ? localizationForContext.semanticQaSummary.provider
              : null,
          semantic_qa_model:
            typeof localizationForContext?.semanticQaSummary?.model === "string"
              ? localizationForContext.semanticQaSummary.model
              : null,
          semantic_qa_skipped_reason:
            typeof localizationForContext?.semanticQaSummary?.skippedReason === "string"
              ? localizationForContext.semanticQaSummary.skippedReason
              : null,
          translation_repair_target_locales: repairTargetLocales.join(","),
          translation_repair_target_locale_count: repairTargetLocales.length,
          locale_template_override_locales: localePresentationOverrideLocales.join(","),
          locale_template_override_count: localePresentationOverrideLocales.length,
          localization_row_locales: localizationRowLocales.join(","),
          localization_row_count: localizationRowLocales.length,
          localization_approval_present: Boolean(localizationForContext?.approval),
          localization_approval_hash:
            typeof localizationForContext?.approval?.approvalHash === "string"
              ? localizationForContext.approval.approvalHash
              : null,
          localization_approval_policy_version:
            typeof localizationForContext?.approval?.policyVersion === "string"
              ? localizationForContext.approval.policyVersion
              : null,
          localization_review_policy_version:
            typeof localizationForContext?.approval?.reviewPolicyVersion === "string"
              ? localizationForContext.approval.reviewPolicyVersion
              : null,
          localized_term_snapshot_hash:
            typeof localizationForContext?.approval?.localizedTermSnapshotHash === "string"
              ? localizationForContext.approval.localizedTermSnapshotHash
              : null,
          locale_presentation_overrides_hash:
            typeof localizationForContext?.approval?.localePresentationOverridesHash === "string"
              ? localizationForContext.approval.localePresentationOverridesHash
              : null,
          localization_approved_row_hash_locales: recordKeys(
            localizationForContext?.approval?.localizationRowHashes,
          ).join(","),
        },
      });
    } catch (err) {
      console.error("[publish-offer-version] analytics insert failed", err);
    }

    return jsonResponse(req, {
      ok: true,
      deals: publishedDeals,
    });
  } catch (err) {
    console.error("[publish-offer-version] unexpected error", err);
    return jsonResponse(req, { error: "Server error" }, 500);
  }
});
