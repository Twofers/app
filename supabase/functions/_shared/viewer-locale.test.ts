import { describe, expect, it } from "vitest";

import {
  buildDealReleasePushCopy,
  buildDigestPushCopy,
  buildPublicDealDisplay,
  resolveViewerLocaleFromRequest,
} from "./viewer-locale";

describe("viewer-locale shared copy", () => {
  it("uses the request lang parameter before Accept-Language", () => {
    const req = new Request("https://example.test/s?id=deal_1&lang=es", {
      headers: { "accept-language": "ko-KR,ko;q=0.9,en;q=0.5" },
    });

    expect(resolveViewerLocaleFromRequest(req)).toBe("es-US");
  });

  it("renders structured offer facts in the viewer language", () => {
    const display = buildPublicDealDisplay(
      {
        id: "deal_1",
        business_id: "biz_1",
        location_id: "loc_1",
        source_locale: "en-US",
        deal_type: "PERCENT_OFF_SINGLE_ITEM",
        applies_to: "SINGLE_ITEM",
        discount_percent: 40,
        item_description: "coffee",
        businesses: { name: "Test Cafe" },
      },
      "es-US",
    );

    expect(display.source).toBe("structured_offer");
    expect(display.title).toContain("40");
    expect(display.title).not.toMatch(/\bGet\b|\boff\b/i);
  });

  it("does not leak a source-language title when target localized copy is missing", () => {
    const display = buildPublicDealDisplay(
      {
        id: "deal_2",
        title: "김치찌개 할인",
        source_locale: "ko-KR",
        businesses: { name: "Test Cafe" },
      },
      "en-US",
    );

    expect(display.source).toBe("generic_fallback");
    expect(display.title).toBe("Limited-time local offer");
  });

  it("builds push shell copy in the recipient language", () => {
    const spanish = buildDealReleasePushCopy(
      {
        id: "deal_3",
        max_claims: 10,
        businesses: { name: "Test Cafe" },
      },
      "es-US",
    );
    expect(spanish.title).toBe("Oferta local por tiempo limitado");
    expect(spanish.body).toMatch(/Disponible ahora/);
    expect(spanish.body).not.toMatch(/Live now|Claims are limited/);

    const koreanDigest = buildDigestPushCopy("ko-KR", 2);
    expect(koreanDigest.title).toBe("근처 새 혜택");
    expect(koreanDigest.body).not.toMatch(/new deals near you/i);
  });
});
