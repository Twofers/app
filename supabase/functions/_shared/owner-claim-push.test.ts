import { describe, expect, it } from "vitest";
import {
  OWNER_CLAIM_PUSH_WINDOW_MINUTES,
  buildOwnerClaimPushMessage,
  decideOwnerClaimPush,
  resolveOwnerPushLocale,
  type OwnerClaimPushInput,
} from "./owner-claim-push.ts";

const NOW = Date.UTC(2026, 5, 10, 18, 0, 0);
const MIN = 60_000;

function input(overrides: Partial<OwnerClaimPushInput>): OwnerClaimPushInput {
  return {
    notificationsEnabled: true,
    maxClaims: null,
    claimCount: null,
    nowMs: NOW,
    lastClaimPushAtMs: null,
    ...overrides,
  };
}

describe("decideOwnerClaimPush — owner preference gate", () => {
  it("sends nothing when the owner turned business notifications off", () => {
    expect(decideOwnerClaimPush(input({ notificationsEnabled: false }))).toBeNull();
    expect(
      decideOwnerClaimPush(
        input({ notificationsEnabled: false, maxClaims: 5, claimCount: 5 }),
      ),
    ).toBeNull();
  });
});

describe("decideOwnerClaimPush — sold out", () => {
  it("fires when the claim count reaches max_claims", () => {
    expect(decideOwnerClaimPush(input({ maxClaims: 5, claimCount: 5 }))).toBe("sold_out");
  });

  it("wins over the new-claim window (sold out is never suppressed)", () => {
    expect(
      decideOwnerClaimPush(
        input({ maxClaims: 5, claimCount: 5, lastClaimPushAtMs: NOW - 1 * MIN }),
      ),
    ).toBe("sold_out");
  });

  it("does not fire below the cap", () => {
    expect(decideOwnerClaimPush(input({ maxClaims: 5, claimCount: 4 }))).toBe("new_claim");
  });

  it("never fires for unlimited deals (max_claims null or <= 0)", () => {
    expect(decideOwnerClaimPush(input({ maxClaims: null, claimCount: 100 }))).toBe("new_claim");
    expect(decideOwnerClaimPush(input({ maxClaims: 0, claimCount: 100 }))).toBe("new_claim");
  });

  it("falls back to new-claim when the count is unknown", () => {
    expect(decideOwnerClaimPush(input({ maxClaims: 5, claimCount: null }))).toBe("new_claim");
  });
});

describe("decideOwnerClaimPush — new-claim suppression window", () => {
  it("sends when no push has ever been sent for the deal", () => {
    expect(decideOwnerClaimPush(input({}))).toBe("new_claim");
  });

  it("suppresses a repeat push inside the window", () => {
    expect(
      decideOwnerClaimPush(input({ lastClaimPushAtMs: NOW - 2 * MIN })),
    ).toBeNull();
    expect(
      decideOwnerClaimPush(
        input({ lastClaimPushAtMs: NOW - (OWNER_CLAIM_PUSH_WINDOW_MINUTES * MIN - 1) }),
      ),
    ).toBeNull();
  });

  it("sends again once the window has elapsed", () => {
    expect(
      decideOwnerClaimPush(
        input({ lastClaimPushAtMs: NOW - OWNER_CLAIM_PUSH_WINDOW_MINUTES * MIN }),
      ),
    ).toBe("new_claim");
  });

  it("respects a custom window", () => {
    expect(
      decideOwnerClaimPush(input({ lastClaimPushAtMs: NOW - 3 * MIN, windowMinutes: 2 })),
    ).toBe("new_claim");
    expect(
      decideOwnerClaimPush(input({ lastClaimPushAtMs: NOW - 1 * MIN, windowMinutes: 2 })),
    ).toBeNull();
  });
});

describe("resolveOwnerPushLocale", () => {
  it("maps supported locales and falls back to en", () => {
    expect(resolveOwnerPushLocale("es")).toBe("es");
    expect(resolveOwnerPushLocale("KO")).toBe("ko");
    expect(resolveOwnerPushLocale("en")).toBe("en");
    expect(resolveOwnerPushLocale("fr")).toBe("en");
    expect(resolveOwnerPushLocale(null)).toBe("en");
    expect(resolveOwnerPushLocale(undefined)).toBe("en");
  });
});

describe("buildOwnerClaimPushMessage", () => {
  it("includes the deal title in each locale", () => {
    expect(buildOwnerClaimPushMessage("new_claim", "en", "2-for-1 Tacos")).toEqual({
      title: "New claim",
      body: "New claim on “2-for-1 Tacos”",
    });
    expect(buildOwnerClaimPushMessage("sold_out", "es", "Tacos 2x1").body).toContain("Tacos 2x1");
    expect(buildOwnerClaimPushMessage("sold_out", "ko", "타코 1+1").body).toContain("타코 1+1");
  });

  it("falls back to a generic deal name when the title is empty", () => {
    expect(buildOwnerClaimPushMessage("new_claim", "en", "").body).toBe("New claim on “your deal”");
    expect(buildOwnerClaimPushMessage("sold_out", "es", null).body).toContain("tu oferta");
    expect(buildOwnerClaimPushMessage("new_claim", "ko", "   ").body).toContain("내 딜");
  });
});
