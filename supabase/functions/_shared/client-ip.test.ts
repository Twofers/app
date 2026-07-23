import { describe, expect, it } from "vitest";

import { clientIpFromRequest, isLikelyIpAddress, MAX_IP_LENGTH } from "./client-ip.ts";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://example.test/", { headers });
}

describe("isLikelyIpAddress", () => {
  it("accepts valid IPv4", () => {
    expect(isLikelyIpAddress("203.0.113.7")).toBe(true);
    expect(isLikelyIpAddress("8.8.8.8")).toBe(true);
  });

  it("rejects malformed / out-of-range IPv4", () => {
    expect(isLikelyIpAddress("999.1.1.1")).toBe(false);
    expect(isLikelyIpAddress("1.2.3")).toBe(false);
    expect(isLikelyIpAddress("1.2.3.4.5")).toBe(false);
  });

  it("accepts IPv6 incl. IPv4-mapped", () => {
    expect(isLikelyIpAddress("2001:db8::1")).toBe(true);
    expect(isLikelyIpAddress("::1")).toBe(true);
    expect(isLikelyIpAddress("::ffff:203.0.113.7")).toBe(true);
  });

  it("rejects arbitrary text so it can never be stored as ip_address", () => {
    expect(isLikelyIpAddress("not-an-ip")).toBe(false);
    expect(isLikelyIpAddress("<script>")).toBe(false);
    expect(isLikelyIpAddress("")).toBe(false);
    expect(isLikelyIpAddress("a".repeat(MAX_IP_LENGTH + 1))).toBe(false);
  });
});

describe("clientIpFromRequest", () => {
  it("does NOT trust the attacker-controlled leftmost x-forwarded-for hop", () => {
    // Attacker injects a spoofed leftmost value; the trusted proxy appends the
    // real client IP to the right. The rightmost valid hop must win.
    const req = reqWith({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" });
    expect(clientIpFromRequest(req)).toBe("203.0.113.9");
  });

  it("cannot be rotated with junk to mint fresh rate-limit buckets", () => {
    // A garbage leftmost hop is skipped; derivation falls to the valid rightmost.
    const req = reqWith({ "x-forwarded-for": "pwned-<rotating>, 198.51.100.4" });
    expect(clientIpFromRequest(req)).toBe("198.51.100.4");
  });

  it("prefers unspoofable edge/CDN headers over x-forwarded-for", () => {
    const req = reqWith({
      "cf-connecting-ip": "203.0.113.50",
      "x-forwarded-for": "1.1.1.1, 9.9.9.9",
    });
    expect(clientIpFromRequest(req)).toBe("203.0.113.50");
  });

  it("falls back to x-real-ip when present", () => {
    const req = reqWith({ "x-real-ip": "192.0.2.44" });
    expect(clientIpFromRequest(req)).toBe("192.0.2.44");
  });

  it("returns null when no header yields a valid IP (never a spoofed string)", () => {
    expect(clientIpFromRequest(reqWith({}))).toBeNull();
    expect(clientIpFromRequest(reqWith({ "x-forwarded-for": "not-an-ip, still-not" }))).toBeNull();
  });

  it("ignores an invalid edge header and keeps scanning", () => {
    const req = reqWith({ "cf-connecting-ip": "garbage", "x-forwarded-for": "203.0.113.77" });
    expect(clientIpFromRequest(req)).toBe("203.0.113.77");
  });
});
