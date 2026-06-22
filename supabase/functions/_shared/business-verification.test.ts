import { describe, expect, it } from "vitest";

import {
  businessVerificationRequiredResponseBody,
  getUnverifiedLocationFromDealRows,
  isBusinessLocationPublishVerified,
} from "./business-verification.ts";

describe("business verification publish gate", () => {
  it("fails open when the verification gate migration is not available yet", async () => {
    const client = {
      rpc: () => Promise.resolve({ data: null, error: { code: "42883", message: "could not find the function" } }),
    };

    await expect(isBusinessLocationPublishVerified(client, "loc-1")).resolves.toBe(true);
  });

  it("returns the first unverified location from publish rows", async () => {
    const calls: string[] = [];
    const client = {
      rpc: (_fn: string, params?: Record<string, unknown>) => {
        const locationId = String(params?.p_business_location_id ?? "");
        calls.push(locationId);
        return Promise.resolve({ data: locationId !== "loc-2", error: null });
      },
    };

    await expect(
      getUnverifiedLocationFromDealRows(client, "business-1", [
        { location_id: "loc-1" },
        { location_id: "loc-2" },
      ]),
    ).resolves.toEqual({ businessLocationId: "loc-2" });
    expect(calls).toEqual(["loc-1", "loc-2"]);
  });

  it("uses a stable non-sensitive response body", () => {
    expect(businessVerificationRequiredResponseBody("publish deals")).toEqual({
      error: "This business location must be verified before you can publish deals.",
      error_code: "BUSINESS_LOCATION_VERIFICATION_REQUIRED",
    });
  });
});
