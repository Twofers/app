import { describe, expect, it } from "vitest";
import {
  buildOfferAdHintText,
  buildOfferHintText,
  buildStructuredOffer,
  resolveMenuOfferLocationFlow,
  structuredOfferToEligibilityFormState,
} from "./menu-offer";
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
    expect(withPaired.human_summary).toMatch(/Buy one, get one/i);
    expect(withPaired.human_summary).toContain("Muffin");
    expect(withPaired.human_summary).toContain("Coffee");
    expect(
      validateMenuOfferCanonicalSummary({ human_summary: withPaired.human_summary }).ok,
    ).toBe(true);

    const solo = buildStructuredOffer({
      main: { name: "Muffin" },
      paired: null,
      pairing_type: "bogo_pair",
    });
    expect(solo.human_summary).toMatch(/Buy one, get one/i);
    expect(solo.human_summary).toContain("Muffin");
    expect(solo.paired_item).toBeNull();
    expect(validateMenuOfferCanonicalSummary({ human_summary: solo.human_summary }).ok).toBe(true);
  });

  it("second_half_off remains historical data but is not a valid strong menu offer", () => {
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
    ).toBe(false);

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

  it("builds eligibility prefill for percent and free-item menu offers", () => {
    const percent = structuredOfferToEligibilityFormState(
      buildStructuredOffer({
        main: { name: "Latte" },
        paired: null,
        pairing_type: "percent_off",
        discount_percent: 50,
      }),
    );
    expect(percent).toMatchObject({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      discountPercent: "50",
      itemDescription: "Latte",
    });

    const free = structuredOfferToEligibilityFormState(
      buildStructuredOffer({
        main: { name: "Coffee" },
        paired: { name: "Croissant" },
        pairing_type: "free_with_purchase",
      }),
    );
    expect(free).toMatchObject({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "Coffee",
      freeItemDescription: "Croissant",
    });
  });
});

describe("buildStructuredOffer descriptions", () => {
  it("carries item descriptions through onto the offer item refs", () => {
    const o = buildStructuredOffer({
      main: { name: "Recon Roast", description: " Roaster fresh coffee with a shot of espresso " },
      paired: { name: "Sargents Stripes", description: "select orgin estate grown coffee" },
      pairing_type: "free_with_purchase",
    });
    expect(o.main_item.description).toBe("Roaster fresh coffee with a shot of espresso");
    expect(o.paired_item?.description).toBe("select orgin estate grown coffee");
    // Names stay clean — descriptions never leak into them.
    expect(o.main_item.name).toBe("Recon Roast");
    expect(o.paired_item?.name).toBe("Sargents Stripes");
  });

  it("leaves description null when none is provided", () => {
    const o = buildStructuredOffer({
      main: { name: "Latte" },
      paired: null,
      pairing_type: "percent_off",
      discount_percent: 50,
    });
    expect(o.main_item.description).toBeNull();
  });
});

describe("buildOfferAdHintText", () => {
  it("appends item descriptions as flavor after the offer summary", () => {
    const o = buildStructuredOffer({
      main: { name: "Recon Roast", description: "Roaster fresh coffee with a shot of espresso" },
      paired: { name: "Sargents Stripes", description: "select orgin estate grown coffee" },
      pairing_type: "free_with_purchase",
    });
    const hint = buildOfferAdHintText(o);
    expect(hint.startsWith(o.human_summary)).toBe(true);
    expect(hint).toContain("Recon Roast: Roaster fresh coffee with a shot of espresso");
    expect(hint).toContain("Sargents Stripes: select orgin estate grown coffee");
  });

  it("returns the plain summary when no item has a description", () => {
    const o = buildStructuredOffer({
      main: { name: "Latte" },
      paired: { name: "Croissant" },
      pairing_type: "free_with_purchase",
    });
    expect(buildOfferAdHintText(o)).toBe(buildOfferHintText(o));
  });

  it("does not repeat a shared item's description twice (bogo same item)", () => {
    const o = buildStructuredOffer({
      main: { name: "Latte", description: "double shot oat milk latte" },
      paired: { name: "Latte", description: "double shot oat milk latte" },
      pairing_type: "bogo_pair",
    });
    const hint = buildOfferAdHintText(o);
    const occurrences = hint.split("double shot oat milk latte").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("resolveMenuOfferLocationFlow", () => {
  it("prompts for setup when no locations are available", () => {
    expect(resolveMenuOfferLocationFlow([])).toBe("setup");
  });

  it("skips the selector when exactly one location is available", () => {
    expect(resolveMenuOfferLocationFlow(["loc_1"])).toBe("skip");
  });

  it("shows the selector only when multiple visible locations are available", () => {
    expect(resolveMenuOfferLocationFlow(["loc_1", "loc_2"])).toBe("select");
  });
});
