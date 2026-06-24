import { describe, expect, it } from "vitest";

import {
  buildLocalizedDealDisplay,
  buildOfferDefinitionFromDealDisplay,
  resolveDealDisplayLocale,
  type LocalizedDealDisplayFields,
} from "./localized-deal-display";

const structuredDeal: LocalizedDealDisplayFields = {
  id: "deal_123",
  business_id: "biz_123",
  title: "Legacy title",
  title_en: "Legacy English title",
  title_es: "Legacy Spanish title",
  title_ko: "Legacy Korean title",
  description: "Legacy description",
  description_en: "Legacy English description",
  description_es: "Legacy Spanish description",
  description_ko: "Legacy Korean description",
  source_locale: "en",
  deal_type: "BUY_ONE_GET_SOMETHING_FREE",
  applies_to: "SINGLE_ITEM",
  required_purchase_quantity: 1,
  required_item_description: "latte",
  required_item_retail_value_cents: 600,
  free_item_quantity: 1,
  free_item_description: "cookie",
  free_item_retail_value_cents: 300,
  free_item_discount_percent: 100,
  customer_value_percent: 50,
  max_claims: 25,
  start_time: "2026-06-23T14:00:00-05:00",
  end_time: "2026-06-23T16:00:00-05:00",
  timezone: "America/Chicago",
  businesses: {
    name: "Cedar Bean",
    location: "Cedar Bean - Irving",
    address: "100 Main St",
  },
};

