import { beforeEach, describe, expect, it, vi } from "vitest";

const publishMocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("./supabase", () => ({
  supabase: {
    functions: { invoke: publishMocks.invoke },
  },
}));

import { buildDeterministicAdLocalizationBundle } from "./ad-localization";
import { buildVerifiedAdLocalizationApproval } from "./ad-localization-approval";
import {
  AD_SPEC_RENDERER_VERSION,
  AD_SPEC_TEMPLATE_VERSION,
} from "./ad-spec";
import { runDeterministicAdCompositeQa } from "./ad-composite-qa";
import { createAdPresentationHash } from "./ad-presentation-hash";
import { buildDefaultAdPresentationSpec } from "./ad-presentation-spec";
import { buildApprovedAdCopy } from "./ad-render-content";
import { buildLockedOfferContent } from "./authoritative-offer-renderer";
import { buildOfferDefinitionV1 } from "./offer-definition";
import {
  buildDealOfferContract,
  validateAiCopyAgainstOffer,
} from "./deal-offer-contract";
import { validateDealEligibility, type DealEligibilityInput } from "./deal-eligibility";
import {
  buildAuthoritativeDealDisplayCopy,
  buildComposedScreenshotQaSnapshot,
  buildOfferVersionPublishAdSpec,
  buildPublishMechanicsValidationCopy,
  checkMerchantDealTitleAgainstOffer,
  createPublishIdempotencyKey,
  isEdgeRuntimeFailureMessage,
  publishOfferVersionedDeal,
  PUBLISH_SERVICE_UNAVAILABLE_CODE,
  type PublishOfferVersionedDealBody,
} from "./offer-version-publish";
import { buildAdImageSelection } from "./merchant-image-selection";
import { buildPosterSpecFromOfferDefinition } from "./poster/posterCopy";

function buildDefinition() {
  const definition = buildOfferDefinitionV1({
    businessId: "11111111-1111-4111-8111-111111111111",
    businessName: "Cedar Bean",
    locationId: "22222222-2222-4222-8222-222222222222",
    locationName: "Main Street",
    dealEligibility: {
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredPurchaseQuantity: 1,
      freeItemQuantity: 1,
      requiredItemDescription: "latte",
      freeItemDescription: "latte",
    },
    eligibilityResult: { eligible: true, eligibilityStatus: "VALID", customerValuePercent: 50 },
    activeWindowHumanReadable: "Today, 11:30 AM-1:00 PM",
    quantityLimit: 20,
  });
  if (!definition) throw new Error("Expected valid definition");
  return definition;
}

