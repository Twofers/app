import { describe, expect, it } from "vitest";
import {
  DETERMINISTIC_FALLBACK_RECOMMENDATION_REASON,
  buildDeterministicComposeFallback,
  parseDeterministicOfferHint,
  type DeterministicFallbackMenuItem,
} from "./deterministic-fallback.ts";

const OFFER_TYPES = [
  "bogo_same_item",
  "bogo_second_item_half_off",
  "free_add_on_with_purchase",
  "simple_bundle_offer",
] as const;

describe("parseDeterministicOfferHint", () => {
  it("detects a bogo hint and resolves the item from the remaining text", () => {
    const result = parseDeterministicOfferHint("bogo latte");
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("buy_one_get_one_free");
    expect(result?.itemName).toBe("latte");
    expect(result?.menuMatched).toBe(false);
  });

  it("recognizes the other bogo-shorthand keywords too (2 for 1, two for one, b1g1)", () => {
    expect(parseDeterministicOfferHint("2 for 1 tacos")?.kind).toBe("buy_one_get_one_free");
    expect(parseDeterministicOfferHint("two for one tacos")?.kind).toBe("buy_one_get_one_free");
    expect(parseDeterministicOfferHint("b1g1 tacos")?.kind).toBe("buy_one_get_one_free");
    expect(parseDeterministicOfferHint("buy one get one taco")?.kind).toBe("buy_one_get_one_free");
  });

  it("parses 'free X with Y' into a free-item-with-purchase offer with both items extracted", () => {
    const result = parseDeterministicOfferHint("free cookie with any latte");
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("free_item_with_purchase");
    expect(result?.itemName).toBe("latte");
    expect(result?.rewardItemName).toBe("cookie");
  });

  it("also parses the 'Y comes with a free X' phrasing", () => {
    const result = parseDeterministicOfferHint("any latte comes with a free cookie");
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("free_item_with_purchase");
    expect(result?.itemName).toBe("latte");
    expect(result?.rewardItemName).toBe("cookie");
  });

  it("parses '50% off latte' into a percent_off_item offer with percent 50", () => {
    const result = parseDeterministicOfferHint("50% off latte");
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("percent_off_item");
    expect(result?.percent).toBe(50);
    expect(result?.itemName).toBe("latte");
  });

  it("never falls back for a sub-40% discount — that is a real but weak deal", () => {
    expect(parseDeterministicOfferHint("25% off")).toBeNull();
    expect(parseDeterministicOfferHint("25% off latte")).toBeNull();
  });

  it("rejects a nonsensical over-100% figure rather than guessing", () => {
    expect(parseDeterministicOfferHint("150% off latte")).toBeNull();
  });

  it("returns null for gibberish with no recognizable offer keyword", () => {
    expect(parseDeterministicOfferHint("zzz qqq xyz asdkjf")).toBeNull();
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(parseDeterministicOfferHint("")).toBeNull();
    expect(parseDeterministicOfferHint("   ")).toBeNull();
  });

  it("gives up (null) when an offer keyword matches but no item can be resolved", () => {
    expect(parseDeterministicOfferHint("bogo")).toBeNull();
  });

  it("picks the real menu item name via word-overlap fuzzy match instead of the bare hint word", () => {
    const menuItems: DeterministicFallbackMenuItem[] = [
      { name: "Blueberry Muffin" },
      { name: "Plain Bagel" },
      { name: "Iced Latte" },
    ];
    const result = parseDeterministicOfferHint("bogo muffin please", menuItems);
    expect(result).not.toBeNull();
    expect(result?.itemName).toBe("Blueberry Muffin");
    expect(result?.menuMatched).toBe(true);
  });

  it("carries the matched menu item's real price_text but never invents one", () => {
    const menuItems: DeterministicFallbackMenuItem[] = [{ name: "Latte", price_text: "$4.50" }];
    const withPrice = parseDeterministicOfferHint("bogo latte", menuItems);
    expect(withPrice?.priceText).toBe("$4.50");

    const withoutMenu = parseDeterministicOfferHint("bogo latte");
    expect(withoutMenu?.priceText).toBeNull();
  });

  it("skips menu matching cleanly when no menu items are supplied (AI_COMPOSE_V2_GATES_ENABLED off)", () => {
    const result = parseDeterministicOfferHint("bogo latte", []);
    expect(result?.itemName).toBe("latte");
    expect(result?.menuMatched).toBe(false);
  });
});

