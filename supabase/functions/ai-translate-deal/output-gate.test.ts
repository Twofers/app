import { describe, expect, it } from "vitest";
import {
  applyDealTranslationOutputGate,
  DEAL_TRANSLATION_DESCRIPTION_MAX_LENGTH,
  DEAL_TRANSLATION_TITLE_MAX_LENGTH,
  type DealTranslationGateFields,
} from "./output-gate.ts";

function baseFields(overrides: Partial<DealTranslationGateFields> = {}): DealTranslationGateFields {
  return {
    title_en: "Buy one coffee, get one free",
    title_es: "Compra un café, recibe otro gratis",
    title_ko: "커피 한 잔 사면 한 잔 무료",
    description_en: "Stop by today and enjoy the deal.",
    description_es: "Ven hoy y disfruta de la oferta.",
    description_ko: "오늘 방문해서 혜택을 누려보세요.",
    ...overrides,
  };
}

describe("applyDealTranslationOutputGate", () => {
  it("writes all fields through unchanged when everything passes", () => {
    const fields = baseFields();
    const outcome = applyDealTranslationOutputGate(fields);
    expect(outcome.fields).toEqual(fields);
    expect(outcome.blankedFields).toEqual([]);
  });

  it("blanks a Korean field that contains no Hangul", () => {
    const outcome = applyDealTranslationOutputGate(
      baseFields({ title_ko: "Buy one coffee, get one free" }),
    );
    expect(outcome.fields.title_ko).toBe("");
    expect(outcome.blankedFields).toContain("title_ko");
    // Other fields untouched.
    expect(outcome.fields.title_en).toBe("Buy one coffee, get one free");
    expect(outcome.fields.description_ko).not.toBe("");
  });

  it("blanks a Spanish field that is really just the English text relabeled", () => {
    const outcome = applyDealTranslationOutputGate(
      baseFields({
        title_en: "Buy one coffee, get one free",
        title_es: "Buy one coffee, get one free",
      }),
    );
    expect(outcome.fields.title_es).toBe("");
    expect(outcome.blankedFields).toContain("title_es");
  });

  it("keeps valid short Spanish with diacritics instead of false-rejecting it", () => {
    const outcome = applyDealTranslationOutputGate(
      baseFields({
        title_en: "2 coffees",
        title_es: "2 cafés",
      }),
    );
    expect(outcome.fields.title_es).toBe("2 cafés");
    expect(outcome.blankedFields).not.toContain("title_es");
  });

  it("keeps Spanish copy that differs meaningfully from English even without a signal word or diacritic", () => {
    const outcome = applyDealTranslationOutputGate(
      baseFields({
        title_en: "Buy one coffee, get one free",
        title_es: "Compra uno, recibe otro sin costo",
      }),
    );
    expect(outcome.fields.title_es).toBe("Compra uno, recibe otro sin costo");
    expect(outcome.blankedFields).not.toContain("title_es");
  });

  it("blanks any field containing banned BOGO shorthand", () => {
    const outcome = applyDealTranslationOutputGate(
      baseFields({
        title_en: "BOGO coffee deal",
        description_es: "Oferta 2x1 en café hoy",
        title_ko: "1+1 커피 이벤트",
      }),
    );
    expect(outcome.fields.title_en).toBe("");
    expect(outcome.fields.description_es).toBe("");
    expect(outcome.fields.title_ko).toBe("");
    expect(outcome.blankedFields).toEqual(
      expect.arrayContaining(["title_en", "description_es", "title_ko"]),
    );
  });

  it("blanks the Same-Item shorthand too", () => {
    const outcome = applyDealTranslationOutputGate(
      baseFields({ description_en: "Same-Item free with purchase" }),
    );
    expect(outcome.fields.description_en).toBe("");
    expect(outcome.blankedFields).toContain("description_en");
  });

  it("blanks an over-length title", () => {
    const overLongTitle = "A".repeat(DEAL_TRANSLATION_TITLE_MAX_LENGTH + 1);
    const outcome = applyDealTranslationOutputGate(baseFields({ title_en: overLongTitle }));
    expect(outcome.fields.title_en).toBe("");
    expect(outcome.blankedFields).toContain("title_en");
  });

  it("blanks an over-length description", () => {
    const overLongDescription = "A".repeat(DEAL_TRANSLATION_DESCRIPTION_MAX_LENGTH + 1);
    const outcome = applyDealTranslationOutputGate(
      baseFields({ description_ko: overLongDescription }),
    );
    expect(outcome.fields.description_ko).toBe("");
    expect(outcome.blankedFields).toContain("description_ko");
  });

  it("allows a title exactly at the max length", () => {
    const exactTitle = "A".repeat(DEAL_TRANSLATION_TITLE_MAX_LENGTH);
    const outcome = applyDealTranslationOutputGate(baseFields({ title_en: exactTitle }));
    expect(outcome.fields.title_en).toBe(exactTitle);
    expect(outcome.blankedFields).not.toContain("title_en");
  });

  it("leaves already-empty fields alone and does not report them as blanked", () => {
    const outcome = applyDealTranslationOutputGate(
      baseFields({ title_ko: "", description_es: "" }),
    );
    expect(outcome.fields.title_ko).toBe("");
    expect(outcome.fields.description_es).toBe("");
    expect(outcome.blankedFields).not.toContain("title_ko");
    expect(outcome.blankedFields).not.toContain("description_es");
  });
});
