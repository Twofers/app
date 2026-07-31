import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  secureStore: new Map<string, string>(),
  webClientId: null as string | null,
  iosClientId: null as string | null,
}));

// Mock the LOCAL wrapper, not "expo-secure-store": the wrapper loads the package through a dynamic
// import, and vi.mock on that resolution behaved differently on the Linux CI runner (2026-06-11).
vi.mock("./redemption-secure-store", () => ({
  secureGetItem: async (k: string) => h.secureStore.get(k) ?? null,
  secureSetItem: async (k: string, v: string) => void h.secureStore.set(k, v),
  secureDeleteItem: async (k: string) => void h.secureStore.delete(k),
}));
vi.mock("./runtime-env", () => ({
  getGoogleWebClientId: () => h.webClientId,
  getGoogleIosClientId: () => h.iosClientId,
}));
vi.mock("./supabase", () => ({
  supabase: { auth: { signInWithIdToken: async () => ({ data: { session: null }, error: null }) } },
}));

import {
  APPLE_CANCELLED_CODE,
  APPLE_PRIVATE_RELAY_DOMAIN,
  GOOGLE_CANCELLED_CODE,
  PENDING_SOCIAL_ROLE_KEY,
  clearPendingSocialRole,
  decideSocialCompletion,
  isAppleRelayEmail,
  isSocialCancellation,
  setPendingSocialRole,
  shouldBlockBusinessRelayEmail,
  signInWithGoogle,
  takePendingSocialRole,
  toAuthLikeError,
} from "./social-auth";

const socialAuthSource = readFileSync(join(process.cwd(), "lib", "social-auth.ts"), "utf8");

beforeEach(async () => {
  h.secureStore.clear();
  h.webClientId = "web-client-id.apps.googleusercontent.com";
  h.iosClientId = null;
  await clearPendingSocialRole();
});

describe("apple relay email detection", () => {
  it("matches the relay domain case-insensitively", () => {
    expect(isAppleRelayEmail(`abc123@${APPLE_PRIVATE_RELAY_DOMAIN}`)).toBe(true);
    expect(isAppleRelayEmail("ABC123@PrivateRelay.AppleID.com")).toBe(true);
    expect(isAppleRelayEmail(`  x@${APPLE_PRIVATE_RELAY_DOMAIN}  `)).toBe(true);
  });

  it("does not match real addresses, blanks, or lookalike domains", () => {
    expect(isAppleRelayEmail("owner@twoferapp.com")).toBe(false);
    expect(isAppleRelayEmail("")).toBe(false);
    expect(isAppleRelayEmail(null)).toBe(false);
    expect(isAppleRelayEmail(undefined)).toBe(false);
    // Suffix match must be anchored at the "@", so a lookalike host does not pass.
    expect(isAppleRelayEmail("someone@notprivaterelay.appleid.com")).toBe(false);
  });

  it("blocks a relay address only for the business role", () => {
    const relay = `abc@${APPLE_PRIVATE_RELAY_DOMAIN}`;
    expect(shouldBlockBusinessRelayEmail("business", relay)).toBe(true);
    expect(shouldBlockBusinessRelayEmail("customer", relay)).toBe(false);
    expect(shouldBlockBusinessRelayEmail(null, relay)).toBe(false);
    expect(shouldBlockBusinessRelayEmail("business", "owner@twoferapp.com")).toBe(false);
  });
});

describe("pending social role carry", () => {
  it("returns the stored role once and clears it", async () => {
    await setPendingSocialRole("business");
    expect(h.secureStore.get(PENDING_SOCIAL_ROLE_KEY)).toBe("business");
    expect(await takePendingSocialRole()).toBe("business");
    expect(h.secureStore.has(PENDING_SOCIAL_ROLE_KEY)).toBe(false);
    expect(await takePendingSocialRole()).toBe(null);
  });

  it("recovers the role from secure storage when the module cache is gone (process death)", async () => {
    // No setPendingSocialRole call: this is the Android "app was killed behind the picker" path.
    h.secureStore.set(PENDING_SOCIAL_ROLE_KEY, "customer");
    expect(await takePendingSocialRole()).toBe("customer");
    expect(h.secureStore.has(PENDING_SOCIAL_ROLE_KEY)).toBe(false);
  });

  it("ignores a corrupted stored value", async () => {
    h.secureStore.set(PENDING_SOCIAL_ROLE_KEY, "admin");
    expect(await takePendingSocialRole()).toBe(null);
  });

  it("clears both the cache and secure storage", async () => {
    await setPendingSocialRole("business");
    await clearPendingSocialRole();
    expect(h.secureStore.has(PENDING_SOCIAL_ROLE_KEY)).toBe(false);
    expect(await takePendingSocialRole()).toBe(null);
  });
});

