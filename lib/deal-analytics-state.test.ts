import { describe, expect, it } from "vitest";
import { getDealAnalyticsActivityState } from "./deal-analytics-state";

describe("deal analytics activity state", () => {
  it("marks a deal with no claims as empty and not exportable", () => {
    expect(getDealAnalyticsActivityState([])).toEqual({
      claimCount: 0,
      redemptionCount: 0,
      hasTimelineData: false,
      canExport: false,
    });
  });

  it("allows timeline and export once claims exist", () => {
    expect(getDealAnalyticsActivityState([{ redeemed_at: null }])).toEqual({
      claimCount: 1,
      redemptionCount: 0,
      hasTimelineData: true,
      canExport: true,
    });
  });

  it("counts redeemed claims", () => {
    expect(getDealAnalyticsActivityState([{ redeemed_at: "2026-06-15T12:00:00Z" }, { redeemed_at: null }])).toEqual({
      claimCount: 2,
      redemptionCount: 1,
      hasTimelineData: true,
      canExport: true,
    });
  });
});
