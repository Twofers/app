import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    profileRole: null as "business" | "customer" | null,
    pendingSocialRole: null as "business" | "customer" | null,
    profileError: null as { message: string } | null,
    fetchOwnerBusiness: vi.fn(),
    upsert: vi.fn(async () => ({ error: null })),
    maybeSingle: vi.fn(async () => ({
      data: state.profileRole ? { role: state.profileRole } : null,
      error: state.profileError,
    })),
    from: vi.fn((_table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: state.maybeSingle,
        })),
      })),
      upsert: state.upsert,
    })),
  };
  return state;
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: h.from,
  },
}));

vi.mock("@/lib/owner-business", () => ({
  fetchOwnerBusiness: h.fetchOwnerBusiness,
}));

vi.mock("@/lib/pending-social-role", () => ({
  peekPendingSocialRole: async () => h.pendingSocialRole,
}));

import { deriveRoleFromData, resolveRoleForUser, SIGNUP_ROLE_META_KEY } from "./profiles-role";

function user(metadata: Record<string, unknown> = {}): User {
  return { id: "user_1", user_metadata: metadata } as User;
}

beforeEach(() => {
  h.profileRole = null;
  h.pendingSocialRole = null;
  h.profileError = null;
  h.fetchOwnerBusiness.mockReset();
  h.fetchOwnerBusiness.mockResolvedValue({ row: null, error: null });
  h.upsert.mockClear();
  h.maybeSingle.mockClear();
  h.from.mockClear();
});

describe("resolveRoleForUser", () => {
  it("uses the stored profile role before signup metadata or owned business fallback", async () => {
    h.profileRole = "business";

    await expect(resolveRoleForUser(user({ [SIGNUP_ROLE_META_KEY]: "customer" }))).resolves.toBe("business");
    expect(h.fetchOwnerBusiness).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("uses and persists signup metadata when no profile role is stored", async () => {
    await expect(resolveRoleForUser(user({ [SIGNUP_ROLE_META_KEY]: "business" }))).resolves.toBe("business");

    expect(h.fetchOwnerBusiness).not.toHaveBeenCalled();
    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user_1", role: "business", updated_at: expect.any(String) }),
      { onConflict: "id" },
    );
  });

  it("derives a business role for an existing account that owns a business row", async () => {
    h.fetchOwnerBusiness.mockResolvedValueOnce({ row: { id: "biz_1" }, error: null });

    await expect(resolveRoleForUser(user())).resolves.toBe("business");
    // No owner id argument: get_my_business() is already scoped to auth.uid(),
    // so fetchOwnerBusiness takes only the client.
    expect(h.fetchOwnerBusiness).toHaveBeenCalledWith(expect.any(Object));
    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user_1", role: "business" }),
      { onConflict: "id" },
    );
  });

  it("defaults existing accounts without a business row to customer, but does NOT persist the guess", async () => {
    // Regression: TabModeProvider calls this the instant a session appears, concurrently with
    // auth-landing completing a social sign-in. profiles.role is immutable once set, so persisting
    // the "customer" fallback here used to race the role the user actually picked and could lock a
    // merchant out permanently (observed on the S10 as PROFILES_ROLE_IMMUTABLE, 2026-07-25).
    await expect(resolveRoleForUser(user())).resolves.toBe("customer");
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("prefers a pending social role over the derived fallback, and persists it", async () => {
    h.pendingSocialRole = "business";

    await expect(resolveRoleForUser(user())).resolves.toBe("business");
    // Never consults the business table: the stashed choice is authoritative for a brand-new account.
    expect(h.fetchOwnerBusiness).not.toHaveBeenCalled();
    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user_1", role: "business" }),
      { onConflict: "id" },
    );
  });

  it("keeps stored and metadata roles ahead of a stale pending social role", async () => {
    h.pendingSocialRole = "business";
    h.profileRole = "customer";
    await expect(resolveRoleForUser(user())).resolves.toBe("customer");

    h.profileRole = null;
    await expect(resolveRoleForUser(user({ [SIGNUP_ROLE_META_KEY]: "customer" }))).resolves.toBe("customer");
  });
});

describe("deriveRoleFromData", () => {
  it("falls back to customer when the business lookup fails", async () => {
    h.fetchOwnerBusiness.mockRejectedValueOnce(new Error("network down"));

    await expect(deriveRoleFromData("user_1")).resolves.toBe("customer");
  });
});
