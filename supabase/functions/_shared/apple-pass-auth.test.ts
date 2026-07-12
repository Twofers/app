import { describe, expect, it } from "vitest";
import {
  appleAuthTokenHash,
  deriveAppleAuthToken,
  parseApplePassAuthHeader,
  timingSafeEqualStrings,
} from "./apple-pass-auth.ts";

describe("apple pass web-service auth token", () => {
  it("is deterministic per (secret,user) so it survives pass re-issues", async () => {
    const a = await deriveAppleAuthToken("server-secret", "user-1");
    const b = await deriveAppleAuthToken("server-secret", "user-1");
    expect(a).toBe(b);
  });

  it("differs by user and by secret", async () => {
    const u1 = await deriveAppleAuthToken("s", "user-1");
    const u2 = await deriveAppleAuthToken("s", "user-2");
    const s2 = await deriveAppleAuthToken("other", "user-1");
    expect(u1).not.toBe(u2);
    expect(u1).not.toBe(s2);
  });

  it("meets Apple's >=16 char minimum and is url-safe base64", async () => {
    const t = await deriveAppleAuthToken("server-secret", "user-1");
    expect(t.length).toBeGreaterThanOrEqual(16);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hash is stable and url-safe", async () => {
    const t = await deriveAppleAuthToken("s", "u");
    expect(await appleAuthTokenHash(t)).toBe(await appleAuthTokenHash(t));
    expect(await appleAuthTokenHash(t)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("parseApplePassAuthHeader", () => {
  it("extracts the token from the ApplePass scheme (case-insensitive)", () => {
    expect(parseApplePassAuthHeader("ApplePass abc123")).toBe("abc123");
    expect(parseApplePassAuthHeader("applepass  tok ")).toBe("tok");
  });
  it("returns null for missing or wrong scheme", () => {
    expect(parseApplePassAuthHeader(null)).toBeNull();
    expect(parseApplePassAuthHeader("Bearer abc")).toBeNull();
    expect(parseApplePassAuthHeader("")).toBeNull();
  });
});

describe("timingSafeEqualStrings", () => {
  it("matches equal strings and rejects any difference", () => {
    expect(timingSafeEqualStrings("abcdef", "abcdef")).toBe(true);
    expect(timingSafeEqualStrings("abcdef", "abcdeg")).toBe(false);
    expect(timingSafeEqualStrings("abc", "abcd")).toBe(false);
  });
});
