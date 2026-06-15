import { describe, expect, it } from "vitest";
import { formatDistanceMiles, haversineKm } from "./geo";

describe("haversineKm", () => {
  it("is ~0 for same point", () => {
    expect(haversineKm(30.27, -97.74, 30.27, -97.74)).toBeLessThan(0.01);
  });

  it("approximates Austin to Dallas order of magnitude", () => {
    // Austin ~ 30.27, -97.74 ; Dallas ~ 32.78, -96.80
    const km = haversineKm(30.27, -97.74, 32.78, -96.8);
    expect(km).toBeGreaterThan(250);
    expect(km).toBeLessThan(350);
  });
});

describe("formatDistanceMiles", () => {
  it("formats positive miles to one decimal by default", () => {
    expect(formatDistanceMiles(6.94)).toBe("6.9");
  });

  it("never emits a negative distance", () => {
    expect(formatDistanceMiles(-6.94)).toBe("6.9");
  });

  it("returns null for invalid distances", () => {
    expect(formatDistanceMiles(Number.NaN)).toBeNull();
    expect(formatDistanceMiles(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
