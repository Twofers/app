import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  setSession: vi.fn(),
}));

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      scheme: "twoforone",
    },
  },
}));

vi.mock("expo-linking", () => ({
  createURL: (path: string, { scheme, isTripleSlashed }: { scheme?: string; isTripleSlashed?: boolean } = {}) =>
    `${scheme ?? "twoforone"}:${isTripleSlashed ? "///" : "//"}${path}`,
}));

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: (code: string) => h.exchangeCodeForSession(code),
      setSession: (tokens: { access_token: string; refresh_token: string }) => h.setSession(tokens),
    },
  },
}));

import { consumeSupabaseAuthDeepLink, isSupabaseAuthDeepLink } from "./auth-password-recovery";

beforeEach(() => {
  vi.clearAllMocks();
  h.exchangeCodeForSession.mockResolvedValue({ data: { session: {}, user: {} }, error: null });
  h.setSession.mockResolvedValue({ data: { session: {} }, error: null });
});

describe("consumeSupabaseAuthDeepLink", () => {
  it("routes implicit reset-password hash tokens to recovery even without type", async () => {
    const result = await consumeSupabaseAuthDeepLink(
      "twoforone://reset-password#access_token=access-token&refresh_token=refresh-token",
    );

    expect(result).toEqual({ ok: true, flow: "recovery" });
    expect(h.setSession).toHaveBeenCalledWith({
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
  });

  it("routes triple-slashed reset-password links to recovery", async () => {
    const result = await consumeSupabaseAuthDeepLink(
      "twoforone:///reset-password#access_token=access-token&refresh_token=refresh-token",
    );

    expect(result).toEqual({ ok: true, flow: "recovery" });
  });

  it("routes type=recovery auth callback tokens to recovery", async () => {
    const result = await consumeSupabaseAuthDeepLink(
      "twoforone://auth-callback#access_token=access-token&refresh_token=refresh-token&type=recovery",
    );

    expect(result).toEqual({ ok: true, flow: "recovery" });
  });

  it("uses Supabase PKCE redirect type when the URL carries only a code", async () => {
    h.exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: {}, user: {}, redirectType: "PASSWORD_RECOVERY" },
      error: null,
    });

    const result = await consumeSupabaseAuthDeepLink("twoforone://auth-callback?code=recovery-code");

    expect(result).toEqual({ ok: true, flow: "recovery" });
    expect(h.exchangeCodeForSession).toHaveBeenCalledWith("recovery-code");
  });

  it("keeps non-recovery code callbacks on the signup flow", async () => {
    const result = await consumeSupabaseAuthDeepLink("twoforone://auth-callback?code=signup-code");

    expect(result).toEqual({ ok: true, flow: "signup" });
    expect(h.exchangeCodeForSession).toHaveBeenCalledWith("signup-code");
  });
});

describe("isSupabaseAuthDeepLink", () => {
  it("recognizes auth callback and reset-password links with auth payloads", () => {
    expect(isSupabaseAuthDeepLink("twoforone://auth-callback?code=signup-code")).toBe(true);
    expect(
      isSupabaseAuthDeepLink("twoforone://reset-password#access_token=access-token&refresh_token=refresh-token"),
    ).toBe(true);
    expect(isSupabaseAuthDeepLink("https://www.twoferapp.com/auth-callback?code=signup-code")).toBe(true);
  });

  it("does not treat public Share Deal URLs as auth links", () => {
    expect(isSupabaseAuthDeepLink("https://www.twoferapp.com/s/ABCDEFG")).toBe(false);
    expect(isSupabaseAuthDeepLink("https://www.twoferapp.com/s/ABCDEFG?code=not-auth")).toBe(false);
  });
});
