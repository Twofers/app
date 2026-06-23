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
