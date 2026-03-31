import { describe, expect, it } from "vitest";

import { collectMappableBusinesses, deriveLiveBusinessIds, isValidCoordinate } from "./map-businesses";

describe("isValidCoordinate", () => {
  it("accepts in-range coordinates", () => {
    expect(isValidCoordinate(32.77, -96.79)).toBe(true);
  });

  it("rejects out-of-range coordinates", () => {
    expect(isValidCoordinate(120, -96.79)).toBe(false);
    expect(isValidCoordinate(32.77, -300)).toBe(false);
  });
});

describe("collectMappableBusinesses", () => {
  it("collects all pages, dedupes by id, and keeps only valid coordinates", async () => {
    const pages = [
      [
        { id: "a", name: "A", latitude: 32.7, longitude: -96.8 },
        { id: "b", name: "B", latitude: null, longitude: -96.8 },
      ],
      [
        { id: "a", name: "A-duplicate", latitude: 32.72, longitude: -96.82 },
        { id: "c", name: "C", latitude: "32.75", longitude: "-96.81" },
      ],
      [],
    ];
    let calls = 0;
    const out = await collectMappableBusinesses(async () => {
      const page = pages[calls] ?? [];
      calls += 1;
      return page;
    }, 2);

    expect(calls).toBe(3);
    expect(out.map((b) => b.id)).toEqual(["a", "c"]);
    expect(out[0]?.name).toBe("A");
  });
});

describe("deriveLiveBusinessIds", () => {
  it("returns unique business IDs for live deals only", () => {
    const ids = deriveLiveBusinessIds([
      { business_id: "a", live: true },
      { business_id: "a", live: true },
      { business_id: "b", live: false },
      { business_id: "c", live: true },
    ]);
    expect(Array.from(ids)).toEqual(["a", "c"]);
  });
});
