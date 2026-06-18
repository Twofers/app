import { describe, expect, it } from "vitest";
import { getDealDisplayDescription, getDealDisplayTitle } from "./deal-display-copy";

describe("getDealDisplayTitle", () => {
  it("turns Same-Item BOGO titles into plain English", () => {
    expect(getDealDisplayTitle({ title: "Same-Item Iced Americano BOGO" })).toBe(
      "Buy one iced Americano and get one free",
    );
  });

  it("turns item BOGO titles into plain English", () => {
    expect(getDealDisplayTitle({ title: "Iced Americano BOGO" })).toBe(
      "Buy one iced Americano and get one free",
    );
  });

  it("keeps good plain-English titles while normalizing sentence case", () => {
    expect(getDealDisplayTitle({ title: "Buy one iced Americano, get one free" })).toBe(
      "Buy one iced Americano and get one free",
    );
    expect(getDealDisplayTitle({ title: "Buy a Latte, Get a Cookie Free" })).toBe(
      "Buy a latte and get a free cookie",
    );
  });

  it("normalizes simple same-item titles", () => {
    expect(getDealDisplayTitle({ title: "Same-Item Latte BOGO" })).toBe("Buy one latte and get one free");
  });

  it("includes material size or modifier restrictions from structured fields", () => {
    expect(
      getDealDisplayTitle({
        deal_type: "same_item_bogo",
        item_name: "Iced Americano",
        size: "medium",
      }),
    ).toBe("Buy one medium iced Americano and get one free");
  });

  it("formats different-item free offers from structured fields", () => {
    expect(
      getDealDisplayTitle({
        deal_type: "BUY_ONE_GET_SOMETHING_FREE",
        required_item_description: "Latte",
        free_item_description: "Cookie",
      }),
    ).toBe("Buy a latte and get a free cookie");
  });

  it("rewrites legacy with-free fragments without hard-coding items", () => {
    expect(getDealDisplayTitle({ title: "Egg sandwich with free coffee" })).toBe(
      "Buy an egg sandwich and get a free coffee",
    );
  });

  it("formats single-item discounts from structured fields", () => {
    expect(
      getDealDisplayTitle({
        deal_type: "PERCENT_OFF_SINGLE_ITEM",
        item_description: "Croissants",
        discount_percent: 40,
      }),
    ).toBe("40% off croissants");
  });

  it("uses structured fields over legacy mechanical titles", () => {
    expect(
      getDealDisplayTitle({
        title: "BOGO Coffee at Cedar & Bean Cafe",
        deal_type: "BUY_ONE_GET_ONE_FREE",
        item_description: "Iced Americano",
      }),
    ).toBe("Buy one iced Americano and get one free");
  });

  it("uses the same-item fallback when the item is missing", () => {
    expect(getDealDisplayTitle({ title: "BOGO" })).toBe("Buy one item and get one free");
  });

  it("uses a safe fallback when the offer is unknown", () => {
    expect(getDealDisplayTitle({ title: "" })).toBe("Limited-time local offer");
  });
});

describe("getDealDisplayDescription", () => {
  it("omits descriptions that repeat the display title after punctuation and case normalization", () => {
    const deal = { title: "Same-Item Iced Americano BOGO" };

    expect(getDealDisplayDescription(deal, "Buy one iced Americano and get one free.", deal.title)).toBe("");
  });

  it("keeps descriptions that add restrictions", () => {
    const deal = { title: "Same-Item Iced Americano BOGO" };

    expect(getDealDisplayDescription(deal, "Medium size only.", deal.title)).toBe("Medium size only.");
  });
});
