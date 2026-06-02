import { describe, expect, it } from "vitest";
import { computeDigestCounts, type DigestConsumer, type DigestDeal } from "./digest-targeting";

// DFW-ish reference point and helpers.
const HOME = { lat: 32.97, lng: -96.9 };
const NEAR = { lat: 32.98, lng: -96.9 }; // ~0.7 mi from HOME
const FAR = { lat: 33.97, lng: -96.9 }; // ~69 mi from HOME

function consumer(overrides: Partial<DigestConsumer>): DigestConsumer {
  return {
    user_id: "u",
    deal_alerts_enabled: true,
    notification_mode: "all_nearby",
    lat: HOME.lat,
    lng: HOME.lng,
    radius_miles: 5,
    favorite_business_ids: [],
    ...overrides,
  };
}

const nearDeal: DigestDeal = { business_id: "b-near", lat: NEAR.lat, lng: NEAR.lng };
const farDeal: DigestDeal = { business_id: "b-far", lat: FAR.lat, lng: FAR.lng };

describe("computeDigestCounts — opt-in gate", () => {
  it("excludes users with deal_alerts_enabled = false even if a deal is on top of them", () => {
    const res = computeDigestCounts([nearDeal], [consumer({ user_id: "off", deal_alerts_enabled: false })]);
    expect(res.has("off")).toBe(false);
  });

  it("excludes notification_mode = 'none'", () => {
    const res = computeDigestCounts([nearDeal], [consumer({ user_id: "none", notification_mode: "none" })]);
    expect(res.has("none")).toBe(false);
  });

  it("includes an opted-in user with a nearby deal", () => {
    const res = computeDigestCounts([nearDeal], [consumer({ user_id: "on" })]);
    expect(res.get("on")).toBe(1);
  });
});

describe("computeDigestCounts — radius / location", () => {
  it("counts deals within radius and not beyond it", () => {
    const res = computeDigestCounts([nearDeal, farDeal], [consumer({ user_id: "u", radius_miles: 5 })]);
    expect(res.get("u")).toBe(1); // only the near deal
  });

  it("counts the far deal once radius is widened", () => {
    const res = computeDigestCounts([nearDeal, farDeal], [consumer({ user_id: "u", radius_miles: 100 })]);
    expect(res.get("u")).toBe(2);
  });

  it("all_nearby with no stored location counts nothing (no favorites)", () => {
    const res = computeDigestCounts([nearDeal], [consumer({ user_id: "u", lat: null, lng: null })]);
    expect(res.has("u")).toBe(false);
  });

  it("falls back to a 15mi default when radius is missing/invalid", () => {
    // far deal (~69mi) excluded; near deal included under the 15mi default
    const res = computeDigestCounts([nearDeal, farDeal], [consumer({ user_id: "u", radius_miles: null })]);
    expect(res.get("u")).toBe(1);
  });
});

describe("computeDigestCounts — favorites", () => {
  it("favorites_only counts only favorited shops, ignoring nearby non-favorites", () => {
    const res = computeDigestCounts(
      [nearDeal, farDeal],
      [consumer({ user_id: "u", notification_mode: "favorites_only", favorite_business_ids: ["b-far"] })],
    );
    expect(res.get("u")).toBe(1); // the favorited far deal, despite distance
  });

  it("all_nearby includes a favorited shop's deal even when far outside radius (override)", () => {
    const res = computeDigestCounts(
      [farDeal],
      [consumer({ user_id: "u", radius_miles: 5, favorite_business_ids: ["b-far"] })],
    );
    expect(res.get("u")).toBe(1);
  });

  it("favorites_only with no favorites counts nothing", () => {
    const res = computeDigestCounts(
      [nearDeal],
      [consumer({ user_id: "u", notification_mode: "favorites_only", favorite_business_ids: [] })],
    );
    expect(res.has("u")).toBe(false);
  });
});

describe("computeDigestCounts — robustness", () => {
  it("ignores deals with missing coordinates without throwing", () => {
    const bad: DigestDeal = { business_id: "b-bad", lat: null, lng: null };
    expect(() => computeDigestCounts([bad, nearDeal], [consumer({ user_id: "u" })])).not.toThrow();
    const res = computeDigestCounts([bad, nearDeal], [consumer({ user_id: "u" })]);
    expect(res.get("u")).toBe(1);
  });

  it("returns an empty map for no deals or no consumers", () => {
    expect(computeDigestCounts([], [consumer({})]).size).toBe(0);
    expect(computeDigestCounts([nearDeal], []).size).toBe(0);
  });

  it("only returns users with count > 0", () => {
    const res = computeDigestCounts(
      [farDeal],
      [consumer({ user_id: "u", radius_miles: 5 })], // far deal, no favorites → 0
    );
    expect(res.has("u")).toBe(false);
  });
});
