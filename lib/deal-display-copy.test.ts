import { describe, expect, it } from "vitest";
import { getDealDisplayTitle } from "./deal-display-copy";

describe("getDealDisplayTitle", () => {
  it("turns Same-Item BOGO titles into plain English", () => {
    expect(getDealDisplayTitle({ title: "Same-Item Iced Americano BOGO" })).toBe(
      "Buy one iced Americano, get one free",
    );
  });

  it("turns item BOGO titles into plain English", () => {
    expect(getDealDisplayTitle({ title: "Iced Americano BOGO" })).toBe(
      "Buy one iced Americano, get one free",
    );
  });

  it("keeps good plain-English titles while normalizing sentence case", () => {
    expect(getDealDisplayTitle({ title: "Buy one iced Americano, get one free" })).toBe(
      "Buy one iced Americano, get one free",
    );
    expect(getDealDisplayTitle({ title: "Buy a Latte, Get a Cookie Free" })).toBe(
      "Buy a latte, get a cookie free",
    );
  });

  it("normalizes simple same-item titles", () => {
    expect(getDealDisplayTitle({ title: "Same-Item Latte BOGO" })).toBe("Buy one latte, get one free");
  });

  it("includes material size or modifier restrictions from structured fields", () => {
    expect(
      getDealDisplayTitle({
        deal_type: "same_item_bogo",
        item_name: "Iced Americano",
        size: "medium",
      }),
    ).toBe("Buy one medium iced Americano, get one free");
  });

  it("uses the same-item fallback when the item is missing", () => {
    expect(getDealDisplayTitle({ title: "BOGO" })).toBe("Buy one item, get one free");
  });

  it("uses a safe fallback when the offer is unknown", () => {
    expect(getDealDisplayTitle({ title: "" })).toBe("Limited-time local offer");
  });
});
