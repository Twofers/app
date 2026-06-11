// Tests for the owner-PIN rotation guard (audit Finding 2, batch R2).
// Lives under lib/ because supabase/functions is deno-checked file-by-file
// and a vitest import would fail there; the modules under test are pure and
// dependency-free, so node's WebCrypto exercises the real code.
import { describe, expect, it } from "vitest";
import { pinRotationRequiresCurrentPin } from "../supabase/functions/_shared/owner-pin-policy";
import { hashPin, normalizePin, verifyPin } from "../supabase/functions/_shared/redemption-crypto";

describe("pinRotationRequiresCurrentPin", () => {
  it("requires the current PIN whenever a hash exists, enabled or not", () => {
    expect(pinRotationRequiresCurrentPin({ pin_hash: "pbkdf2_sha256$120000$salt$digest" })).toBe(true);
  });

  it("allows fresh setup when no hash exists", () => {
    expect(pinRotationRequiresCurrentPin(null)).toBe(false);
    expect(pinRotationRequiresCurrentPin(undefined)).toBe(false);
    expect(pinRotationRequiresCurrentPin({ pin_hash: null })).toBe(false);
    expect(pinRotationRequiresCurrentPin({ pin_hash: "" })).toBe(false);
  });
});

describe("PIN verification backing the rotation guard", () => {
  it("accepts the current PIN and rejects a wrong one against the stored hash", async () => {
    const stored = await hashPin("4321");
    expect(stored.startsWith("pbkdf2_sha256$120000$")).toBe(true);
    expect(await verifyPin("4321", stored)).toBe(true);
    expect(await verifyPin("1234", stored)).toBe(false);
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    expect(await verifyPin("4321", "sha256$not-a-pin-hash")).toBe(false);
    expect(await verifyPin("4321", "")).toBe(false);
  });

  it("normalizes only 4-6 digit PINs (the only inputs the guard verifies)", () => {
    expect(normalizePin(" 4321 ")).toBe("4321");
    expect(normalizePin("123")).toBeNull();
    expect(normalizePin("1234567")).toBeNull();
    expect(normalizePin("12a4")).toBeNull();
    expect(normalizePin(1234)).toBeNull();
  });
});
