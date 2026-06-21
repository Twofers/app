import { describe, expect, it, vi } from "vitest";

import {
  getSuspendedLocation,
  getSuspendedLocationFromDealRows,
  isSuspendedBillingStatus,
  suspendedLocationResponseBody,
} from "./billing-suspension.ts";

function queryResult(data: Record<string, unknown> | null, error: { message?: string; code?: string } | null = null) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data, error })),
  };
  return query;
}

function mockClient(results: Array<ReturnType<typeof queryResult>>) {
  const from = vi.fn(() => {
    const next = results.shift();
    if (!next) throw new Error("Unexpected query");
    return next;
  });
  return { from };
}

describe("billing suspension helper", () => {
  it("recognizes suspended statuses and explicit suspension timestamps", () => {
    expect(isSuspendedBillingStatus("payment_failed_suspended")).toBe(true);
    expect(isSuspendedBillingStatus("pro_active", "2026-06-21T00:00:00Z")).toBe(true);
    expect(isSuspendedBillingStatus("pro_active")).toBe(false);
    expect(isSuspendedBillingStatus(null)).toBe(false);
  });

  it("returns a stable response body for blocked location actions", () => {
    expect(suspendedLocationResponseBody("create deals")).toEqual({
      error: "This location is suspended. Billing must be restored before you can create deals.",
      error_code: "LOCATION_BILLING_SUSPENDED",
    });
  });

  it("returns suspended entitlement details for a location", async () => {
    const client = mockClient([
      queryResult({
        business_location_id: "loc_123",
        status: "payment_failed_suspended",
        suspended_at: "2026-06-21T00:00:00Z",
        suspension_reason: "payment_failed",
      }),
    ]);

    await expect(getSuspendedLocation(client, "loc_123")).resolves.toEqual({
      businessLocationId: "loc_123",
      status: "payment_failed_suspended",
      suspensionReason: "payment_failed",
    });
  });

  it("fails open when billing tables are not present", async () => {
    const client = mockClient([
      queryResult(null, {
        code: "42P01",
        message: 'relation "public.location_entitlements" does not exist',
      }),
    ]);

    await expect(getSuspendedLocation(client, "loc_123")).resolves.toBeNull();
  });

  it("checks explicit deal-row locations before falling back to the primary location", async () => {
    const client = mockClient([
      queryResult({
        business_location_id: "loc_456",
        status: "canceled_suspended",
        suspended_at: "2026-06-21T00:00:00Z",
        suspension_reason: "subscription_deleted",
      }),
    ]);

    const result = await getSuspendedLocationFromDealRows(client, "biz_123", [
      { location_id: "loc_456" },
    ]);

    expect(result?.businessLocationId).toBe("loc_456");
    expect(client.from).toHaveBeenCalledTimes(1);
  });
});
