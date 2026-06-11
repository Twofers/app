// Exit-flow tests for Redemption Mode (audit Finding 1 / batch R3, Finding 6 /
// batch R5). The device deliberately stores no owner session, so a successful
// PIN exit must always end signed out with all redemption storage cleared.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const asyncStore = new Map<string, string>();
  const secureStore = new Map<string, string>();
  return {
    asyncStore,
    secureStore,
    signOut: vi.fn(async (_opts?: { scope?: string }) => ({ error: null })),
    setSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    getSession: vi.fn(async () => ({ data: { session: null } })),
    invoke: vi.fn(async (_name: string, _opts?: unknown) => ({ data: null, error: null }) as { data: unknown; error: unknown }),
  };
});

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => h.asyncStore.get(k) ?? null,
    setItem: async (k: string, v: string) => void h.asyncStore.set(k, v),
    removeItem: async (k: string) => void h.asyncStore.delete(k),
  },
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => h.secureStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void h.secureStore.set(k, v),
  deleteItemAsync: async (k: string) => void h.secureStore.delete(k),
}));
vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      signOut: (opts?: { scope?: string }) => h.signOut(opts),
      setSession: () => h.setSession(),
      getSession: () => h.getSession(),
    },
    functions: { invoke: (name: string, opts?: unknown) => h.invoke(name, opts) },
  },
}));
vi.mock("./functions", () => ({
  EDGE_FUNCTION_TIMEOUT_MS: 30000,
  parseFunctionError: (e: unknown) => (e instanceof Error ? e.message : "Request failed."),
}));

import { exitRedemptionMode, REDEMPTION_MODE_STATE_KEY } from "./redemption-mode";

const STATE = {
  active: true,
  businessId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  installId: "install-1234",
  deviceLabel: "Front Counter",
  activatedAt: null,
};
const EXIT_TOKEN_KEY = "twofer_redemption_exit_token_v1";
const STAFF_SESSION_KEY = "twofer_redemption_staff_session_v1";

function seedLockedDevice() {
  h.asyncStore.set(REDEMPTION_MODE_STATE_KEY, JSON.stringify(STATE));
  h.secureStore.set(EXIT_TOKEN_KEY, "exit-token-value");
  h.secureStore.set(STAFF_SESSION_KEY, JSON.stringify({ access_token: "a", refresh_token: "r" }));
}

function invokeError(status: number, message: string) {
  return Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(JSON.stringify({ error: message }), { status }),
  });
}

beforeEach(() => {
  h.asyncStore.clear();
  h.secureStore.clear();
  vi.clearAllMocks();
});

describe("exitRedemptionMode", () => {
  it("on success signs out locally, clears all redemption storage, and never restores an owner session", async () => {
    seedLockedDevice();
    h.invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });

    await expect(exitRedemptionMode("1234")).resolves.toBeUndefined();

    expect(h.invoke).toHaveBeenCalledWith(
      "exit-redemption-mode",
      expect.objectContaining({
        body: { device_id: STATE.deviceId, exit_token: "exit-token-value", pin: "1234" },
      }),
    );
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(h.setSession).not.toHaveBeenCalled();
    expect(h.asyncStore.has(REDEMPTION_MODE_STATE_KEY)).toBe(false);
    expect(h.secureStore.has(EXIT_TOKEN_KEY)).toBe(false);
    expect(h.secureStore.has(STAFF_SESSION_KEY)).toBe(false);
  });

  it("on a wrong PIN surfaces the server message and keeps the device locked", async () => {
    seedLockedDevice();
    h.invoke.mockResolvedValueOnce({ data: null, error: invokeError(403, "Incorrect exit PIN.") });

    await expect(exitRedemptionMode("9999")).rejects.toThrow("Incorrect exit PIN.");

    expect(h.signOut).not.toHaveBeenCalled();
    expect(h.asyncStore.has(REDEMPTION_MODE_STATE_KEY)).toBe(true);
    expect(h.secureStore.has(EXIT_TOKEN_KEY)).toBe(true);
  });

  it("treats a 404 (device row gone) as device-gone and un-bricks to logged out", async () => {
    seedLockedDevice();
    h.invoke.mockResolvedValueOnce({ data: null, error: invokeError(404, "Device is not active.") });

    await expect(exitRedemptionMode("1234")).resolves.toBeUndefined();

    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(h.setSession).not.toHaveBeenCalled();
    expect(h.asyncStore.has(REDEMPTION_MODE_STATE_KEY)).toBe(false);
    expect(h.secureStore.has(EXIT_TOKEN_KEY)).toBe(false);
    expect(h.secureStore.has(STAFF_SESSION_KEY)).toBe(false);
  });

  it("does not treat non-404 server errors as device-gone", async () => {
    seedLockedDevice();
    h.invoke.mockResolvedValueOnce({ data: null, error: invokeError(429, "Too many incorrect PIN attempts. Try again later.") });

    await expect(exitRedemptionMode("1234")).rejects.toThrow("Too many incorrect PIN attempts. Try again later.");

    expect(h.signOut).not.toHaveBeenCalled();
    expect(h.asyncStore.has(REDEMPTION_MODE_STATE_KEY)).toBe(true);
  });

  it("with missing local exit credentials force-clears to logged out", async () => {
    h.asyncStore.set(REDEMPTION_MODE_STATE_KEY, JSON.stringify(STATE));
    // no exit token in secure storage

    await expect(exitRedemptionMode("1234")).resolves.toBeUndefined();

    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(h.asyncStore.has(REDEMPTION_MODE_STATE_KEY)).toBe(false);
  });
});
