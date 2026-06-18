import { describe, expect, it } from "vitest";
import { localizedDealDescription, localizedDealTitle } from "./deal-localization";

const deal = {
  title: "BOGO iced latte",
  title_en: "BOGO iced latte",
  title_es: "Latte helado 2x1",
  title_ko: "Iced latte 1+1",
  description: "Buy one iced latte, get one free.",
  description_en: "Buy one iced latte, get one free.",
  description_es: "Compra un latte helado y lleva otro gratis.",
  description_ko: "Buy one iced latte, get one free.",
};

describe("deal localization", () => {
  it("uses Spanish deal fields while cleaning legacy shorthand for Spanish language tags", () => {
    expect(localizedDealTitle(deal, "es-MX")).toBe("Buy one latte helado, get one free");
    expect(localizedDealDescription(deal, "es-MX")).toBe("Compra un latte helado y lleva otro gratis.");
  });

  it("uses Korean deal fields while cleaning legacy shorthand for Korean language tags", () => {
    expect(localizedDealTitle(deal, "ko-KR")).toBe("Buy one iced latte, get one free");
    expect(localizedDealDescription(deal, "ko-KR")).toBe("");
  });

  it("falls back to the original text when a translation is missing", () => {
    expect(localizedDealTitle({ ...deal, title_es: " " }, "es")).toBe("Buy one iced latte, get one free");
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
    expect(localizedDealTitle(spanishSourceDeal, "en")).toBe("Buy one iced coffee, get one free");
    expect(localizedDealDescription(spanishSourceDeal, "en")).toBe("");
    expect(localizedDealTitle(spanishSourceDeal, "es")).toBe("Buy one cafe helado, get one free");
  });
});
