import { describe, expect, it } from "vitest";
import {
  buildDeterministicAdFallbackVisual,
  buildFallbackInitials,
} from "./deterministic-ad-fallback-visual";

describe("deterministic ad fallback visual", () => {
  it("uses business initials when available", () => {
    expect(buildFallbackInitials("Cedar & Bean Cafe")).toBe("CB");
    expect(buildFallbackInitials("Twofer")).toBe("TW");
  });

  it("uses a branded fallback mark when the business name is missing", () => {
    expect(buildFallbackInitials(null)).toBe("2F");
    expect(buildFallbackInitials("   ")).toBe("2F");
  });

  it("selects a stable palette from the business and offer seed", () => {
    const first = buildDeterministicAdFallbackVisual({
      businessName: "Cedar & Bean Cafe",
      offerLine: "Buy one latte, get one free",
      headline: "Bring a friend for coffee",
    });
    const second = buildDeterministicAdFallbackVisual({
      businessName: "Cedar & Bean Cafe",
      offerLine: "Buy one latte, get one free",
      headline: "Bring a friend for coffee",
    });

    expect(second).toEqual(first);
    expect(first.palette.background).toHaveLength(3);
  });
});