describe("offer version publish client helpers", () => {
  it("creates scoped idempotency keys", () => {
    expect(createPublishIdempotencyKey("create_ai")).toMatch(/^create_ai:.{12,}/);
    expect(createPublishIdempotencyKey("create_quick")).toMatch(/^create_quick:.{12,}/);
  });

  it("uses authoritative offer definition lines for customer-visible deal copy", () => {
    const definition = buildDefinition();

    expect(
      buildAuthoritativeDealDisplayCopy(definition, {
        title: "AI coffee hook",
        description: "Persuasive generated body.",
      }),
    ).toEqual({
      title: "Buy one latte and get one free",
      description:
        "Purchase one latte to receive one latte free. Redeem only at Main Street. Limited to 20 available. Offer window: Today, 11:30 AM-1:00 PM. Limit one claim per customer.",
    });
  });

  it("validates publish mechanics from locked offer terms instead of repeated preview copy", () => {
    const dealEligibility = {
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "egg sandwich",
      requiredItemRetailValueCents: 700,
      freeItemQuantity: 1,
      freeItemDescription: "coffee",
      freeItemRetailValueCents: 300,
      freeItemDiscountPercent: 100,
    };
    const eligibilityResult = { eligible: true, eligibilityStatus: "VALID" as const, customerValuePercent: 43 };
    const contract = buildDealOfferContract({
      businessId: "11111111-1111-4111-8111-111111111111",
      businessName: "Test Cafe",
      locationId: "22222222-2222-4222-8222-222222222222",
      locationName: "Test Cafe",
      dealEligibility,
      eligibilityResult,
      activeWindowHumanReadable: "Today, 8:00 AM-10:00 AM",
      quantityLimit: 50,
    });
    if (!contract) throw new Error("Expected valid contract");
    const definition = buildOfferDefinitionV1({
      businessId: "11111111-1111-4111-8111-111111111111",
      businessName: "Test Cafe",
      locationId: "22222222-2222-4222-8222-222222222222",
      locationName: "Test Cafe",
      dealEligibility,
      eligibilityResult,
      activeWindowHumanReadable: "Today, 8:00 AM-10:00 AM",
      quantityLimit: 50,
    });
    if (!definition) throw new Error("Expected valid definition");

    const repeatedPreviewCopy = {
      headline: definition.canonicalOfferLine,
      short_description: definition.canonicalOfferLine,
      push_notification: definition.canonicalOfferLine,
      social_caption: definition.canonicalOfferLine,
    };

    expect(validateAiCopyAgainstOffer(repeatedPreviewCopy, contract).reasonCodes).toContain("DUPLICATE_HEADLINE_DESCRIPTION");
    expect(validateAiCopyAgainstOffer(buildPublishMechanicsValidationCopy(definition), contract)).toEqual({
      valid: true,
      reasonCodes: [],
    });
  });

  it("keeps a fact-safe merchant-edited title over the canonical offer line", () => {
    const definition = buildDefinition();

    expect(
      buildAuthoritativeDealDisplayCopy(
        definition,
        { title: "Latte time with a friend", description: "Body." },
        { factSafeMerchantTitle: "Latte time with a friend" },
      ).title,
    ).toBe("Latte time with a friend");

    // Absent or blank merchant title keeps the canonical line (unedited publishes unchanged).
    expect(
      buildAuthoritativeDealDisplayCopy(
        definition,
        { title: "AI coffee hook", description: "Body." },
        { factSafeMerchantTitle: "   " },
      ).title,
    ).toBe("Buy one latte and get one free");
  });

  it("allows merchant titles that omit facts but blocks titles that contradict them", () => {
    const percentOffEligibility: DealEligibilityInput = {
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 40,
      itemDescription: "agujjim",
      itemRetailValueCents: 2500,
    };
    const contract = buildDealOfferContract({
      businessId: "11111111-1111-4111-8111-111111111111",
      businessName: "Seoul Table",
      locationId: "22222222-2222-4222-8222-222222222222",
      locationName: "Seoul Table",
      dealEligibility: percentOffEligibility,
      eligibilityResult: validateDealEligibility(percentOffEligibility),
      activeWindowHumanReadable: "Today, 5:00 PM-9:00 PM",
      quantityLimit: 25,
    });
    if (!contract) throw new Error("Expected valid contract");

    // Creative titles that omit facts are fine — the locked offer line carries them.
    expect(checkMerchantDealTitleAgainstOffer({ title: "Seoul Table dinner night" }, contract).ok).toBe(true);
    // The canonical line itself always passes.
    expect(checkMerchantDealTitleAgainstOffer({ title: "Get 40% off one agujjim" }, contract).ok).toBe(true);
    // Empty input and missing contract are no-ops.
    expect(checkMerchantDealTitleAgainstOffer({ title: "" }, contract).ok).toBe(true);
    expect(checkMerchantDealTitleAgainstOffer({ title: "Free agujjim" }, null).ok).toBe(true);

    // Contradictions block: "free" on a percent-off deal.
    const freeCheck = checkMerchantDealTitleAgainstOffer({ title: "Free agujjim tonight" }, contract);
    expect(freeCheck.ok).toBe(false);
    expect(freeCheck.blockingCodes).toContain("FREE_OR_BOGO_LANGUAGE_NOT_ALLOWED");

    // Wrong percent blocks.
    const percentCheck = checkMerchantDealTitleAgainstOffer({ title: "50% off agujjim" }, contract);
    expect(percentCheck.ok).toBe(false);
    expect(percentCheck.blockingCodes).toContain("DISCOUNT_PERCENT_CHANGED");

    // A contradicting subheadline blocks even when the title is clean.
    const supportingCheck = checkMerchantDealTitleAgainstOffer(
      { title: "Dinner night", supportingLine: "Buy one get one free agujjim" },
      contract,
    );
    expect(supportingCheck.ok).toBe(false);

    // Overlong merchant titles block instead of being silently clipped.
    const longCheck = checkMerchantDealTitleAgainstOffer(
      { title: `Agujjim night ${"very ".repeat(20)}special` },
      contract,
    );
    expect(longCheck.ok).toBe(false);
    expect(longCheck.blockingCodes).toContain("HEADLINE_TOO_LONG");
  });

  it("blocks merchant titles that change buy-one-get-something-free mechanics", () => {
    const bogsfEligibility: DealEligibilityInput = {
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "egg sandwich",
      requiredItemRetailValueCents: 700,
      freeItemQuantity: 1,
      freeItemDescription: "coffee",
      freeItemRetailValueCents: 300,
      freeItemDiscountPercent: 100,
    };
    const contract = buildDealOfferContract({
      businessId: "11111111-1111-4111-8111-111111111111",
      businessName: "Test Cafe",
      locationId: "22222222-2222-4222-8222-222222222222",
      locationName: "Test Cafe",
      dealEligibility: bogsfEligibility,
      eligibilityResult: validateDealEligibility(bogsfEligibility),
      activeWindowHumanReadable: "Today, 8:00 AM-10:00 AM",
      quantityLimit: 50,
    });
    if (!contract) throw new Error("Expected valid contract");

    expect(checkMerchantDealTitleAgainstOffer({ title: "Morning sandwich run" }, contract).ok).toBe(true);
    const buyBothCheck = checkMerchantDealTitleAgainstOffer({ title: "Buy both and save big" }, contract);
    expect(buyBothCheck.ok).toBe(false);
    expect(buyBothCheck.blockingCodes).toContain("BUYS_BOTH_ITEMS");
  });

  it("falls back to cleaned AI copy when no offer definition is available", () => {
    expect(
      buildAuthoritativeDealDisplayCopy(null, {
        title: "  Cozy   lunch deal ",
        description: " Fresh pastries   today. ",
      }),
    ).toEqual({
      title: "Cozy lunch deal",
      description: "Fresh pastries today.",
    });
  });

  it("builds a native-renderer ad spec for publish audit and OfferVersion binding", () => {
    const definition = buildDefinition();
    const imageSelection = buildAdImageSelection({
      photoSource: "uploaded_original",
      selectedStoragePath: "biz/poster.png",
      qa: {
        checked: false,
        sourceType: "merchant_original",
        decision: "unavailable",
        hardFailReasons: [],
        warningCodes: ["MERCHANT_SELECTED_ORIGINAL"],
        missingItems: [],
        unavailable: true,
        merchantOverrideAllowed: true,
        merchantOverrideAcknowledged: true,
      },
    });
    const spec = buildOfferVersionPublishAdSpec("create_quick", definition, {
      headline: "BOGO lattes",
      subheadline: "Bring a friend",
      short_description: "Buy one latte, get one free.",
      cta: "Claim deal",
      poster_storage_path: "biz/poster.png",
      photo_source: "fallback_template",
      locked_offer_line: "Buy one latte, get one free",
      locked_terms_line: "Limit one claim.",
      push_notification: "BOGO now",
      social_caption: "Coffee run",
      terms_summary: "Limit one claim.",
      item_research: { item_name: "latte", description: "", is_familiar: true },
      image_selection: imageSelection,
    });

    expect(spec.adSpecVersion).toBe(1);
    expect(spec.rendererVersion).toBe(AD_SPEC_RENDERER_VERSION);
    expect(spec.templateVersion).toBe(AD_SPEC_TEMPLATE_VERSION);
    expect(spec.source).toBe("create_quick");
    expect(spec.offer.canonicalOfferSentence).toBe(definition.canonicalOfferSentence);
    expect(spec.channels.feed.canonicalOfferSentence).toBe(definition.canonicalOfferSentence);
    expect(spec.channels.feed.visual.posterStoragePath).toBe("biz/poster.png");
    expect(spec.channels.feed.visual.imageSelection?.selectedStoragePath).toBe("biz/poster.png");
    expect(spec.channels.feed.visual.imageSelection?.sourceMode).toBe("merchant_original");
    expect(spec.channels.claim.accessibility.criticalTextRenderedNatively).toBe(true);
  });

  it("normalizes poster copy to the localization source language in publish ad specs", () => {
    const definition = buildOfferDefinitionV1({
      businessId: "11111111-1111-4111-8111-111111111111",
      businessName: "Test Cafe",
      locationId: "22222222-2222-4222-8222-222222222222",
      locationName: "9460 N MacArthur Blvd, Irving, TX 75063, USA",
      dealEligibility: {
        dealType: "PERCENT_OFF_SINGLE_ITEM",
        appliesTo: "SINGLE_ITEM",
        discountPercent: 50,
        itemDescription: "Large americano",
      },
      eligibilityResult: { eligible: true, eligibilityStatus: "VALID", customerValuePercent: 50 },
      activeWindowHumanReadable: "Today, 4:21 PM-5:21 PM",
      quantityLimit: 10,
    });
    if (!definition) throw new Error("Expected valid definition");
    const poster = buildPosterSpecFromOfferDefinition({
      definition,
      enabled: true,
      templateId: "premium",
      sourceAssetPath: "11111111-1111-4111-8111-111111111111/ai_ad_generated.png",
      renderedAssetPath: null,
      headline: "Pausa para cafÃ©",
      sourceLocale: "es-US",
      businessCategory: "Cafe",
    });
    const localizationBundle = buildDeterministicAdLocalizationBundle({
      sourceLocale: "es-US",
      sourceCreative: {
        headline: "Pausa para cafÃ©",
        supportingCopy: "Americano a mitad de precio.",
        imageAltText: "Americano en una mesa",
      },
      offerDefinition: definition,
    });

    const spec = buildOfferVersionPublishAdSpec("create_ai", definition, {
      headline: "Pausa para cafÃ©",
      subheadline: "Americano a mitad de precio.",
      short_description: "Americano a mitad de precio.",
      cta: "Usar oferta",
      poster_storage_path: "11111111-1111-4111-8111-111111111111/ai_ad_generated.png",
      poster,
      localization_bundle: localizationBundle,
    });

    expect(Object.keys(poster.copy_by_language)).toEqual(["en-US", "es-US", "ko-KR"]);
    expect(spec.selected_language).toBe("es-US");
    expect(Object.keys(spec.poster?.copy_by_language ?? {})).toEqual(["es-US"]);
    expect(spec.poster?.copy_by_language["es-US"]?.headline).toBe(
      poster.copy_by_language["es-US"].headline,
    );
    expect(spec.creative_format).toBe("poster_v1");
  });

  it("embeds exact composed-card approval metadata when provided", () => {
    const definition = buildDefinition();
    const presentation = buildDefaultAdPresentationSpec({
      imageAssetId: "biz/poster.png",
      imageSourceType: "merchant_original",
      templateId: "split_offer_panel",
    });
    const offerFacts = buildLockedOfferContent({
      primaryOfferLine: definition.canonicalOfferLine,
      termsLine: definition.disclosureLine,
    });
    const copy = buildApprovedAdCopy({
      headline: "Coffee tastes better together",
      supportingCopy: "Bring a friend",
      ctaLabel: "Claim deal",
      fallbackHeadline: offerFacts.primaryOfferLine,
    });
    const compositeQa = runDeterministicAdCompositeQa({
      offerFacts,
      copy,
      merchant: { name: definition.merchantName, locationName: definition.locationName },
      presentation,
      liveState: {
        status: "live",
        statusLabel: "Live now",
        quantityRemainingLabel: "12 left",
        timeRemainingLabel: "Today",
        claimAvailable: true,
      },
      surface: "merchant_preview",
      imageUri: "https://example.com/poster.png",
      selectedImageAssetId: "biz/poster.png",
    });
    const presentationHash = createAdPresentationHash({ presentation, offerFacts, copy });
    const spec = buildOfferVersionPublishAdSpec("create_ai", definition, null, {
      composedCard: {
        presentation,
        presentationHash,
        selectedTemplateId: presentation.templateId,
        alternateTemplateIds: ["hero_image_overlay"],
        merchantStyleOverrideUsed: true,
        compositeQa,
        screenshotQa: {
          required: false,
          triggerCodes: [],
          decision: "not_run",
        },
      },
    });

    expect(spec.composedCard?.presentationHash).toBe(presentationHash);
    expect(spec.composedCard?.selectedTemplateId).toBe("split_offer_panel");
    expect(spec.composedCard?.alternateTemplateIds).toEqual(["hero_image_overlay"]);
    expect(spec.composedCard?.merchantStyleOverrideUsed).toBe(true);
    expect(spec.composedCard?.compositeQa.decision).toBe("pass");
  });

  it("embeds verified localization storage metadata when a generated ad has a bundle", () => {
    const definition = buildDefinition();
    const localizationBundle = buildDeterministicAdLocalizationBundle({
      sourceLocale: "en-US",
      sourceCreative: {
        headline: "Latte run, cookie reward",
        supportingCopy: "Your afternoon coffee comes with a little extra.",
        imageAltText: "Latte and cookie on a cafe counter",
      },
      offerDefinition: definition,
      protectedTerms: ["Cedar Bean", "latte"],
    });
    const presentation = buildDefaultAdPresentationSpec({
      imageAssetId: "biz/poster.png",
      imageSourceType: "merchant_original",
      localeOverrides: {
        "ko-KR": {
          templateId: "split_offer_panel",
          textPanel: "solid_bottom",
          showSupportingCopy: false,
          resolutionReasonCodes: ["HANGUL_FONT_METRICS_GUARD"],
        },
      },
    });
    const offerFacts = buildLockedOfferContent({
      primaryOfferLine: definition.canonicalOfferLine,
      termsLine: definition.disclosureLine,
    });
    const copy = buildApprovedAdCopy({
      headline: "Latte run, cookie reward",
      supportingCopy: "Your afternoon coffee comes with a little extra.",
      ctaLabel: "Claim deal",
      fallbackHeadline: definition.canonicalOfferLine,
    });
    const presentationHash = createAdPresentationHash({
      presentation,
      offerFacts,
      copy,
    });
    const approval = buildVerifiedAdLocalizationApproval({
      bundle: localizationBundle,
      offerDefinition: definition,
      presentationHash,
      selectedImageAssetId: presentation.imageAssetId,
      localePresentationOverrides: presentation.localeOverrides,
      providerStatus: {
        transcreation_provider: "deterministic",
        transcreation_model: "none",
        semantic_qa_provider: "deterministic",
        semantic_qa_model: "none",
        repair_target_locales: [],
      },
    });
    if (!approval.approved) throw new Error(`expected approval: ${approval.reasonCodes.join(",")}`);
    const spec = buildOfferVersionPublishAdSpec(
      "create_ai",
      definition,
      {
        headline: "Latte run, cookie reward",
        subheadline: "Your afternoon coffee comes with a little extra.",
        short_description: "Your afternoon coffee comes with a little extra.",
        cta: "Claim deal",
        localization_bundle: localizationBundle,
        localization_status: {
          source_locale: "en-US",
          localization_bundle_hash: localizationBundle.localizationBundleHash,
          deterministic_fallback_locales: localizationBundle.deterministicFallbackLocales,
          transcreation_provider: "deterministic",
          transcreation_model: "none",
          semantic_qa_provider: "deterministic",
          semantic_qa_model: "none",
          repair_target_locales: [],
        },
      },
      {
        composedCard: {
          presentation,
          presentationHash,
          selectedTemplateId: presentation.templateId,
          alternateTemplateIds: [],
          merchantStyleOverrideUsed: false,
          compositeQa: runDeterministicAdCompositeQa({
            offerFacts,
            copy,
            merchant: { name: definition.merchantName, locationName: definition.locationName },
            presentation,
            liveState: {
              status: "live",
              statusLabel: "Live now",
              quantityRemainingLabel: "12 left",
              timeRemainingLabel: "Today",
              claimAvailable: true,
            },
            surface: "merchant_preview",
            imageUri: "https://example.com/poster.png",
            selectedImageAssetId: "biz/poster.png",
          }),
          screenshotQa: {
            required: false,
            triggerCodes: [],
            decision: "not_run",
          },
        },
        localizationApproval: approval.approval,
      },
    );

    expect(spec.localization?.sourceCreativeHash).toBe(localizationBundle.sourceCreativeHash);
    expect(spec.localization?.localizationBundleHash).toBe(localizationBundle.localizationBundleHash);
    expect(spec.localization?.localizations["es-US"]?.localizationHash).toMatch(/^adlocrow_[0-9a-f]{8}$/);
    expect(spec.localization?.approval?.approvalHash).toBe(approval.approval.approvalHash);
    expect(spec.localization?.approval?.presentationHash).toBe(presentationHash);
    expect(spec.localization?.approval?.localizationBundleHash).toBe(localizationBundle.localizationBundleHash);
    expect(spec.localization?.localePresentationOverrides?.["ko-KR"]?.resolutionReasonCodes).toEqual([
      "HANGUL_FONT_METRICS_GUARD",
    ]);
    expect(JSON.stringify(spec.localization?.localizations)).not.toContain("exactOfferLine");
    expect(JSON.stringify(spec.localization?.localizations)).not.toContain("termsLine");
  });

  it("omits localization metadata when the caller explicitly suppresses it", () => {
    const definition = buildDefinition();
    const localizationBundle = buildDeterministicAdLocalizationBundle({
      sourceLocale: "en-US",
      sourceCreative: {
        headline: "Latte run, cookie reward",
        supportingCopy: "Your afternoon coffee comes with a little extra.",
        imageAltText: "Latte and cookie on a cafe counter",
      },
      offerDefinition: definition,
      protectedTerms: ["Cedar Bean", "latte"],
    });

    const spec = buildOfferVersionPublishAdSpec(
      "create_ai",
      definition,
      {
        headline: "Latte run, cookie reward",
        subheadline: "Your afternoon coffee comes with a little extra.",
        short_description: "Your afternoon coffee comes with a little extra.",
        cta: "Claim deal",
        localization_bundle: localizationBundle,
      },
      { localization: null },
    );

    expect(spec.localization).toBeUndefined();
  });

  it("builds screenshot QA publish snapshots from deterministic composite triggers", () => {
    const definition = buildDefinition();
    const presentation = buildDefaultAdPresentationSpec({
      imageAssetId: "biz/busy.png",
      imageSourceType: "ai_generated",
      templateId: "hero_image_overlay",
    });
    const offerFacts = buildLockedOfferContent({
      primaryOfferLine: definition.canonicalOfferLine,
      termsLine: definition.disclosureLine,
    });
    const copy = buildApprovedAdCopy({
      headline: "Coffee tastes better together",
      supportingCopy: "Bring a friend",
      ctaLabel: "Claim deal",
      fallbackHeadline: offerFacts.primaryOfferLine,
    });
    const compositeQa = runDeterministicAdCompositeQa({
      offerFacts,
      copy,
      merchant: { name: definition.merchantName, locationName: definition.locationName },
      presentation,
      liveState: {
        status: "live",
        statusLabel: "Live now",
        quantityRemainingLabel: "12 left",
        timeRemainingLabel: "Today",
        claimAvailable: true,
      },
      surface: "merchant_preview",
      imageUri: "https://example.com/busy.png",
      selectedImageAssetId: "biz/busy.png",
      imageSafeZoneConfidence: 0.42,
    });

    expect(compositeQa.decision).toBe("repair");
    const disabledSnapshot = buildComposedScreenshotQaSnapshot(compositeQa, false);
    expect(disabledSnapshot).toEqual({
      required: false,
      triggerCodes: ["LOW_SAFE_ZONE_CONFIDENCE", "BORDERLINE_SAFE_ZONE_CONFIDENCE"],
      decision: "not_run",
    });
    const enabledSnapshot = buildComposedScreenshotQaSnapshot(compositeQa, true);
    expect(enabledSnapshot).toEqual({
      required: true,
      triggerCodes: ["LOW_SAFE_ZONE_CONFIDENCE", "BORDERLINE_SAFE_ZONE_CONFIDENCE"],
      decision: "not_run",
    });
  });
});

