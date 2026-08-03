import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  removePushTokensForUser: vi.fn(async (_userId: string) => {}),
  clearCachedRole: vi.fn(async () => {}),
  clearOwnerUnlockGrace: vi.fn(async () => {}),
  signOut: vi.fn(async (_opts?: { scope?: string }) => ({ error: null })),
}));

vi.mock("@/lib/push-token", () => ({
  removePushTokensForUser: h.removePushTokensForUser,
}));

vi.mock("./tab-mode", () => ({
  clearCachedRole: h.clearCachedRole,
}));

vi.mock("./owner-redemption-unlock-cache", () => ({
  clearOwnerRedemptionUnlockGraceCache: h.clearOwnerUnlockGrace,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signOut: h.signOut,
    },
  },
}));

import { signOutAndRedirectToAuthLanding } from "./auth-app-sign-out";
import { clearUserInitiatedSignOut, isUserInitiatedSignOutPending } from "./auth-sign-out-intent";

beforeEach(() => {
  h.removePushTokensForUser.mockClear();
  h.clearCachedRole.mockClear();
  h.clearOwnerUnlockGrace.mockClear();
  h.signOut.mockClear();
  h.signOut.mockImplementation(async (_opts?: { scope?: string }) => ({ error: null }));
  clearUserInitiatedSignOut();
});

describe("signOutAndRedirectToAuthLanding", () => {
  it("clears role and owner unlock state before returning to auth", async () => {
    const replace = vi.fn();

    await expect(signOutAndRedirectToAuthLanding({ userId: "user_1", replace })).resolves.toEqual({ ok: true });

    expect(h.removePushTokensForUser).toHaveBeenCalledWith("user_1");
    expect(h.clearCachedRole).toHaveBeenCalledTimes(1);
    expect(h.clearOwnerUnlockGrace).toHaveBeenCalledTimes(1);
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(replace).toHaveBeenCalledWith("/auth-landing");
  });

  it("still clears local auth state when no push-token user is available", async () => {
    const replace = vi.fn();

    await expect(signOutAndRedirectToAuthLanding({ userId: null, replace })).resolves.toEqual({ ok: true });

    expect(h.removePushTokensForUser).not.toHaveBeenCalled();
    expect(h.clearCachedRole).toHaveBeenCalledTimes(1);
    expect(h.clearOwnerUnlockGrace).toHaveBeenCalledTimes(1);
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("flags the sign-out as user-initiated before the session is cleared", async () => {
    // AuthStackGate reads this while the sign-out is in flight; if it is not set by
    // then, the gate redirects with `next` pointing at the screen being left and the
    // next login reopens it (the log-out-from-Settings-lands-on-Settings bug).
    h.signOut.mockImplementationOnce(async () => {
      expect(isUserInitiatedSignOutPending()).toBe(true);
      return { error: null };
    });

    await expect(
      signOutAndRedirectToAuthLanding({ userId: "user_1", replace: vi.fn() }),
    ).resolves.toEqual({ ok: true });
  });

  it("hands routing back to the gate when sign-out fails", async () => {
    const replace = vi.fn();
    h.signOut.mockRejectedValueOnce(new Error("network down"));

    await expect(signOutAndRedirectToAuthLanding({ userId: "user_1", replace })).resolves.toEqual({
      ok: false,
      message: "network down",
    });

    expect(replace).not.toHaveBeenCalled();
    expect(isUserInitiatedSignOutPending()).toBe(false);
  });
});
