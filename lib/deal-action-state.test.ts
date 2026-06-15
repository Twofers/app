import { describe, expect, it } from "vitest";

import { getDealDetailActionState } from "./deal-action-state";

describe("getDealDetailActionState", () => {
  it("shows claim for available unclaimed deals", () => {
    expect(
      getDealDetailActionState({
        hasActiveClaim: false,
        isClaiming: false,
        unavailableLabel: null,
      }),
    ).toMatchObject({ kind: "claimable", showClaim: true, showQr: false });
  });

  it("disables claim while claiming", () => {
    expect(
      getDealDetailActionState({
        hasActiveClaim: false,
        isClaiming: true,
        unavailableLabel: null,
      }),
    ).toMatchObject({ kind: "claiming", showClaim: true, claimDisabled: true });
  });

  it("shows QR access only after an active claim exists", () => {
    expect(
      getDealDetailActionState({
        hasActiveClaim: true,
        isClaiming: false,
        unavailableLabel: null,
      }),
    ).toMatchObject({ kind: "active_claimed", showClaim: false, showQr: true });
  });

  it("renders unavailable deals as read-only status", () => {
    expect(
      getDealDetailActionState({
        hasActiveClaim: false,
        isClaiming: false,
        unavailableLabel: "Expired",
      }),
    ).toMatchObject({ kind: "unavailable", showClaim: false, showQr: false, statusLabel: "Expired" });
  });
});
