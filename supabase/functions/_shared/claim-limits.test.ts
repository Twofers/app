import { describe, expect, it } from "vitest";

import { hasClaimOnLocalBusinessDay } from "./claim-limits";

describe("hasClaimOnLocalBusinessDay", () => {
  it("blocks another claim when one was already redeemed today", () => {
    const now = new Date("2026-03-31T17:00:00.000Z");
    const out = hasClaimOnLocalBusinessDay({
      now,
      businessTz: "America/Chicago",
      claims: [
        {
          created_at: "2026-03-31T14:00:00.000Z",
          claim_status: "redeemed",
        },
      ],
    });
    expect(out).toBe(true);
  });

  it("ignores canceled claims", () => {
    const now = new Date("2026-03-31T17:00:00.000Z");
    const out = hasClaimOnLocalBusinessDay({
      now,
      businessTz: "America/Chicago",
      claims: [
        {
          created_at: "2026-03-31T14:00:00.000Z",
          claim_status: "canceled",
        },
      ],
    });
    expect(out).toBe(false);
  });
});
