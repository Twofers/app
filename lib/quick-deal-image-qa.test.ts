import { describe, expect, it } from "vitest";

import {
  buildAdImageQaPrompt,
  buildQuickDealImageQaPrompt,
  buildQuickDealImageRegenerationPrompt,
  normalizeSourceAwareImageQaResult,
  normalizeQuickDealImageQaResult,
  shouldFailClosedForImageQa,
  unavailableSourceAwareImageQaResult,
} from "./quick-deal-image-qa";

describe("quick deal image QA", () => {
  it("builds a QA prompt for every required visual item", () => {
    const prompt = buildQuickDealImageQaPrompt(["bagel", "coffee"]);

    expect(prompt).toMatch(/bagel/i);
    expect(prompt).toMatch(/coffee/i);
    expect(prompt).toMatch(/present/i);
    expect(prompt).toMatch(/prominent/i);
    expect(prompt).toMatch(/readable text/i);
    expect(prompt).toMatch(/QR codes/i);
    expect(prompt).toMatch(/mascots/i);
  });

  it("normalizes missing and non-prominent items as missing", () => {
    const result = normalizeQuickDealImageQaResult(
      {
        all_required_items_present: false,
        items: [
          { item: "bagel", present: true, prominent: true },
          { item: "coffee", present: true, prominent: false },
        ],
        missing_items: [],
        has_readable_text: false,
        has_forbidden_logo_or_brand: false,
        has_qr_code: false,
        has_unrelated_mascot_or_animal: false,
        forbidden_elements: [],
        notes: "Coffee is too small.",
      },
      ["bagel", "coffee"],
    );

    expect(result.all_required_items_present).toBe(false);
    expect(result.missing_items).toEqual(["coffee"]);
  });

  it("treats readable ad text and logos as QA failures", () => {
    const result = normalizeQuickDealImageQaResult(
      {
        all_required_items_present: true,
        items: [{ item: "iced latte", present: true, prominent: true }],
        missing_items: [],
        has_readable_text: true,
        has_forbidden_logo_or_brand: true,
        has_qr_code: false,
        has_unrelated_mascot_or_animal: false,
        forbidden_elements: ["50% off one iced latte", "Twofer"],
        notes: "Offer text is visible.",
      },
      ["iced latte"],
    );

    expect(result.all_required_items_present).toBe(false);
    expect(result.has_readable_text).toBe(true);
    expect(result.missing_items).toEqual([
      "readable text",
      "logo or brand text",
      "50% off one iced latte",
      "Twofer",
    ]);
  });

  it("treats unrelated mascots or animals as QA failures", () => {
    const result = normalizeQuickDealImageQaResult(
      {
        all_required_items_present: true,
        items: [{ item: "iced latte", present: true, prominent: true }],
        missing_items: [],
        has_readable_text: false,
        has_forbidden_logo_or_brand: false,
        has_qr_code: false,
        has_unrelated_mascot_or_animal: true,
        forbidden_elements: ["dancing penguin mascot"],
        notes: "A mascot is beside the latte.",
      },
      ["iced latte"],
    );

    expect(result.all_required_items_present).toBe(false);
    expect(result.has_unrelated_mascot_or_animal).toBe(true);
    expect(result.missing_items).toEqual(["unrelated mascot or animal", "dancing penguin mascot"]);
  });

  it("builds a stronger regeneration prompt around missing items", () => {
    const prompt = buildQuickDealImageRegenerationPrompt({
      basePrompt: "Natural morning light. No text.",
      requiredVisualItems: ["bagel", "coffee"],
      missingItems: ["coffee"],
    });

    expect(prompt).toMatch(/previous image missed: coffee/i);
    expect(prompt).toMatch(/bagel, coffee/i);
    expect(prompt).toMatch(/Natural morning light/i);
    expect(prompt).toMatch(/Remove all readable text/i);
    expect(prompt).toMatch(/mascots/i);
  });

  it("adds source-aware prompt guidance for merchant edits", () => {
    const prompt = buildAdImageQaPrompt({
      sourceType: "merchant_ai_edit",
      requiredVisualItems: ["latte"],
    });

    expect(prompt).toMatch(/AI-edited derivative/i);
    expect(prompt).toMatch(/preserve the required offer items/i);
    expect(prompt).toMatch(/latte/i);
  });

  it("adds source-aware prompt guidance for approved stock", () => {
    const prompt = buildAdImageQaPrompt({
      sourceType: "approved_stock",
      requiredVisualItems: ["latte"],
    });

    expect(prompt).toMatch(/approved stock media/i);
    expect(prompt).toMatch(/must still match the offer items/i);
    expect(prompt).toMatch(/latte/i);
  });

  it("treats missing prominence as a merchant-original warning", () => {
    const result = normalizeSourceAwareImageQaResult({
      raw: normalizeQuickDealImageQaResult(
        {
          all_required_items_present: false,
          items: [{ item: "coffee", present: true, prominent: false }],
          missing_items: [],
          has_readable_text: false,
          has_forbidden_logo_or_brand: false,
          has_qr_code: false,
          has_unrelated_mascot_or_animal: false,
          forbidden_elements: [],
          notes: "Coffee is small.",
        },
        ["coffee"],
      ),
      requiredVisualItems: ["coffee"],
      sourceType: "merchant_original",
    });

    expect(result.decision).toBe("warn");
    expect(result.merchantOverrideAllowed).toBe(true);
    expect(result.warningCodes).toEqual(["ITEM_NOT_PROMINENT:COFFEE"]);
    expect(shouldFailClosedForImageQa(result)).toBe(false);
  });

  it("blocks generated or edited images with missing required items", () => {
    const result = normalizeSourceAwareImageQaResult({
      raw: normalizeQuickDealImageQaResult(
        {
          all_required_items_present: false,
          items: [{ item: "coffee", present: false, prominent: false }],
          missing_items: ["coffee"],
          has_readable_text: false,
          has_forbidden_logo_or_brand: false,
          has_qr_code: false,
          has_unrelated_mascot_or_animal: false,
          forbidden_elements: [],
          notes: "Coffee is missing.",
        },
        ["coffee"],
      ),
      requiredVisualItems: ["coffee"],
      sourceType: "ai_generated",
    });

    expect(result.decision).toBe("block");
    expect(result.hardFailReasons).toEqual(["MISSING_REQUIRED_ITEM:COFFEE"]);
    expect(shouldFailClosedForImageQa(result)).toBe(true);
  });

  it("blocks approved stock images with missing required items", () => {
    const result = normalizeSourceAwareImageQaResult({
      raw: normalizeQuickDealImageQaResult(
        {
          all_required_items_present: false,
          items: [{ item: "latte", present: false, prominent: false }],
          missing_items: ["latte"],
          has_readable_text: false,
          has_forbidden_logo_or_brand: false,
          has_qr_code: false,
          has_unrelated_mascot_or_animal: false,
          forbidden_elements: [],
          notes: "Stock image shows a pastry, not a latte.",
        },
        ["latte"],
      ),
      requiredVisualItems: ["latte"],
      sourceType: "approved_stock",
    });

    expect(result.decision).toBe("block");
    expect(result.hardFailReasons).toEqual(["MISSING_REQUIRED_ITEM:LATTE"]);
    expect(shouldFailClosedForImageQa(result)).toBe(true);
  });

  it("fails closed on generated and stock QA outage but allows merchant-original acknowledgement", () => {
    const generated = unavailableSourceAwareImageQaResult({ sourceType: "ai_generated" });
    const stock = unavailableSourceAwareImageQaResult({ sourceType: "approved_stock" });
    const original = unavailableSourceAwareImageQaResult({
      sourceType: "merchant_original",
      merchantOverrideAcknowledged: true,
    });

    expect(generated.decision).toBe("block");
    expect(shouldFailClosedForImageQa(generated)).toBe(true);
    expect(stock.decision).toBe("block");
    expect(shouldFailClosedForImageQa(stock)).toBe(true);
    expect(original.decision).toBe("unavailable");
    expect(original.merchantOverrideAllowed).toBe(true);
    expect(original.merchantOverrideAcknowledged).toBe(true);
    expect(shouldFailClosedForImageQa(original)).toBe(false);
  });
});
