import { describe, expect, it } from "vitest";

import { offerLineDuplicatesHeadline } from "./ad-render-content";

// Regression for the consumer feed rendering the same sentence twice: the deal card
// printed "Buy one house iced tea and get one free" as both the headline and the
// locked offer line, because a deal with no distinct AI creative headline uses the
// locked offer line as its display title.
describe("offerLineDuplicatesHeadline", () => {
  it("detects an exact duplicate", () => {
    expect(
      offerLineDuplicatesHeadline("Buy one house iced tea and get one free", "Buy one house iced tea and get one free"),
    ).toBe(true);
  });

  it("ignores case, trailing punctuation and whitespace runs", () => {
    expect(offerLineDuplicatesHeadline("Buy one latte and get one free.", "buy one  latte and get one free")).toBe(true);
    expect(offerLineDuplicatesHeadline("Buy one latte and get one free!", "Buy one latte and get one free")).toBe(true);
  });

  it("keeps a genuinely different offer line", () => {
    expect(
      offerLineDuplicatesHeadline("Buy one latte and get one free", "Bring a friend for coffee today"),
    ).toBe(false);
  });

  it("does not treat a blank offer line as a duplicate", () => {
    expect(offerLineDuplicatesHeadline("", "Buy one latte and get one free")).toBe(false);
    expect(offerLineDuplicatesHeadline("   ", "Buy one latte and get one free")).toBe(false);
    expect(offerLineDuplicatesHeadline(null, null)).toBe(false);
    expect(offerLineDuplicatesHeadline(undefined, undefined)).toBe(false);
  });

  it("does not suppress an offer line when the headline is missing", () => {
    expect(offerLineDuplicatesHeadline("Buy one latte and get one free", "")).toBe(false);
  });
});
