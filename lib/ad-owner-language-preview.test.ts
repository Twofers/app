import { describe, expect, it } from "vitest";

import { buildQaCheckedAdLocalizationBundle } from "./ad-localization";
import { buildOwnerLanguagePreview } from "./ad-owner-language-preview";
import type { GeneratedAd } from "./ad-variants";
import { renderLocalizedOfferFromDefinition } from "./localized-offer-renderer";
import { buildOfferDefinitionV1 } from "./offer-definition";

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
      requiredItemId: "sku_latte",
      requiredItemDescription: "latte",
      requiredItemRetailValueCents: 600,
      freeItemQuantity: 1,
      freeItemDescription: "cookie",
      freeItemRetailValueCents: 300,
      freeItemDiscountPercent: 100,
    },
    eligibilityResult: {
      eligible: true,
      eligibilityStatus: "VALID",
      customerValuePercent: 50,
    },
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
  return {
    headline: "Cedar Bean latte reward",
    subheadline: "Your afternoon latte comes with a cookie.",
    short_description: "A quick cafe treat.",
    cta: "Claim deal",
    locked_offer_line: offerDefinition.canonicalOfferLine,
    locked_terms_line: offerDefinition.disclosureLine,
    localization_bundle: buildQaCheckedAdLocalizationBundle({
      sourceLocale: "en-US",
      sourceCreative: {
        headline: "Cedar Bean latte reward",
        supportingCopy: "Your afternoon latte comes with a cookie.",
        imageAltText: "Cedar Bean latte and cookie",
      },
      targetCreatives: {
        "es-US": {
          headline: "Cedar Bean: latte con cookie gratis",
          supportingCopy: "Tu latte de la tarde viene con una cookie.",
          imageAltText: "Latte y cookie en Cedar Bean",
        },
      },
      offerDefinition,
      protectedTerms: ["Cedar Bean", "latte", "cookie"],
    }),
  };
}

describe("buildOwnerLanguagePreview", () => {
  it("uses verified target localization copy while keeping locked localized offer facts authoritative", () => {
    const offerDefinition = definition();
    const ad = generatedAd();
    const expectedSpanishFacts = renderLocalizedOfferFromDefinition(offerDefinition, { locale: "es-US" });

    const preview = buildOwnerLanguagePreview({
      generatedAd: ad,
      offerDefinition,
      sourceLocale: "en-US",
      previewLocale: "es-US",
      localizedPreviewEnabled: true,
      fallbackCtaLabel: "Claim deal",
    });

    expect(preview.locale).toBe("es-US");
    expect(preview.sourceLocale).toBe("en-US");
    expect(preview.hasVerifiedLocalizationBundle).toBe(true);
    expect(preview.translationStatus).toBe("persuasive_transcreation");
    expect(preview.qaDecision).toBe("pass");
    expect(preview.headline).toBe("Cedar Bean: latte con cookie gratis");
    expect(preview.body).toBe("Tu latte de la tarde viene con una cookie.");
    expect(preview.imageAltText).toBe("Latte y cookie en Cedar Bean");
    expect(preview.cta).toBe("Reclamar oferta");
    expect(preview.offerFacts.primaryOfferLine).toBe(expectedSpanishFacts.primaryOfferLine);
    expect(preview.offerLine).toBe(expectedSpanishFacts.primaryOfferLine);
    expect(preview.termsLine).toBe(expectedSpanishFacts.termsLine);
    expect(preview.copy).toMatchObject({
      headline: "Cedar Bean: latte con cookie gratis",
      supportingCopy: "Tu latte de la tarde viene con una cookie.",
      ctaLabel: "Reclamar oferta",
      imageAltText: "Latte y cookie en Cedar Bean",
    });
  });

  it("keeps source locale CTA and source creative when previewing the source language", () => {
    const offerDefinition = definition();

    const preview = buildOwnerLanguagePreview({
      generatedAd: generatedAd(),
      offerDefinition,
      sourceLocale: "en-US",
      previewLocale: "en-US",
      localizedPreviewEnabled: true,
    });

    expect(preview.headline).toBe("Cedar Bean latte reward");
    expect(preview.body).toBe("Your afternoon latte comes with a cookie.");
    expect(preview.cta).toBe("Claim deal");
    expect(preview.translationStatus).toBe("source_creative");
    expect(preview.qaDecision).toBe("not_required");
  });

  it("falls back to legacy source copy when localized preview is disabled", () => {
    const offerDefinition = definition();

    const preview = buildOwnerLanguagePreview({
      generatedAd: generatedAd(),
      offerDefinition,
      sourceLocale: "en-US",
      previewLocale: "es-US",
      localizedPreviewEnabled: false,
      fallbackCtaLabel: "Claim deal",
    });

    expect(preview.hasVerifiedLocalizationBundle).toBe(false);
    expect(preview.translationStatus).toBeNull();
    expect(preview.headline).toBe("Cedar Bean latte reward");
    expect(preview.body).toBe("Your afternoon latte comes with a cookie.");
    expect(preview.cta).toBe("Claim deal");
    expect(preview.offerFacts.primaryOfferLine).toBe(offerDefinition.canonicalOfferLine);
  });
});