describe("publish error surfacing", () => {
  const body = {
    business_id: "11111111-1111-4111-8111-111111111111",
    offer_definition: buildDefinition(),
    deal_rows: [{ business_id: "11111111-1111-4111-8111-111111111111" }],
    idempotency_key: "create_ai:test",
  } as unknown as PublishOfferVersionedDealBody;

  function invokeErrorWithBody(payload: Record<string, unknown>, status = 400): Error {
    return Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
    });
  }

  async function publishRejection(): Promise<Error & { code?: string; reasonCodes?: string[] }> {
    return publishOfferVersionedDeal(body).then(
      () => {
        throw new Error("expected publishOfferVersionedDeal to reject");
      },
      (err: Error & { code?: string; reasonCodes?: string[] }) => err,
    );
  }

  beforeEach(() => {
    publishMocks.invoke.mockReset();
  });

  it("recognizes edge runtime failures without flagging merchant-facing copy", () => {
    expect(isEdgeRuntimeFailureMessage("Could not load bundle")).toBe(true);
    expect(isEdgeRuntimeFailureMessage("Failed to load the bundle for publish-offer-version")).toBe(true);
    expect(isEdgeRuntimeFailureMessage("BOOT_ERROR")).toBe(true);
    expect(isEdgeRuntimeFailureMessage("worker boot error")).toBe(true);
    expect(isEdgeRuntimeFailureMessage("WORKER_LIMIT reached")).toBe(true);
    expect(isEdgeRuntimeFailureMessage("worker terminated")).toBe(true);

    expect(isEdgeRuntimeFailureMessage(null)).toBe(false);
    expect(isEdgeRuntimeFailureMessage("   ")).toBe(false);
    expect(isEdgeRuntimeFailureMessage("Invalid offer definition")).toBe(false);
    expect(isEdgeRuntimeFailureMessage("Business access does not currently allow publishing.")).toBe(false);
    // A merchant deal about bundles is ordinary copy, not an infrastructure failure.
    expect(isEdgeRuntimeFailureMessage("Bundle two lattes and save.")).toBe(false);
  });

  it("converts an edge runtime bundle failure into a retryable outage code", async () => {
    publishMocks.invoke.mockResolvedValue({ data: null, error: new Error("Could not load bundle") });

    const err = await publishRejection();

    expect(err.code).toBe(PUBLISH_SERVICE_UNAVAILABLE_CODE);
    // The merchant-visible banner appends this message verbatim, so the
    // runtime's own wording must not survive.
    expect(err.message.toLowerCase()).not.toContain("bundle");
    expect(err.message).toBe("The publish service is temporarily unavailable.");
  });

  it("keeps structured publish errors from the function body intact", async () => {
    publishMocks.invoke.mockResolvedValue({
      data: null,
      error: invokeErrorWithBody({
        error: "Invalid ad spec",
        error_code: "INVALID_AD_SPEC",
        reason_codes: ["POSTER_HEADLINE_OVER_LIMIT"],
      }),
    });

    const err = await publishRejection();

    expect(err.code).toBe("INVALID_AD_SPEC");
    expect(err.message).toBe("Invalid ad spec");
    expect(err.reasonCodes).toEqual(["POSTER_HEADLINE_OVER_LIMIT"]);
  });

  it("never reclassifies a response that the function body produced itself", async () => {
    publishMocks.invoke.mockResolvedValue({
      data: null,
      error: invokeErrorWithBody({
        error: "Could not load bundle",
        error_code: "PUBLISH_OFFER_VERSION_FAILED",
      }),
    });

    const err = await publishRejection();

    expect(err.code).toBe("PUBLISH_OFFER_VERSION_FAILED");
  });

  it("returns published deals on success", async () => {
    publishMocks.invoke.mockResolvedValue({
      data: {
        ok: true,
        deals: [
          {
            deal_id: "33333333-3333-4333-8333-333333333333",
            offer_definition_id: "44444444-4444-4444-8444-444444444444",
            offer_version_id: "55555555-5555-4555-8555-555555555555",
          },
        ],
      },
      error: null,
    });

    const result = await publishOfferVersionedDeal(body);

    expect(result.ok).toBe(true);
    expect(result.deals).toHaveLength(1);
  });
});
