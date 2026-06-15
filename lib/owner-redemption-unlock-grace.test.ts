import { describe, expect, it } from "vitest";

import {
  OWNER_REDEMPTION_UNLOCK_GRACE_MS,
  createOwnerRedemptionUnlockGraceEntry,
  isOwnerRedemptionUnlockGraceValid,
  parseOwnerRedemptionUnlockGraceCache,
  pruneOwnerRedemptionUnlockGraceCache,
} from "./owner-redemption-unlock-grace";

describe("owner redemption unlock grace", () => {
  it("accepts the matching user and business until the short grace window expires", () => {
    const now = 1000;
    const cache = {
      biz_1: createOwnerRedemptionUnlockGraceEntry("user_1", now),
    };

    expect(isOwnerRedemptionUnlockGraceValid(cache, "biz_1", "user_1", now + 1)).toBe(true);
    expect(isOwnerRedemptionUnlockGraceValid(cache, "biz_1", "user_2", now + 1)).toBe(false);
    expect(isOwnerRedemptionUnlockGraceValid(cache, "biz_2", "user_1", now + 1)).toBe(false);
    expect(
      isOwnerRedemptionUnlockGraceValid(
        cache,
        "biz_1",
        "user_1",
        now + OWNER_REDEMPTION_UNLOCK_GRACE_MS + 1,
      ),
    ).toBe(false);
  });

  it("drops expired and malformed entries without throwing", () => {
    const now = 10_000;
    const parsed = parseOwnerRedemptionUnlockGraceCache(
      JSON.stringify({
        fresh: { userId: "user_1", expiresAt: now + 1 },
        expired: { userId: "user_1", expiresAt: now - 1 },
        malformed: { userId: "user_1", expiresAt: "soon" },
      }),
    );

    expect(pruneOwnerRedemptionUnlockGraceCache(parsed, now)).toEqual({
      fresh: { userId: "user_1", expiresAt: now + 1 },
    });
    expect(parseOwnerRedemptionUnlockGraceCache("not json")).toEqual({});
  });
});
