import { describe, expect, it } from "vitest";

import { buildAdSpecV1, buildAdSpecV3, validateAdSpecV1, validateAdSpecV3 } from "./ad-spec";
import { buildOfferDefinitionV1 } from "./offer-definition";

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
    schedule: {
      startsAt: "2026-06-22T16:30:00.000Z",
      endsAt: "2026-06-22T18:00:00.000Z",
      timeZone: "America/Chicago",
    },
    sourceAssetIds: ["deal-photos/cedar-latte.png"],
  });
  if (!definition) throw new Error("Expected valid definition");
  return definition;
}

describe("AdSpec V1 deterministic renderer contract", () => {
  it("copies authoritative facts into every native-rendered channel", () => {
    const definition = buildDefinition();
    const spec = buildAdSpecV1({
      source: "create_ai",
      offerDefinition: definition,
      generatedAd: {
        headline: "Your coffee break just doubled",
        subheadline: "Bring a friend before the window closes.",
        short_description: "Claim a latte offer at Cedar Bean today.",
        push_notification: "Latte offer live until 1:00 PM.",
        social_caption: "Coffee break for two.",
        cta: "Claim BOGO",
        poster_storage_path: "business/poster.png",
        photo_source: "uploaded_original",
        copy_source: "AI_VALIDATED",
      },
    });

    expect(validateAdSpecV1(spec)).toEqual({ valid: true, reasonCodes: [] });
    expect(spec.offer.canonicalOfferSentence).toBe(definition.canonicalOfferSentence);
    expect(spec.channels.feed.canonicalOfferSentence).toBe(definition.canonicalOfferSentence);
    expect(spec.channels.detail.disclosureLine).toBe(definition.disclosureLine);
    expect(spec.channels.claim.accessibility.criticalTextRenderedNatively).toBe(true);
    expect(spec.channels.share.templateId).toBe("share-static-v1");
    expect(spec.channels.feed.visual.posterStoragePath).toBe("business/poster.png");
  });

  it("falls back to safe text templates when no AI copy or poster exists", () => {
    const definition = { ...buildDefinition(), sourceAssetIds: [] };
    const spec = buildAdSpecV1({
      source: "create_quick",
      offerDefinition: definition,
      generatedAd: null,
    });

    expect(validateAdSpecV1(spec).valid).toBe(true);
    expect(spec.creative.copySource).toBe("DETERMINISTIC_FALLBACK");
    expect(spec.channels.feed.templateId).toBe("emergency-text-v1");
    expect(spec.channels.feed.visual.source).toBe("template_fallback");
    expect(spec.channels.feed.headline).toBe(definition.canonicalOfferLine);
  });

  it("rejects specs where channel facts drift from the offer", () => {
    const definition = buildDefinition();
    const spec = buildAdSpecV1({ source: "create_ai", offerDefinition: definition });
    const invalid = {
      ...spec,
      channels: {
        ...spec.channels,
        feed: {
          ...spec.channels.feed,
          canonicalOfferSentence: "Different terms.",
        },
      },
    };

    expect(validateAdSpecV1(invalid)).toEqual({
      valid: false,
      reasonCodes: ["FACT_MISMATCH_FEED"],
    });
  });
});

describe("AdSpec V3 creative contract", () => {
  it("keeps locked offer facts deterministic while carrying AI copy provenance", () => {
    const definition = buildDefinition();
    const spec = buildAdSpecV3({
      source: "create_ai",
      offerDefinition: definition,
      generatedAd: {
        headline: "Your coffee break just doubled",
        subheadline: "A smooth latte offer for the lunch lull.",
        short_description: "Bring a friend for a latte before the window closes.",
        push_notification: "Latte BOGO live now.",
        social_caption: "Coffee break for two at Cedar Bean.",
        locked_offer_line: "Buy two lattes and get one free",
        cta: "Claim BOGO",
        poster_storage_path: "business/poster.png",
        photo_source: "uploaded_original",
        copy_source: "AI_VALIDATED",
      },
      visual: {
        sourceType: "owner_upload",
        posterStoragePath: "business/poster.png",
      },
      copyModel: "gpt-5-mini",
    });

    expect(validateAdSpecV3(spec)).toEqual({ valid: true, reasonCodes: [] });
    expect(spec.creative.offerLine).toBe(definition.canonicalOfferLine);
    expect(spec.terms.lockedOfferLine).toBe(definition.canonicalOfferLine);
    expect(spec.textProvenance.displayHook).toBe("ai_generated");
    expect(spec.textProvenance.offerLine).toBe("deterministic");
    expect(spec.visual.sourceBadge).toBe("Your photo");
    expect(spec.provenance.copyPromptVersion).toBe("AI_COPY_PROMPT_V2");
  });

  it("records owner-edited fields without changing locked terms", () => {
    const definition = buildDefinition();
    const spec = buildAdSpecV3({
      source: "create_quick",
      offerDefinition: definition,
      generatedAd: {
        headline: "Latte BOGO for the regulars",
        subheadline: "Buy one latte and get one free.",
        short_description: "Buy one latte and get one free.",
        push_notification: "Buy one latte and get one free.",
        social_caption: "Buy one latte and get one free.",
        cta: "Claim deal",
        poster_storage_path: "business/poster.png",
        photo_source: "uploaded_original",
        copy_source: "AI_VALIDATED",
      },
      visual: {
        sourceType: "owner_upload",
        posterStoragePath: "business/poster.png",
      },
      textProvenanceOverrides: {
        displayHook: "merchant_edited",
        supportingLine: "merchant_typed",
      },
    });

    expect(validateAdSpecV3(spec).valid).toBe(true);
    expect(spec.textProvenance.displayHook).toBe("merchant_edited");
    expect(spec.textProvenance.supportingLine).toBe("merchant_typed");
    expect(spec.creative.offerLine).toBe(definition.canonicalOfferLine);
  });

  it("requires generated media to be explicitly authorized by an empty eligible pool", () => {
    const definition = buildDefinition();
    const spec = buildAdSpecV3({
      source: "create_ai",
      offerDefinition: definition,
      generatedAd: {
        headline: "Latte BOGO",
        subheadline: "Buy one latte and get one free.",
        short_description: "Buy one latte and get one free.",
        push_notification: "Buy one latte and get one free.",
        social_caption: "Buy one latte and get one free.",
        cta: "Claim deal",
        poster_storage_path: "business/generated.png",
        photo_source: "generated",
        copy_source: "AI_VALIDATED",
      },
      visual: {
        sourceType: "generated",
        posterStoragePath: "business/generated.png",
      },
    });

    expect(validateAdSpecV3(spec)).toEqual({
      valid: false,
      reasonCodes: ["GENERATED_WITHOUT_EMPTY_POOL_AUTHORIZATION"],
    });

    const authorized = {
      ...spec,
      visual: {
        ...spec.visual,
        generationAuthorizedReason: "NO_ELIGIBLE_MEDIA" as const,
      },
    };
    expect(validateAdSpecV3(authorized)).toEqual({ valid: true, reasonCodes: [] });
  });
});
