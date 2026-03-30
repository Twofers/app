import { describe, expect, it } from "vitest";
import { buildOfferHintText, buildStructuredOffer } from "./menu-offer";
import { validateMenuOfferCanonicalSummary } from "./strong-deal-guard";

describe("buildStructuredOffer", () => {
  it("free_with_purchase with paired item", () => {
    const o = buildStructuredOffer({
      main: { id: "a", name: "Latte" },
      paired: { id: "b", name: "Croissant" },
      pairing_type: "free_with_purchase",
    });
    expect(o.pairing_type).toBe("free_with_purchase");
    expect(o.human_summary).toContain("Latte");
    expect(o.human_summary).toContain("Croissant");
    expect(o.paired_item?.name).toBe("Croissant");
  });

  it("free_with_purchase without paired uses strong-deal phrasing as fallback", () => {
    const o = buildStructuredOffer({
      main: { id: "a", name: "Latte" },
      paired: null,
      pairing_type: "free_with_purchase",
    });
    expect(o.paired_item).toBeNull();
    expect(o.human_summary.toLowerCase()).toContain("free");
    expect(o.human_summary).toContain("Latte");
  });

  it("bogo_pair with and without paired", () => {
    const withPaired = buildStructuredOffer({
      main: { name: "Muffin" },
      paired: { name: "Coffee" },
      pairing_type: "bogo_pair",
    });
    expect(withPaired.human_summary).toMatch(/BOGO|2-for-1/i);
    expect(withPaired.human_summary).toContain("Muffin");
    expect(withPaired.human_summary).toContain("Coffee");

    const solo = buildStructuredOffer({
      main: { name: "Muffin" },
      paired: null,
      pairing_type: "bogo_pair",
    });
    expect(solo.human_summary).toMatch(/BOGO|2-for-1/i);
    expect(solo.human_summary).toContain("Muffin");
    expect(solo.paired_item).toBeNull();
  });

  it("second_half_off with and without paired", () => {
    const withPaired = buildStructuredOffer({
      main: { name: "Bagel" },
      paired: { name: "Schmear" },
      pairing_type: "second_half_off",
    });
    expect(withPaired.human_summary.toLowerCase()).toContain("half");
    expect(withPaired.human_summary).toContain("Bagel");
    expect(withPaired.human_summary).toContain("Schmear");
    expect(
      validateMenuOfferCanonicalSummary({ human_summary: withPaired.human_summary }).ok,
    ).toBe(true);

    const solo = buildStructuredOffer({
      main: { name: "Bagel" },
      paired: null,
      pairing_type: "second_half_off",
    });
    expect(solo.human_summary).toContain("50%");
    expect(solo.human_summary.toLowerCase()).toContain("second");
    expect(solo.human_summary).toContain("Bagel");
  });

  it("percent_off uses discount in summary", () => {
    const o = buildStructuredOffer({
      main: { name: "Latte" },
      paired: null,
      pairing_type: "percent_off",
      discount_percent: 50,
    });
    expect(o.human_summary).toContain("50%");
    expect(o.human_summary).toContain("Latte");
  });

  it("trims names", () => {
    const o = buildStructuredOffer({
      main: { name: "  Latte  " },
      paired: { name: "  Cookie " },
      pairing_type: "free_with_purchase",
    });
    expect(o.main_item.name).toBe("Latte");
    expect(o.paired_item?.name).toBe("Cookie");
  });
});

describe("buildOfferHintText", () => {
  it("returns trimmed human_summary when set", () => {
    const o = buildStructuredOffer({
      main: { name: "X" },
      paired: null,
      pairing_type: "free_with_purchase",
    });
    expect(buildOfferHintText(o)).toBe(o.human_summary);
  });

  it("falls back to main item name when human_summary empty", () => {
    const hint = buildOfferHintText({
      main_item: { name: "Espresso" },
      pairing_type: "free_with_purchase",
      human_summary: "   ",
    });
    expect(hint).toBe("Espresso");
  });
});
