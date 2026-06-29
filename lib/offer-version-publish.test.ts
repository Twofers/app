import { describe, expect, it } from "vitest";

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
import {
  buildAuthoritativeDealDisplayCopy,
  buildComposedScreenshotQaSnapshot,
  buildOfferVersionPublishAdSpec,
  buildPublishMechanicsValidationCopy,
  createPublishIdempotencyKey,
} from "./offer-version-publish";
import { buildAdImageSelection } from "./merchant-image-selection";

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
        "Purchase 1 latte to receive 1 latte free. Redeem only at Main Street. Limited to 20 available. Offer window: Today, 11:30 AM-1:00 PM. Limit one claim per customer.",
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
