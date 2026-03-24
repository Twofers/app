import { describe, expect, it } from "vitest";
import {
  collectGeocodeHints,
  dealMatchesNearHints,
  dealMatchesSearch,
  normalizeSearch,
} from "./deals-discovery-filters";

describe("normalizeSearch", () => {
  it("trims and lowercases", () => {
    expect(normalizeSearch("  Latte  ")).toBe("latte");
  });
});

describe("dealMatchesSearch", () => {
  const deal = {
    title: "2-for-1 Latte",
    description: "Morning special",
    businesses: { name: "Demo Cafe", category: "Coffee shop", location: "Austin TX" },
  };

  it("matches title substring", () => {
    expect(dealMatchesSearch(deal, "latte")).toBe(true);
  });

  it("matches business location", () => {
    expect(dealMatchesSearch(deal, "austin")).toBe(true);
  });

  it("empty query passes all", () => {
    expect(dealMatchesSearch(deal, "")).toBe(true);
    expect(dealMatchesSearch(deal, "   ")).toBe(true);
  });

  it("no match", () => {
    expect(dealMatchesSearch(deal, "pizza")).toBe(false);
  });
});

describe("collectGeocodeHints", () => {
  it("dedupes and lowercases", () => {
    const hints = collectGeocodeHints([
      { city: "Austin", region: "TX" },
      { city: "Austin", subregion: "Travis" },
    ]);
    expect(hints).toContain("austin");
    expect(hints).toContain("tx");
    expect(hints).toContain("travis");
  });

  it("drops very short tokens", () => {
    expect(collectGeocodeHints([{ city: "A" }])).toEqual([]);
  });
});

describe("dealMatchesNearHints", () => {
  const deal = {
    title: "Deal",
    description: null,
    businesses: { name: "Joe's", category: null, location: "Downtown Austin" },
  };

  it("matches location substring", () => {
    expect(dealMatchesNearHints(deal, ["austin"])).toBe(true);
  });

  it("matches business name substring", () => {
    expect(dealMatchesNearHints(deal, ["joe"])).toBe(true);
  });

  it("empty hints = no filter", () => {
    expect(dealMatchesNearHints(deal, [])).toBe(true);
  });
});
