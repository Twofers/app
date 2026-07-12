import { describe, expect, it } from "vitest";

import { parseRepeatVisitStats } from "./merchant-insights";

describe("parseRepeatVisitStats", () => {
  it("parses a jsonb object from the RPC", () => {
    expect(
      parseRepeatVisitStats({
        redeemed_customers: 12,
        repeat_customers: 4,
        total_redemptions: 20,
        repeat_redemptions: 12,
      }),
    ).toEqual({
      redeemed_customers: 12,
      repeat_customers: 4,
      total_redemptions: 20,
      repeat_redemptions: 12,
    });
  });

  it("parses a JSON string payload", () => {
    expect(
      parseRepeatVisitStats('{"redeemed_customers":3,"repeat_customers":1,"total_redemptions":4,"repeat_redemptions":2}'),
    ).toEqual({
      redeemed_customers: 3,
      repeat_customers: 1,
      total_redemptions: 4,
      repeat_redemptions: 2,
    });
  });

  it("returns null for invalid payloads and zeroes missing fields", () => {
    expect(parseRepeatVisitStats(null)).toBeNull();
    expect(parseRepeatVisitStats("not json")).toBeNull();
    expect(parseRepeatVisitStats(42)).toBeNull();
    expect(parseRepeatVisitStats({})).toEqual({
      redeemed_customers: 0,
      repeat_customers: 0,
      total_redemptions: 0,
      repeat_redemptions: 0,
    });
  });
});
