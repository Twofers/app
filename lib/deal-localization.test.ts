import { describe, expect, it } from "vitest";
import { localizedDealDescription, localizedDealTitle } from "./deal-localization";

const deal = {
  title: "BOGO iced latte",
  title_es: "Latte helado 2x1",
  title_ko: "아이스 라떼 1+1",
  description: "Buy one iced latte, get one free.",
  description_es: "Compra un latte helado y lleva otro gratis.",
  description_ko: "아이스 라떼 하나 사면 하나 무료.",
};

describe("deal localization", () => {
  it("uses Spanish deal fields for Spanish language tags", () => {
    expect(localizedDealTitle(deal, "es-MX")).toBe("Latte helado 2x1");
    expect(localizedDealDescription(deal, "es-MX")).toBe("Compra un latte helado y lleva otro gratis.");
  });

  it("uses Korean deal fields for Korean language tags", () => {
    expect(localizedDealTitle(deal, "ko-KR")).toBe("아이스 라떼 1+1");
    expect(localizedDealDescription(deal, "ko-KR")).toBe("아이스 라떼 하나 사면 하나 무료.");
  });

  it("falls back to the original text when a translation is missing", () => {
    expect(localizedDealTitle({ ...deal, title_es: " " }, "es")).toBe("BOGO iced latte");
    expect(localizedDealDescription({ ...deal, description_ko: null }, "ko")).toBe("Buy one iced latte, get one free.");
  });
});
