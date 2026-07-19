import { describe, expect, it } from "vitest";

import { isBusinessNameLocked, NON_PUBLIC_BUSINESS_STATUSES } from "./business-name-lock";

// The name lock must mirror public.is_public_business_status (migration
// 20260816120000): locked exactly when the business lifecycle status is
// publicly visible. business-name-lock-source.test.ts checks the list stays
// in sync with the SQL and edge-function copies; this covers the behavior.
describe("isBusinessNameLocked", () => {
  it("keeps the name editable for every pre-approval status", () => {
    for (const status of NON_PUBLIC_BUSINESS_STATUSES) {
      expect(isBusinessNameLocked(status)).toBe(false);
    }
  });

  it("locks the name for every post-approval lifecycle status", () => {
    for (const status of [
      "active",
      "trialing",
      "limited_trial",
      "past_due",
      "trial_expired",
      "canceled",
      "suspended",
      "disabled",
      "archived",
    ]) {
      expect(isBusinessNameLocked(status)).toBe(true);
    }
  });

  it("fails open (editable) when the status is unknown — the server still enforces", () => {
    expect(isBusinessNameLocked(null)).toBe(false);
    expect(isBusinessNameLocked(undefined)).toBe(false);
    expect(isBusinessNameLocked("")).toBe(false);
    expect(isBusinessNameLocked(42)).toBe(false);
  });
});
