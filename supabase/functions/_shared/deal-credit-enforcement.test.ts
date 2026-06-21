import { describe, expect, it, vi } from "vitest";

import {
  commitChargeableImageRevisionCredit,
  releaseChargeableImageRevisionCredit,
  reserveChargeableImageRevisionCredit,
  shouldChargeImageRevision,
} from "./deal-credit-enforcement.ts";

function locationQuery(locationId: string | null) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: locationId ? { id: locationId } : null,
      error: null,
    })),
  };
  return query;
}

function mockClient(options?: {
  enforcementEnabled?: boolean;
  enforcementError?: { message: string } | null;
  locationId?: string | null;
  reservationId?: string | null;
  reserveError?: { message: string } | null;
}) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  const query = locationQuery(options?.locationId ?? "loc_123");
  return {
    calls,
    client: {
      from: vi.fn(() => query),
      rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === "get_deal_credit_enforcement_enabled") {
          return {
            data: options?.enforcementEnabled ?? true,
            error: options?.enforcementError ?? null,
          };
        }
        if (fn === "reserve_location_deal_credit") {
          return {
            data: options?.reservationId ?? "reservation_123",
            error: options?.reserveError ?? null,
          };
        }
        return { data: null, error: null };
      }),
    },
  };
}

describe("deal credit enforcement helper", () => {
  it("charges only image-affecting revisions after the included allowance", () => {
    expect(shouldChargeImageRevision({ isRevision: true, revisionTarget: "image", revisionNumber: 3 })).toBe(true);
    expect(shouldChargeImageRevision({ isRevision: true, revisionTarget: "both", revisionNumber: 3 })).toBe(true);
    expect(shouldChargeImageRevision({ isRevision: true, revisionTarget: "copy", revisionNumber: 3 })).toBe(false);
    expect(shouldChargeImageRevision({ isRevision: true, revisionTarget: "image", revisionNumber: 2 })).toBe(false);
    expect(shouldChargeImageRevision({ isRevision: false, revisionTarget: "image", revisionNumber: 3 })).toBe(false);
  });

  it("keeps the existing revision limit when credit enforcement is disabled or unavailable", async () => {
    const { client, calls } = mockClient({ enforcementEnabled: false });
    const result = await reserveChargeableImageRevisionCredit(client, {
      businessId: "biz_123",
      isRevision: true,
      revisionTarget: "image",
      revisionNumber: 3,
      requestGroupId: "11111111-1111-4111-8111-111111111111",
    });

    expect(result).toEqual({
      ok: false,
      status: 429,
      errorCode: "REVISION_LIMIT",
      errorMessage: "You've revised this ad enough times. Start fresh with a new offer.",
    });
    expect(calls.map((call) => call.fn)).toEqual(["get_deal_credit_enforcement_enabled"]);
  });

  it("does not let extra copy-only revisions bypass the included allowance", async () => {
    const { client, calls } = mockClient();
    const result = await reserveChargeableImageRevisionCredit(client, {
      businessId: "biz_123",
      isRevision: true,
      revisionTarget: "copy",
      revisionNumber: 3,
      requestGroupId: "11111111-1111-4111-8111-111111111111",
    });

    expect(result).toEqual({
      ok: false,
      status: 429,
      errorCode: "REVISION_LIMIT",
      errorMessage: "You've revised this ad enough times. Start fresh with a new offer.",
    });
    expect(calls).toEqual([]);
  });

  it("reserves an idempotent location-level credit for an extra image revision", async () => {
    const { client, calls } = mockClient({ locationId: "loc_123", reservationId: "reservation_123" });
    const result = await reserveChargeableImageRevisionCredit(client, {
      businessId: "biz_123",
      isRevision: true,
      revisionTarget: "both",
      revisionNumber: 4,
      requestGroupId: "11111111-1111-4111-8111-111111111111",
    });

    expect(result).toEqual({
      ok: true,
      reservation: {
        businessLocationId: "loc_123",
        idempotencyKey: "extra_image_revision:biz_123:11111111-1111-4111-8111-111111111111:4",
        reservationId: "reservation_123",
        revisionNumber: 4,
      },
    });
    expect(calls.at(-1)).toEqual({
      fn: "reserve_location_deal_credit",
      args: {
        p_business_location_id: "loc_123",
        p_purpose: "extra_image_revision",
        p_idempotency_key: "extra_image_revision:biz_123:11111111-1111-4111-8111-111111111111:4",
        p_amount: 1,
        p_deal_id: null,
        p_offer_version_id: null,
        p_recurring_occurrence_id: null,
      },
    });
  });

  it("commits and releases only by reservation id", async () => {
    const { client, calls } = mockClient();
    const reservation = {
      businessLocationId: "loc_123",
      idempotencyKey: "extra_image_revision:biz:group:3",
      reservationId: "reservation_123",
      revisionNumber: 3,
    };

    await commitChargeableImageRevisionCredit(client, reservation);
    await releaseChargeableImageRevisionCredit(client, reservation, "image_failed");

    expect(calls.slice(-2)).toEqual([
      {
        fn: "commit_location_deal_credit",
        args: { p_reservation_id: "reservation_123", p_deal_id: null },
      },
      {
        fn: "release_location_deal_credit",
        args: { p_reservation_id: "reservation_123", p_reason: "image_failed" },
      },
    ]);
  });
});
