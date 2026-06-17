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
        notes: "Coffee is too small.",
      },
      ["bagel", "coffee"],
    );

    expect(result.all_required_items_present).toBe(false);
    expect(result.missing_items).toEqual(["coffee"]);
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
  });
});
