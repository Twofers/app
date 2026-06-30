import { describe, expect, it } from "vitest";
import { localizedDealDescription, localizedDealTitle } from "./deal-localization";

const deal = {
  title: "BOGO iced latte",
  title_en: "BOGO iced latte",
  title_es: "Latte helado 2x1",
  title_ko: "\uC544\uC774\uC2A4 \uB77C\uB5BC 1+1",
  description: "Buy one iced latte, get one free.",
  description_en: "Buy one iced latte, get one free.",
  description_es: "Compra un latte helado y lleva otro gratis.",
  description_ko: "\uC544\uC774\uC2A4 \uB77C\uB5BC \uD558\uB098\uB97C \uC0AC\uBA74 \uD558\uB098 \uBB34\uB8CC.",
};

describe("deal localization", () => {
  it("uses Spanish deal fields without rewriting them as English offer copy", () => {
    expect(localizedDealTitle(deal, "es-MX")).toBe("Latte helado 2x1");
    expect(localizedDealDescription(deal, "es-MX")).toBe("Compra un latte helado y lleva otro gratis.");
  });

  it("uses Korean deal fields without rewriting them as English offer copy", () => {
    expect(localizedDealTitle(deal, "ko-KR")).toBe("\uC544\uC774\uC2A4 \uB77C\uB5BC 1+1");
    expect(localizedDealDescription(deal, "ko-KR")).toBe("\uC544\uC774\uC2A4 \uB77C\uB5BC \uD558\uB098\uB97C \uC0AC\uBA74 \uD558\uB098 \uBB34\uB8CC.");
  });

  it("falls back to the original text when a translation is missing", () => {
    expect(localizedDealTitle({ ...deal, title_es: " " }, "es")).toBe("Buy one iced latte and get one free");
    expect(localizedDealDescription({ ...deal, description_ko: null }, "ko")).toBe("");
  });

  it("uses English translation fields when the source language is not English", () => {
    const spanishSourceDeal = {
      source_locale: "es",
      title: "Cafe helado 2x1",
      description: "Compra uno y lleva otro gratis.",
      title_en: "BOGO iced coffee",
      title_es: "Cafe helado 2x1",
      title_ko: "Iced coffee 1+1",
      description_en: "Buy one iced coffee, get one free.",
      description_es: "Compra uno y lleva otro gratis.",
      description_ko: "Buy one iced coffee, get one free.",
    };
    expect(localizedDealTitle(spanishSourceDeal, "en")).toBe("Buy one iced coffee and get one free");
    expect(localizedDealDescription(spanishSourceDeal, "en")).toBe("");
    expect(localizedDealTitle(spanishSourceDeal, "es")).toBe("Cafe helado 2x1");
  });

  it("keeps localized legacy fields ahead of English locked lines", () => {
    const lockedDeal = {
      ...deal,
      title_es: "Oferta creativa",
      description_es: "Texto promocional generado.",
      locked_offer_line: "Buy two muffins and get one free",
      locked_terms_line: "Limit one claim per customer.",
    };

    expect(localizedDealTitle(lockedDeal, "es-MX")).toBe("Oferta creativa");
    expect(localizedDealDescription(lockedDeal, "es-MX")).toBe("Texto promocional generado.");
  });
});
