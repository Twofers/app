import { describe, expect, it } from "vitest";

import {
  mergeDealsById,
  readBusinessCoordinates,
  shouldShowDealInNearbyFeed,
} from "./consumer-feed-visibility";

const userGeo = { lat: 32.7767, lng: -96.797 };

function deal(
  id: string,
  business_id: string,
  latitude: number | string | null,
  longitude: number | string | null,
) {
  return {
    id,
    business_id,
    businesses: { latitude, longitude },
  };
}

describe("consumer feed visibility", () => {
  it("reads valid business coordinates", () => {
    expect(readBusinessCoordinates({ latitude: "32.78", longitude: "-96.8" })).toEqual({
      lat: 32.78,
      lng: -96.8,
    });
  });

  it("treats invalid or missing coordinates as unknown", () => {
    expect(readBusinessCoordinates({ latitude: null, longitude: -96.8 })).toBeNull();
    expect(readBusinessCoordinates({ latitude: 120, longitude: -96.8 })).toBeNull();
  });

  it("keeps coordinate-less live deals discoverable", () => {
    expect(
      shouldShowDealInNearbyFeed({
        deal: deal("d1", "b1", null, null),
        userGeo,
        radiusMiles: 15,
        favoriteBusinessIds: [],
      }),
    ).toBe(true);
  });

  it("excludes located non-favorite deals outside the user radius", () => {
    expect(
      shouldShowDealInNearbyFeed({
        deal: deal("d1", "b1", 40.7128, -74.006),
        userGeo,
        radiusMiles: 15,
        favoriteBusinessIds: [],
      }),
    ).toBe(false);
  });

  it("includes favorite deals outside the user radius", () => {
    expect(
      shouldShowDealInNearbyFeed({
        deal: deal("d1", "b1", 40.7128, -74.006),
        userGeo,
        radiusMiles: 15,
        favoriteBusinessIds: ["b1"],
      }),
    ).toBe(true);
  });

  it("merges hydrated deal rows without duplicating ids", () => {
    expect(
      mergeDealsById(
        [{ id: "near", title: "Nearby" }],
        [
          { id: "near", title: "Duplicate" },
          { id: "unlocated", title: "No coordinates" },
        ],
      ),
    ).toEqual([
      { id: "near", title: "Nearby" },
      { id: "unlocated", title: "No coordinates" },
    ]);
  });
});
