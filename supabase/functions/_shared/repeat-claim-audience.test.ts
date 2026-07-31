import { describe, expect, it } from "vitest";
import {
  repeatBlockKey,
  selectRepeatBlockedPairs,
  type RepeatPolicyByBusiness,
  type RedemptionRow,
} from "./repeat-claim-audience.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-25T12:00:00.000Z");

function policies(
  entries: [string, "NONE" | "FOREVER" | "COOLDOWN_DAYS", number | null][],
): RepeatPolicyByBusiness {
  return new Map(entries.map(([id, policyType, cooldownDays]) => [id, { policyType, cooldownDays }]));
}

function redemption(userId: string, businessId: string, daysAgo: number): RedemptionRow {
  return {
    user_id: userId,
    business_id: businessId,
    redeemed_at: new Date(NOW - daysAgo * DAY_MS).toISOString(),
  };
}

describe("selectRepeatBlockedPairs", () => {
  it("blocks a prior customer at a FOREVER business", () => {
    const blocked = selectRepeatBlockedPairs({
      policiesByBusinessId: policies([["biz1", "FOREVER", null]]),
      redemptions: [redemption("userA", "biz1", 400)],
      nowMs: NOW,
    });
    expect(blocked.has(repeatBlockKey("userA", "biz1"))).toBe(true);
  });

  it("blocks inside a cooldown and releases after it", () => {
    const inside = selectRepeatBlockedPairs({
      policiesByBusinessId: policies([["biz1", "COOLDOWN_DAYS", 30]]),
      redemptions: [redemption("userA", "biz1", 10)],
      nowMs: NOW,
    });
    expect(inside.has(repeatBlockKey("userA", "biz1"))).toBe(true);

    const outside = selectRepeatBlockedPairs({
      policiesByBusinessId: policies([["biz1", "COOLDOWN_DAYS", 30]]),
      redemptions: [redemption("userA", "biz1", 31)],
      nowMs: NOW,
    });
    expect(outside.size).toBe(0);
  });

  it("never blocks at an unrestricted business", () => {
    const blocked = selectRepeatBlockedPairs({
      policiesByBusinessId: policies([["biz1", "NONE", null]]),
      redemptions: [redemption("userA", "biz1", 1)],
      nowMs: NOW,
    });
    expect(blocked.size).toBe(0);
  });

  it("ignores redemptions at businesses outside the policy map", () => {
    const blocked = selectRepeatBlockedPairs({
      policiesByBusinessId: policies([["biz1", "FOREVER", null]]),
      redemptions: [redemption("userA", "bizOther", 1)],
      nowMs: NOW,
    });
    expect(blocked.size).toBe(0);
  });

  it("uses only the newest redemption per pair", () => {
    // Rows arrive newest-first. An older redemption inside the cooldown must not
    // resurrect a block that the newest (post-cooldown) redemption cleared.
    const blocked = selectRepeatBlockedPairs({
      policiesByBusinessId: policies([["biz1", "COOLDOWN_DAYS", 7]]),
      redemptions: [redemption("userA", "biz1", 30), redemption("userA", "biz1", 1)],
      nowMs: NOW,
    });
    expect(blocked.size).toBe(0);
  });

  it("keeps customers and businesses independent", () => {
    const blocked = selectRepeatBlockedPairs({
      policiesByBusinessId: policies([
        ["biz1", "FOREVER", null],
        ["biz2", "FOREVER", null],
      ]),
      redemptions: [redemption("userA", "biz1", 5), redemption("userB", "biz2", 5)],
      nowMs: NOW,
    });
    expect(blocked.has(repeatBlockKey("userA", "biz1"))).toBe(true);
    expect(blocked.has(repeatBlockKey("userA", "biz2"))).toBe(false);
    expect(blocked.has(repeatBlockKey("userB", "biz2"))).toBe(true);
    expect(blocked.has(repeatBlockKey("userB", "biz1"))).toBe(false);
  });

  it("treats a zero/absent cooldown as unrestricted rather than forever", () => {
    const blocked = selectRepeatBlockedPairs({
      policiesByBusinessId: policies([["biz1", "COOLDOWN_DAYS", null]]),
      redemptions: [redemption("userA", "biz1", 0)],
      nowMs: NOW,
    });
    expect(blocked.size).toBe(0);
  });

  it("skips malformed rows without throwing", () => {
    const blocked = selectRepeatBlockedPairs({
      policiesByBusinessId: policies([["biz1", "FOREVER", null]]),
      redemptions: [
        { user_id: "", business_id: "biz1", redeemed_at: "2026-01-01T00:00:00Z" },
        { user_id: "userA", business_id: "", redeemed_at: "2026-01-01T00:00:00Z" },
        { user_id: "userA", business_id: "biz1", redeemed_at: "" },
      ] as RedemptionRow[],
      nowMs: NOW,
    });
    expect(blocked.size).toBe(0);
  });

  it("returns nothing when there are no redemptions at all", () => {
    const blocked = selectRepeatBlockedPairs({
      policiesByBusinessId: policies([["biz1", "FOREVER", null]]),
      redemptions: [],
      nowMs: NOW,
    });
    expect(blocked.size).toBe(0);
  });
});
