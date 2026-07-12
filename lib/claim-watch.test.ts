import { describe, expect, it } from "vitest";
import { classifyClaimWatchRow } from "./claim-watch";

describe("classifyClaimWatchRow", () => {
  it("treats a null/undefined/empty row as not done", () => {
    expect(classifyClaimWatchRow(null)).toEqual({ done: false });
    expect(classifyClaimWatchRow(undefined)).toEqual({ done: false });
    expect(classifyClaimWatchRow({})).toEqual({ done: false });
  });

  it("keeps an active claim pending", () => {
    expect(classifyClaimWatchRow({ redeemed_at: null, claim_status: "active" })).toEqual({
      done: false,
    });
    expect(classifyClaimWatchRow({ redeemed_at: null, claim_status: "redeeming" })).toEqual({
      done: false,
    });
  });

  it("reports redeemed when redeemed_at is set even if status lags", () => {
    expect(
      classifyClaimWatchRow({ redeemed_at: "2026-07-10T18:00:00.000Z", claim_status: "active" }),
    ).toEqual({ done: true, kind: "redeemed" });
  });

  it("reports redeemed when claim_status is redeemed", () => {
    expect(classifyClaimWatchRow({ redeemed_at: null, claim_status: "redeemed" })).toEqual({
      done: true,
      kind: "redeemed",
    });
  });

  it("reports the terminal kind for claims that ended without a redemption", () => {
    expect(classifyClaimWatchRow({ claim_status: "released" })).toEqual({
      done: true,
      kind: "released",
    });
    expect(classifyClaimWatchRow({ claim_status: "canceled" })).toEqual({
      done: true,
      kind: "canceled",
    });
    expect(classifyClaimWatchRow({ claim_status: "expired" })).toEqual({
      done: true,
      kind: "expired",
    });
  });

  it("prefers redeemed over other terminal states", () => {
    expect(
      classifyClaimWatchRow({ redeemed_at: "2026-07-10T18:00:00.000Z", claim_status: "expired" }),
    ).toEqual({ done: true, kind: "redeemed" });
  });

  it("ignores unknown statuses", () => {
    expect(classifyClaimWatchRow({ claim_status: "something_else" })).toEqual({ done: false });
  });
});
