import { describe, expect, it } from "vitest";

import {
  collectMappableBusinesses,
  deriveLiveBusinessIds,
  isValidCoordinate,
  resolveMarkerTapOutcome,
  pickPreviewDeal,
  resolveMapTapHref,
  shouldClearMapSelectionOnPress,
} from "./map-businesses";

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

describe("pickPreviewDeal", () => {
  it("prioritizes a live deal when one exists", () => {
    const picked = pickPreviewDeal(
      [
        { id: "soon", business_id: "a", end_time: "2026-06-01T12:00:00.000Z" },
        { id: "live", business_id: "a", end_time: "2026-06-01T13:00:00.000Z" },
      ],
      "a",
      (deal) => deal.id === "live",
    );
    expect(picked?.id).toBe("live");
  });

  it("falls back to earliest end_time when no live deal exists", () => {
    const picked = pickPreviewDeal(
      [
        { id: "late", business_id: "a", end_time: "2026-06-01T14:00:00.000Z" },
        { id: "early", business_id: "a", end_time: "2026-06-01T11:00:00.000Z" },
      ],
      "a",
      () => false,
    );
    expect(picked?.id).toBe("early");
  });
});

describe("resolveMapTapHref", () => {
  it("routes to deal detail when a live deal is present", () => {
    expect(resolveMapTapHref({ businessId: "biz-1", liveDealId: "deal-9" })).toBe("/deal/deal-9");
  });

  it("routes to business profile when no live deal exists", () => {
    expect(resolveMapTapHref({ businessId: "biz-1", liveDealId: null })).toBe("/business/biz-1");
  });
});

describe("resolveMarkerTapOutcome", () => {
  it("first tap selects marker for preview only", () => {
    const out = resolveMarkerTapOutcome({
      tappedBusinessId: "biz-1",
      selectedBusinessId: null,
      liveDealId: "deal-1",
    });
    expect(out.nextSelectedBusinessId).toBe("biz-1");
    expect(out.href).toBeNull();
  });

  it("second tap on same marker opens destination", () => {
    const out = resolveMarkerTapOutcome({
      tappedBusinessId: "biz-1",
      selectedBusinessId: "biz-1",
      liveDealId: "deal-1",
    });
    expect(out.nextSelectedBusinessId).toBe("biz-1");
    expect(out.href).toBe("/deal/deal-1");
  });
});

describe("shouldClearMapSelectionOnPress", () => {
  it("keeps selection on marker tap actions", () => {
    expect(shouldClearMapSelectionOnPress("marker-press")).toBe(false);
    expect(shouldClearMapSelectionOnPress("marker-click")).toBe(false);
  });

  it("clears selection for normal map taps or missing actions", () => {
    expect(shouldClearMapSelectionOnPress(undefined)).toBe(true);
    expect(shouldClearMapSelectionOnPress("press")).toBe(true);
  });
});
