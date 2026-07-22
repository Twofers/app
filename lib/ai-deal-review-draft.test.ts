import { describe, expect, it } from "vitest";

import { buildDeterministicAdLocalizationBundle } from "./ad-localization";
import { buildAiDealReviewDraft } from "./ai-deal-review-draft";
import type { GeneratedAd } from "./ad-variants";
import { buildOfferDefinitionV1 } from "./offer-definition";
import { buildPosterSpecFromOfferDefinition } from "./poster/posterCopy";

function definition() {
  const built = buildOfferDefinitionV1({
    businessId: "biz_123",
    businessName: "Cedar Bean",
    locationId: "loc_123",
    locationName: "Cedar Bean - Irving",
    dealEligibility: {
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "latte",
      requiredItemRetailValueCents: 600,
      freeItemQuantity: 1,
      freeItemDescription: "cookie",
      freeItemRetailValueCents: 300,
      freeItemDiscountPercent: 100,
    },
    eligibilityResult: { eligible: true, eligibilityStatus: "VALID", customerValuePercent: 50 },
    activeWindowHumanReadable: "Today 2:00 PM to 4:00 PM",
    quantityLimit: 20,
    schedule: {
      mode: "one_time",
      summary: "Today 2:00 PM to 4:00 PM",
      startsAt: "2026-06-23T14:00:00-05:00",
      endsAt: "2026-06-23T16:00:00-05:00",
      timeZone: "America/Chicago",
    },
  });
  if (!built) throw new Error("expected offer definition");
  return built;
}

function generatedAd(): GeneratedAd {
  const offerDefinition = definition();
  const localizationBundle = buildDeterministicAdLocalizationBundle({
    sourceLocale: "en-US",
    sourceCreative: {
      headline: "Latte run, cookie reward",
      supportingCopy: "Your afternoon coffee comes with a little extra.",
      imageAltText: "Latte and cookie on a cafe counter",
    },
    offerDefinition,
  });
  return {
    headline: "Latte run, cookie reward",
    subheadline: "Your afternoon coffee comes with a little extra.",
    short_description: "Your afternoon coffee comes with a little extra.",
    cta: "Claim deal",
    localization_bundle: localizationBundle,
    localization_status: {
      source_locale: "en-US",
      localization_bundle_hash: localizationBundle.localizationBundleHash,
      deterministic_fallback_locales: localizationBundle.deterministicFallbackLocales,
      transcreation_provider: "test-provider",
      transcreation_model: "test-model",
      semantic_qa_provider: "test-provider",
      semantic_qa_model: "test-model",
      repair_target_locales: [],
    },
  };
}

describe("AI deal live review draft", () => {
  it("overlays every editable creative field without mutating the generated ad", () => {
    const original = generatedAd();
    const poster = buildPosterSpecFromOfferDefinition({
      definition: definition(),
      enabled: true,
      templateId: "premium",
      headline: "AFTERNOON FAVORITE",
      subline: "BAKED FRESH DAILY",
      sourceLocale: "en-US",
    });
    const result = buildAiDealReviewDraft({
      generatedAd: original,
      title: "A better coffee break",
      promoLine: "Bring a friend for the afternoon.",
      ctaText: "Get this deal",
      poster,
      sourceLocale: "en-US",
      offerDefinition: definition(),
    });

    expect(result.ad).toMatchObject({
      headline: "A better coffee break",
      subheadline: "Bring a friend for the afternoon.",
      short_description: "Bring a friend for the afternoon.",
      cta: "Get this deal",
      poster,
    });
    expect(original.headline).toBe("Latte run, cookie reward");
  });

  it("retains a verified localization bundle when source creative is unchanged", () => {
    const original = generatedAd();
    const result = buildAiDealReviewDraft({
      generatedAd: original,
      title: original.headline,
      promoLine: original.short_description ?? "",
      ctaText: "Use this deal",
      poster: null,
      sourceLocale: "en-US",
      offerDefinition: definition(),
    });

    expect(result.sourceCreativeChanged).toBe(false);
    expect(result.ad?.localization_bundle).toBe(original.localization_bundle);
    expect(result.ad?.localization_status).toBe(original.localization_status);
  });

  it("rebuilds stale target copy deterministically after a source-language edit", () => {
    const original = generatedAd();
    const result = buildAiDealReviewDraft({
      generatedAd: original,
      title: "Fresh latte, cookie reward",
      promoLine: "A new owner-edited supporting line.",
      ctaText: original.cta,
      poster: null,
      sourceLocale: "en-US",
      offerDefinition: definition(),
    });

    expect(result.sourceCreativeChanged).toBe(true);
    expect(result.ad?.localization_bundle).not.toBe(original.localization_bundle);
    expect(result.ad?.localization_bundle?.localizations["en-US"]).toMatchObject({
      headline: "Fresh latte, cookie reward",
      supportingCopy: "A new owner-edited supporting line.",
    });
    expect(result.ad?.localization_bundle?.deterministicFallbackLocales).toEqual(["es-US", "ko-KR"]);
    expect(result.ad?.localization_status).toMatchObject({
      transcreation_provider: "deterministic",
      transcreation_skipped_reason: "source_creative_edited",
    });
  });

  it("creates the deterministic bundle before approval when generation returned none", () => {
    const result = buildAiDealReviewDraft({
      generatedAd: {
        headline: "Latte run, cookie reward",
        subheadline: "Your afternoon coffee comes with a little extra.",
        cta: "Claim deal",
      },
      title: "Latte run, cookie reward",
      promoLine: "Your afternoon coffee comes with a little extra.",
      ctaText: "Claim deal",
      poster: null,
      sourceLocale: "en-US",
      offerDefinition: definition(),
    });

    expect(result.sourceCreativeChanged).toBe(false);
    expect(result.ad?.localization_bundle?.sourceLocale).toBe("en-US");
    expect(result.ad?.localization_status).toMatchObject({
      transcreation_provider: "deterministic",
      transcreation_skipped_reason: "missing_localization_bundle",
    });
  });
});
