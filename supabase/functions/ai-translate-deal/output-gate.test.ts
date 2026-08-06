import { describe, expect, it } from "vitest";
import {
  applyDealTranslationOutputGate,
  DEAL_TRANSLATION_DESCRIPTION_MAX_LENGTH,
  DEAL_TRANSLATION_TITLE_MAX_LENGTH,
  type DealTranslationGateFields,
  type DealTranslationGateInput,
  type DealTranslationSourceLocale,
} from "./output-gate.ts";

const BASE_FIELDS: DealTranslationGateFields = {
  title_en: "Buy one coffee, get one free",
  title_es: "Compra un café, recibe otro gratis",
  title_ko: "커피 한 잔 사면 한 잔 무료",
  description_en: "Stop by today and enjoy the deal.",
  description_es: "Ven hoy y disfruta de la oferta.",
  description_ko: "오늘 방문해서 혜택을 누려보세요.",
};

function titleKey(locale: DealTranslationSourceLocale): keyof DealTranslationGateFields {
  return locale === "en" ? "title_en" : locale === "es" ? "title_es" : "title_ko";
}

function descriptionKey(locale: DealTranslationSourceLocale): keyof DealTranslationGateFields {
  return locale === "en" ? "description_en" : locale === "es" ? "description_es" : "description_ko";
}

// Builds a gate input. Defaults to sourceLocale "en" with the base English
// field as the source text, mirroring the real call site where
// normalizeAiResult always pins the source-locale field(s) to the merchant's
// verbatim title/description before the gate runs. sourceTitle/
// sourceDescription default to whatever field the given sourceLocale points
// at (post-overrides), matching that real-world invariant unless a test
// deliberately wants to pass a different source string.
function makeInput(options: {
  fields?: Partial<DealTranslationGateFields>;
  sourceLocale?: DealTranslationSourceLocale;
  sourceTitle?: string;
  sourceDescription?: string;
} = {}): DealTranslationGateInput {
  const fields = { ...BASE_FIELDS, ...(options.fields ?? {}) };
  const sourceLocale = options.sourceLocale ?? "en";
  return {
    fields,
    sourceLocale,
    sourceTitle: options.sourceTitle ?? fields[titleKey(sourceLocale)],
    sourceDescription: options.sourceDescription ?? fields[descriptionKey(sourceLocale)],
  };
}