describe("localized deal display", () => {
  it("rebuilds deterministic customer copy from structured deal facts", () => {
    const definition = buildOfferDefinitionFromDealDisplay(structuredDeal);

    expect(definition?.merchantId).toBe("biz_123");
    expect(definition?.merchantName).toBe("Cedar Bean");
    expect(definition?.locationName).toBe("Cedar Bean - Irving");
    expect(definition?.totalClaimLimit).toBe(25);

    const spanish = buildLocalizedDealDisplay({
      deal: structuredDeal,
      locale: "es-US",
      localeResolutionSource: "customer_preference",
      useLocalizedOfferRenderer: true,
      fallbackLanguage: "en",
    });
    const korean = buildLocalizedDealDisplay({
      deal: structuredDeal,
      locale: "ko-KR",
      localeResolutionSource: "customer_preference",
      useLocalizedOfferRenderer: true,
      fallbackLanguage: "en",
    });

    expect(spanish.source).toBe("localized_offer_renderer");
    expect(spanish.title).toBe("Al comprar 1 latte, recibes 1 cookie gratis");
    expect(spanish.description).toContain("Hay 25 reclamos disponibles.");
    expect(korean.source).toBe("localized_offer_renderer");
    expect(korean.title).toContain("latte");
    expect(korean.title).toContain("cookie");
    expect(korean.title).not.toBe(spanish.title);
  });

  it("prefers approved customer localization rows while retaining exact mechanics", () => {
    const display = buildLocalizedDealDisplay({
      deal: {
        ...structuredDeal,
        customer_deal_localization: {
          dealId: "deal_123",
          offerVersionId: "offer_version_123",
          locale: "es-US",
          sourceLocale: "en-US",
          headline: "Tu latte viene con una galleta",
          supportingCopy: "Pide tu latte favorito y disfruta una galleta en Cedar Bean.",
          imageAltText: "Un latte junto a una galleta en el mostrador de Cedar Bean.",
          localizationHash: "adlocrow_12345678",
          localizationBundleHash: "adloc_12345678",
          translationStatus: "persuasive_transcreation",
          qaDecision: "pass",
          qaReasonCodes: [],
          deterministicFallback: false,
        },
      },
      locale: "es-US",
      localeResolutionSource: "customer_preference",
      useLocalizedOfferRenderer: true,
      fallbackLanguage: "en",
    });

    expect(display.source).toBe("approved_localization_storage");
    expect(display.title).toBe("Tu latte viene con una galleta");
    expect(display.description).toContain("Pide tu latte favorito");
    expect(display.description).toContain("Al comprar 1 latte, recibes 1 cookie gratis");
    expect(display.description).toContain("Hay 25 reclamos disponibles.");
    expect(display.localizedCreative?.localizationHash).toBe("adlocrow_12345678");
    expect(display.lockedOfferContent?.primaryOfferLine).toBe("Al comprar 1 latte, recibes 1 cookie gratis");
  });

  it("uses approved customer localization rows when exact rendering is off or unavailable", () => {
    const customerLocalization = {
      dealId: "deal_123",
      offerVersionId: "offer_version_123",
      locale: "es-US" as const,
      sourceLocale: "en-US" as const,
      headline: "Tu latte viene con una galleta",
      supportingCopy: "Pide tu latte favorito y disfruta una galleta en Cedar Bean.",
      imageAltText: "Un latte junto a una galleta en el mostrador de Cedar Bean.",
      localizationHash: "adlocrow_fallback_12345678",
      localizationBundleHash: "adloc_fallback_12345678",
      translationStatus: "persuasive_transcreation" as const,
      qaDecision: "pass" as const,
      qaReasonCodes: [],
      deterministicFallback: false,
    };
    const rendererOff = buildLocalizedDealDisplay({
      deal: {
        ...structuredDeal,
        customer_deal_localization: customerLocalization,
      },
      locale: "es-US",
      localeResolutionSource: "customer_preference",
      useLocalizedOfferRenderer: false,
      fallbackLanguage: "en",
    });
    const missingStructuredFacts = buildLocalizedDealDisplay({
      deal: {
        ...structuredDeal,
        customer_deal_localization: customerLocalization,
        deal_type: null,
        required_purchase_quantity: null,
        required_item_description: null,
        free_item_quantity: null,
        free_item_description: null,
      },
      locale: "es-US",
      localeResolutionSource: "customer_preference",
      useLocalizedOfferRenderer: true,
      fallbackLanguage: "en",
    });

    expect(rendererOff.source).toBe("approved_localization_storage");
    expect(rendererOff.title).toBe("Tu latte viene con una galleta");
    expect(rendererOff.description).toContain("Pide tu latte favorito");
    expect(rendererOff.lockedOfferContent).toBeUndefined();
    expect(missingStructuredFacts.source).toBe("approved_localization_storage");
    expect(missingStructuredFacts.title).toBe("Tu latte viene con una galleta");
  });

  it("ignores blocked customer localization rows and falls back to exact rendering", () => {
    const display = buildLocalizedDealDisplay({
      deal: {
        ...structuredDeal,
        customer_deal_localization: {
          dealId: "deal_123",
          locale: "ko-KR",
          headline: "차단된 카피",
          supportingCopy: "이 문구는 고객에게 노출되면 안 됩니다.",
          localizationHash: "adlocrow_blocked",
          translationStatus: "persuasive_transcreation",
          qaDecision: "block",
        },
      },
      locale: "ko-KR",
      localeResolutionSource: "customer_preference",
      useLocalizedOfferRenderer: true,
      fallbackLanguage: "en",
    });

    expect(display.source).toBe("localized_offer_renderer");
    expect(display.title).toContain("latte");
    expect(display.title).toContain("cookie");
    expect(display.localizedCreative).toBeUndefined();
  });

  it("uses only approval-bound ad_spec localization snapshots", () => {
    const approved = buildLocalizedDealDisplay({
      deal: {
        ...structuredDeal,
        ad_spec: {
          localization: {
            localizationBundleHash: "adloc_87654321",
            localeRendererVersion: "localized-offer-renderer-v1",
            approval: {
              localizationBundleHash: "adloc_87654321",
              localizationRowHashes: {
                "ko-KR": "adlocrow_87654321",
              },
            },
            localizations: {
              "ko-KR": {
                locale: "ko-KR",
                headline: "라떼에 쿠키까지",
                supportingCopy: "Cedar Bean에서 오늘의 달콤한 혜택을 만나보세요.",
                imageAltText: "Cedar Bean 카운터 위의 라떼와 쿠키.",
                localizationHash: "adlocrow_87654321",
                translationStatus: "persuasive_transcreation",
                qaDecision: "pass",
                qaReasonCodes: [],
              },
            },
          },
        },
      },
      locale: "ko-KR",
      localeResolutionSource: "customer_preference",
      useLocalizedOfferRenderer: true,
      fallbackLanguage: "en",
    });
    const tampered = buildLocalizedDealDisplay({
      deal: {
        ...structuredDeal,
        ad_spec: {
          localization: {
            localizationBundleHash: "adloc_87654321",
            approval: {
              localizationBundleHash: "adloc_87654321",
              localizationRowHashes: {
                "ko-KR": "adlocrow_different",
              },
            },
            localizations: {
              "ko-KR": {
                locale: "ko-KR",
                headline: "승인되지 않은 카피",
                localizationHash: "adlocrow_87654321",
                translationStatus: "persuasive_transcreation",
                qaDecision: "pass",
              },
            },
          },
        },
      },
      locale: "ko-KR",
      localeResolutionSource: "customer_preference",
      useLocalizedOfferRenderer: true,
      fallbackLanguage: "en",
    });

    expect(approved.source).toBe("approved_localization_storage");
    expect(approved.title).toBe("라떼에 쿠키까지");
    expect(approved.description).toContain("Cedar Bean");
    expect(approved.description).toContain("latte");
    expect(tampered.source).toBe("localized_offer_renderer");
  });

  it("uses legacy localized fields when deterministic rendering is off or unavailable", () => {
    const disabled = buildLocalizedDealDisplay({
      deal: structuredDeal,
      locale: "es-US",
      localeResolutionSource: "app_language",
      useLocalizedOfferRenderer: false,
      fallbackLanguage: "en",
    });
    const missingStructuredFacts = buildLocalizedDealDisplay({
      deal: {
        ...structuredDeal,
        deal_type: null,
        required_purchase_quantity: null,
        required_item_description: null,
        free_item_quantity: null,
        free_item_description: null,
      },
      locale: "es-US",
      localeResolutionSource: "app_language",
      useLocalizedOfferRenderer: true,
      fallbackLanguage: "en",
    });

    expect(disabled.source).toBe("legacy_localized_fields");
    expect(disabled.title).toBe("Buy a latte and get a free cookie");
    expect(disabled.description).toBe("");
    expect(missingStructuredFacts.source).toBe("legacy_localized_fields");
    expect(missingStructuredFacts.title).toBe("Legacy spanish title");
  });

  it("resolves customer display locale without changing the deal identity or inventory", () => {
    const resolved = resolveDealDisplayLocale({
      customerPreferredLocale: "ko-KR",
      appLanguage: "es",
      deviceLanguage: "en-US",
      adSourceLocale: "en",
    });
    const display = buildLocalizedDealDisplay({
      deal: structuredDeal,
      locale: resolved.locale,
      localeResolutionSource: resolved.source,
      useLocalizedOfferRenderer: true,
      fallbackLanguage: "en",
    });

    expect(resolved).toMatchObject({ locale: "ko-KR", source: "customer_preference" });
    expect(display.renderedLocale).toBe("ko-KR");
    expect(structuredDeal.id).toBe("deal_123");
    expect(structuredDeal.max_claims).toBe(25);
  });
});