describe("cancellation mapping", () => {
  it("treats both provider cancel codes as a silent no-op", () => {
    expect(isSocialCancellation({ code: GOOGLE_CANCELLED_CODE })).toBe(true);
    expect(isSocialCancellation({ code: APPLE_CANCELLED_CODE })).toBe(true);
    expect(isSocialCancellation(Object.assign(new Error("cancelled"), { code: APPLE_CANCELLED_CODE }))).toBe(true);
  });

  it("does not swallow real failures", () => {
    expect(isSocialCancellation(new Error("DEVELOPER_ERROR"))).toBe(false);
    expect(isSocialCancellation({ code: "PLAY_SERVICES_NOT_AVAILABLE" })).toBe(false);
    expect(isSocialCancellation(null)).toBe(false);
    expect(isSocialCancellation(undefined)).toBe(false);
  });

  it("normalizes thrown values into the shape friendlyAuthError reads", () => {
    expect(toAuthLikeError(Object.assign(new Error("boom"), { code: "X" }))).toEqual({ message: "boom", code: "X" });
    expect(toAuthLikeError(new Error("plain"))).toEqual({ message: "plain" });
    expect(toAuthLikeError("string failure")).toEqual({ message: "string failure" });
    expect(toAuthLikeError(null)).toBe(null);
  });
});

describe("post-session completion decision", () => {
  it("routes by the stored role even when a pending role disagrees", () => {
    expect(decideSocialCompletion({ storedRole: "business", pendingRole: "customer" })).toEqual({
      action: "route",
      role: "business",
    });
  });

  it("adopts the pending role when nothing is stored yet", () => {
    expect(decideSocialCompletion({ storedRole: null, pendingRole: "business" })).toEqual({
      action: "adopt",
      role: "business",
    });
  });

  it("asks on screen when there is neither a stored nor a pending role", () => {
    expect(decideSocialCompletion({ storedRole: null, pendingRole: null })).toEqual({ action: "finish_setup" });
  });
});

describe("google sign-in configuration guard", () => {
  it("fails closed, without touching the native SDK, when no web client ID is configured", async () => {
    h.webClientId = null;
    expect(await signInWithGoogle()).toEqual({ status: "error", reason: "not_configured", error: null });
  });
});

// The Apple nonce is the classic breakage: Apple signs the SHA-256 of the nonce into the identity
// token, and Supabase re-hashes the RAW value we send it. Asserting on source text rather than
// mocking the dynamically imported native SDKs, which is the pattern this repo already trusts.
describe("apple nonce shape", () => {
  it("hashes the raw nonce for Apple and sends the raw nonce to Supabase", () => {
    expect(socialAuthSource).toContain("const rawNonce = Crypto.randomUUID();");
    expect(socialAuthSource).toContain(
      "const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);",
    );
    expect(socialAuthSource).toContain("nonce: hashedNonce,");
    expect(socialAuthSource).toContain('return await exchangeIdToken("apple", identityToken, rawNonce);');
  });

  it("requests the full name and email scopes", () => {
    expect(socialAuthSource).toContain("AppleAuthentication.AppleAuthenticationScope.FULL_NAME,");
    expect(socialAuthSource).toContain("AppleAuthentication.AppleAuthenticationScope.EMAIL,");
  });

  it("sends no nonce on the Google exchange", () => {
    expect(socialAuthSource).toContain('return await exchangeIdToken("google", idToken);');
  });

  it("signs out with local scope only", () => {
    expect(socialAuthSource).toContain('supabase.auth.signOut({ scope: "local" })');
  });
});