describe("applyDealTranslationOutputGate", () => {
  it("writes all fields through unchanged when everything passes", () => {
    const input = makeInput();
    const outcome = applyDealTranslationOutputGate(input);
    expect(outcome.fields).toEqual(input.fields);
    expect(outcome.blankedFields).toEqual([]);
  });

  it("blanks a Korean field that contains no Hangul", () => {
    const outcome = applyDealTranslationOutputGate(
      makeInput({ fields: { title_ko: "Buy one coffee, get one free" } }),
    );
    expect(outcome.fields.title_ko).toBe("");
    expect(outcome.blankedFields).toContain("title_ko");
    // Other fields untouched.
    expect(outcome.fields.title_en).toBe("Buy one coffee, get one free");
    expect(outcome.fields.description_ko).not.toBe("");
  });

  it("blanks a Spanish field that is really just the English text relabeled", () => {
    const outcome = applyDealTranslationOutputGate(
      makeInput({
        fields: {
          title_en: "Buy one coffee, get one free",
          title_es: "Buy one coffee, get one free",
        },
      }),
    );
    expect(outcome.fields.title_es).toBe("");
    expect(outcome.blankedFields).toContain("title_es");
  });

  it("keeps valid short Spanish with diacritics instead of false-rejecting it", () => {
    const outcome = applyDealTranslationOutputGate(
      makeInput({
        fields: {
          title_en: "2 coffees",
          title_es: "2 cafés",
        },
      }),
    );
    expect(outcome.fields.title_es).toBe("2 cafés");
    expect(outcome.blankedFields).not.toContain("title_es");
  });

  it("keeps Spanish copy that differs meaningfully from English even without a signal word or diacritic", () => {
    const outcome = applyDealTranslationOutputGate(
      makeInput({
        fields: {
          title_en: "Buy one coffee, get one free",
          title_es: "Compra uno, recibe otro sin costo",
        },
      }),
    );
    expect(outcome.fields.title_es).toBe("Compra uno, recibe otro sin costo");
    expect(outcome.blankedFields).not.toContain("title_es");
  });

  it("blanks AI-translated fields containing banned BOGO shorthand not present in the source", () => {
    // sourceLocale "ko" with the clean default Korean source, so title_en /
    // description_es / title_ko here are all non-exempt AI-translated
    // fields being checked against a source that never mentions shorthand.
    const outcome = applyDealTranslationOutputGate(
      makeInput({
        sourceLocale: "ko",
        fields: {
          title_en: "BOGO coffee deal",
          description_es: "Oferta 2x1 en café hoy",
        },
      }),
    );
    expect(outcome.fields.title_en).toBe("");
    expect(outcome.fields.description_es).toBe("");
    expect(outcome.blankedFields).toEqual(
      expect.arrayContaining(["title_en", "description_es"]),
    );
  });

  it("blanks the Same-Item shorthand on a translated field when the source doesn't have it", () => {
    const outcome = applyDealTranslationOutputGate(
      makeInput({
        sourceLocale: "es",
        fields: { description_en: "Same-Item free with purchase" },
      }),
    );
    expect(outcome.fields.description_en).toBe("");
    expect(outcome.blankedFields).toContain("description_en");
  });

  it("blanks an over-length title on a translated field", () => {
    const overLongTitle = "A".repeat(DEAL_TRANSLATION_TITLE_MAX_LENGTH + 1);
    const outcome = applyDealTranslationOutputGate(
      makeInput({ fields: { title_es: overLongTitle } }),
    );
    expect(outcome.fields.title_es).toBe("");
    expect(outcome.blankedFields).toContain("title_es");
  });

  it("blanks an over-length description on a translated field", () => {
    // Valid Hangul filler (so the language check doesn't blank it first) run
    // past the description cap, to isolate the length check.
    const overLongDescription = "안녕하세요 ".repeat(90);
    expect(overLongDescription.length).toBeGreaterThan(DEAL_TRANSLATION_DESCRIPTION_MAX_LENGTH);
    const outcome = applyDealTranslationOutputGate(
      makeInput({ fields: { description_ko: overLongDescription } }),
    );
    expect(outcome.fields.description_ko).toBe("");
    expect(outcome.blankedFields).toContain("description_ko");
  });

  it("allows a translated title exactly at the max length", () => {
    // "é" carries the Spanish diacritic signal so only length is exercised.
    const exactTitle = "é".repeat(DEAL_TRANSLATION_TITLE_MAX_LENGTH);
    const outcome = applyDealTranslationOutputGate(
      makeInput({ fields: { title_es: exactTitle } }),
    );
    expect(outcome.fields.title_es).toBe(exactTitle);
    expect(outcome.blankedFields).not.toContain("title_es");
  });

  it("leaves already-empty fields alone and does not report them as blanked", () => {
    const outcome = applyDealTranslationOutputGate(
      makeInput({ fields: { title_ko: "", description_es: "" } }),
    );
    expect(outcome.fields.title_ko).toBe("");
    expect(outcome.fields.description_es).toBe("");
    expect(outcome.blankedFields).not.toContain("title_ko");
    expect(outcome.blankedFields).not.toContain("description_es");
  });

  describe("source-locale field exemption (merchant-authored text)", () => {
    it("never blanks the source-locale field for banned shorthand, and does not penalize a translation that faithfully carries the same shorthand", () => {
      const sourceTitle = "2x1 en tacos los martes";
      const outcome = applyDealTranslationOutputGate(
        makeInput({
          sourceLocale: "es",
          fields: {
            title_es: sourceTitle, // merchant's verbatim source text
            title_en: "2x1 tacos on Tuesdays", // faithful translation, shorthand carried over
            title_ko: "화요일 타코 2x1", // faithful translation, shorthand carried over
          },
        }),
      );
      expect(outcome.fields.title_es).toBe(sourceTitle);
      expect(outcome.fields.title_en).toBe("2x1 tacos on Tuesdays");
      expect(outcome.fields.title_ko).toBe("화요일 타코 2x1");
      expect(outcome.blankedFields).toEqual([]);
    });

    it("still blanks shorthand the AI introduced that is not present in the source text", () => {
      const outcome = applyDealTranslationOutputGate(
        makeInput({
          sourceLocale: "en",
          fields: {
            title_en: "Buy one coffee, get one free",
            title_es: "BOGO en café", // AI introduced shorthand with no basis in the English source
          },
        }),
      );
      expect(outcome.fields.title_es).toBe("");
      expect(outcome.blankedFields).toContain("title_es");
    });

    it("exempts a Korean source field containing 1+1 from the banned-shorthand check", () => {
      const sourceTitle = "1+1 커피 이벤트";
      const outcome = applyDealTranslationOutputGate(
        makeInput({
          sourceLocale: "ko",
          fields: { title_ko: sourceTitle },
        }),
      );
      expect(outcome.fields.title_ko).toBe(sourceTitle);
      expect(outcome.blankedFields).not.toContain("title_ko");
    });

    it("exempts an English source title containing BOGO from the banned-shorthand check", () => {
      const sourceTitle = "BOGO Tuesdays on all coffee";
      const outcome = applyDealTranslationOutputGate(
        makeInput({
          sourceLocale: "en",
          fields: { title_en: sourceTitle },
        }),
      );
      expect(outcome.fields.title_en).toBe(sourceTitle);
      expect(outcome.blankedFields).not.toContain("title_en");
    });

    it("exempts an over-length source-locale field from the length cap", () => {
      const longTitle = "A".repeat(200);
      const outcome = applyDealTranslationOutputGate(
        makeInput({
          sourceLocale: "en",
          fields: { title_en: longTitle },
        }),
      );
      expect(outcome.fields.title_en).toBe(longTitle);
      expect(outcome.blankedFields).not.toContain("title_en");
    });

    it("exempts the source-locale field from the language check even if it would otherwise fail", () => {
      // title_ko is the source field here (sourceLocale "ko") but contains no
      // Hangul at all -- still must not be touched; it is merchant text, not
      // an AI translation that failed to produce Korean.
      const weirdSourceTitle = "12% off";
      const outcome = applyDealTranslationOutputGate(
        makeInput({
          sourceLocale: "ko",
          fields: { title_ko: weirdSourceTitle },
        }),
      );
      expect(outcome.fields.title_ko).toBe(weirdSourceTitle);
      expect(outcome.blankedFields).not.toContain("title_ko");
    });
  });
});