describe("buildDeterministicComposeFallback", () => {
  it("builds a valid bogo fallback that passes validateComposeOutput", () => {
    const built = buildDeterministicComposeFallback({ hintText: "bogo latte", offerTypes: OFFER_TYPES });
    expect(built).not.toBeNull();
    expect(built?.recommended_offer.offer_type).toBe("bogo_same_item");
    expect(built?.recommended_offer.item_name).toBe("Latte");
    expect(built?.ad_variants).toHaveLength(2);
    expect(built?.low_confidence).toBe(true);
    expect(built?.recommendation_reason).toBe(DETERMINISTIC_FALLBACK_RECOMMENDATION_REASON);
    // Never claim the offer as BOGO/same-item to the customer, exactly like live AI output.
    expect(built?.recommended_offer.display_offer).not.toMatch(/bogo/i);
    for (const variant of built?.ad_variants ?? []) {
      expect(String((variant as Record<string, unknown>).headline_en)).not.toMatch(/!/);
    }
  });

  it("builds a valid free-item fallback that passes validateComposeOutput", () => {
    const built = buildDeterministicComposeFallback({
      hintText: "free cookie with any latte",
      offerTypes: OFFER_TYPES,
    });
    expect(built).not.toBeNull();
    expect(built?.recommended_offer.offer_type).toBe("free_add_on_with_purchase");
    expect(built?.detected_items).toEqual(["Latte", "Cookie"]);
  });

  it("builds a valid percent-off fallback that passes validateComposeOutput", () => {
    const built = buildDeterministicComposeFallback({ hintText: "50% off latte", offerTypes: OFFER_TYPES });
    expect(built).not.toBeNull();
    expect(built?.recommended_offer.item_name).toBe("Latte");
    expect(built?.recommended_offer.display_offer).toMatch(/50%/);
  });

  it("returns null (never a weak/ambiguous deal) when the hint parses to nothing", () => {
    expect(buildDeterministicComposeFallback({ hintText: "25% off", offerTypes: OFFER_TYPES })).toBeNull();
    expect(buildDeterministicComposeFallback({ hintText: "zzz qqq xyz", offerTypes: OFFER_TYPES })).toBeNull();
  });

  it("returns null when the constructed output fails validateComposeOutput, even though the hint parsed", () => {
    // "bogo" matches the offer-type keyword (stripped from the remainder for detection), but a
    // second, incidental "bogo" survives inside the item name itself ("bogo branded scarf") once
    // the matched "two for one" phrase is removed. The built display_offer/headline then contain
    // that banned term, so validateComposeOutput must reject it — proving the fallback cannot
    // bypass the same safety gate live AI output has to pass.
    const parsed = parseDeterministicOfferHint("two for one bogo-branded scarf");
    expect(parsed).not.toBeNull();
    expect(parsed?.itemName).toMatch(/bogo/i);

    const built = buildDeterministicComposeFallback({
      hintText: "two for one bogo-branded scarf",
      offerTypes: OFFER_TYPES,
    });
    expect(built).toBeNull();
  });

  it("maps percent_off_item onto simple_bundle_offer, the closest allowed offer_type", () => {
    const built = buildDeterministicComposeFallback({ hintText: "40% off latte", offerTypes: OFFER_TYPES });
    expect(built?.recommended_offer.offer_type).toBe("simple_bundle_offer");
  });

  it("returns null outright when nothing in the hint describes an allowed deal", () => {
    expect(buildDeterministicComposeFallback({ hintText: "", offerTypes: OFFER_TYPES })).toBeNull();
  });
});
