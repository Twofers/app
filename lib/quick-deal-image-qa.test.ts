import { describe, expect, it } from "vitest";

import {
  buildQuickDealImageQaPrompt,
  buildQuickDealImageRegenerationPrompt,
  normalizeQuickDealImageQaResult,
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
  });
});
