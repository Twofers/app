import { describe, expect, it } from "vitest";

import { resolveLocalePresentationOverrides } from "./ad-locale-presentation-resolver";
import { buildDefaultAdPresentationSpec, validateAdPresentationSpec } from "./ad-presentation-spec";
import type { AdLocalizationBundle, AdLocalizedCreative } from "./ad-localization-schema";

function creative(overrides: Partial<AdLocalizedCreative> = {}): AdLocalizedCreative {
  return {
    locale: "en-US",
    headline: "Cedar Bean latte reward",
    supportingCopy: "Your afternoon latte comes with a cookie.",
    imageAltText: "Cedar Bean latte and cookie",
    exactOfferLine: "Buy 1 latte and get 1 cookie free",
    termsLine: "Limit one claim per customer.",
    preservedTerms: ["Cedar Bean", "latte", "cookie"],
    translationStatus: "persuasive_transcreation",
    qaDecision: "pass",
    qaReasonCodes: [],
    repairAttempted: false,
    repairStatus: "not_needed",
    repairReasonCodes: [],
    ...overrides,
  };
}

function bundle(overrides: Partial<AdLocalizationBundle["localizations"]> = {}): AdLocalizationBundle {
  return {
    sourceLocale: "en-US",
    sourceCreativeHash: "adsrc_12345678",
    localizationBundleHash: "adloc_12345678",
    deterministicFallbackLocales: [],
    localizations: {
      "en-US": creative({ locale: "en-US" }),
      "es-US": creative({
        locale: "es-US",
        headline: "Cedar Bean: latte con cookie gratis",
        supportingCopy: "Tu latte de la tarde viene con una cookie.",
        imageAltText: "Latte y cookie en Cedar Bean",
        exactOfferLine: "Al comprar 1 latte, recibes 1 cookie gratis",
        termsLine: "Limite de un reclamo por cliente.",
      }),
      "ko-KR": creative({
        locale: "ko-KR",
        headline: "Cedar Bean \uB77C\uB5BC \uD61C\uD0DD",
        supportingCopy: "\uC624\uD6C4 latte\uC5D0 cookie\uAC00 \uD568\uAED8 \uC81C\uACF5\uB429\uB2C8\uB2E4.",
        imageAltText: "Cedar Bean latte\uC640 cookie",
        exactOfferLine: "latte 1\uAC1C \uAD6C\uB9E4 \uC2DC cookie 1\uAC1C \uBB34\uB8CC",
        termsLine: "\uACE0\uAC1D\uB2F9 1\uD68C \uC0AC\uC6A9 \uAC00\uB2A5.",
      }),
      ...overrides,
    },
  };
}

const merchantIdentity = {
  name: "Cedar Bean",
  logoVerified: false,
};

describe("resolveLocalePresentationOverrides", () => {
  it("does not create a locale override when localized copy fits the base presentation", () => {
    const basePresentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
      templateId: "hero_image_overlay",
      textPanel: "bottom_gradient",
      showSupportingCopy: true,
    });
    const result = resolveLocalePresentationOverrides({
      basePresentation,
      merchantIdentity,
      localizationBundle: bundle(),
      enabledLocales: ["en-US"],
    });

    expect(result.localeOverrides["en-US"]).toBeUndefined();
    expect(result.presentation.localeOverrides).toBeUndefined();
    expect(result.reasonCodesByLocale["en-US"]).toEqual([]);
    expect(result.screenshotQaTriggerLocales).toEqual([]);
  });

  it("switches long Spanish localized copy to a safe split panel without changing image identity", () => {
    const basePresentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
      templateId: "hero_image_overlay",
      textPanel: "bottom_gradient",
      showSupportingCopy: true,
    });
    const result = resolveLocalePresentationOverrides({
      basePresentation,
      merchantIdentity,
      localizationBundle: bundle({
        "es-US": creative({
          locale: "es-US",
          headline: "Cedar Bean: una recompensa larga para tu pausa de latte de la tarde",
          supportingCopy: "Disfruta tu latte de la tarde con una cookie incluida durante esta ventana especial en la tienda.",
          exactOfferLine: "Al comprar 1 latte artesanal de temporada, recibes 1 cookie recien horneada gratis",
          termsLine: "Limite de un reclamo por cliente.",
        }),
      }),
    });

    expect(result.localeOverrides["es-US"]).toMatchObject({
      templateId: "split_offer_panel",
      textPanel: "solid_bottom",
      showSupportingCopy: false,
    });
    expect(result.localeOverrides["es-US"]?.resolutionReasonCodes).toEqual(
      expect.arrayContaining(["LONG_SPANISH_COPY_SAFE_SPLIT", "LOCALE_PRESENTATION_SAFE_SPLIT"]),
    );
    expect(result.presentation.imageAssetId).toBe(basePresentation.imageAssetId);
    expect(result.presentation.imageSourceType).toBe(basePresentation.imageSourceType);
    expect(validateAdPresentationSpec(result.presentation).valid).toBe(true);
  });

  it("adds a Korean font metrics guard and uses split panel for Hangul localized copy", () => {
    const basePresentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
      templateId: "live_drop_card",
      showSupportingCopy: true,
    });
    const result = resolveLocalePresentationOverrides({
      basePresentation,
      merchantIdentity,
      localizationBundle: bundle(),
    });

    expect(result.localeOverrides["ko-KR"]).toMatchObject({
      templateId: "split_offer_panel",
      textPanel: "solid_bottom",
    });
    expect(result.reasonCodesByLocale["ko-KR"]).toEqual(
      expect.arrayContaining(["HANGUL_FONT_METRICS_GUARD", "LOCALE_PRESENTATION_SAFE_SPLIT"]),
    );
  });

  it("flags exact offer overflow for screenshot review instead of shortening mechanics", () => {
    const basePresentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
      templateId: "hero_image_overlay",
    });
    const result = resolveLocalePresentationOverrides({
      basePresentation,
      merchantIdentity,
      localizationBundle: bundle({
        "es-US": creative({
          locale: "es-US",
          headline: "Cedar Bean: latte con cookie gratis",
          supportingCopy: "Tu latte de la tarde viene con una cookie.",
          exactOfferLine:
            "Al comprar 1 latte artesanal grande de temporada con leche alternativa y jarabe especial, recibes 1 cookie recien horneada gratis",
          termsLine: "Limite de un reclamo por cliente.",
        }),
      }),
      enabledLocales: ["es-US"],
    });

    expect(result.reasonCodesByLocale["es-US"]).toEqual(
      expect.arrayContaining(["EXACT_OFFER_LINE_OVERFLOW", "LOCALE_TEXT_FIT_REVIEW_REQUIRED"]),
    );
    expect(result.screenshotQaTriggerLocales).toEqual(["es-US"]);
    expect(result.localeOverrides["es-US"]?.templateId).toBe("split_offer_panel");
  });
});
