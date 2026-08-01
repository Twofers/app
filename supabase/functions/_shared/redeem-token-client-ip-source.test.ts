import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

// Web-attack review 2026-07-31, finding H-1: redeem-token derived the client IP
// from the LEFTMOST x-forwarded-for hop, which the caller controls. Rotating that
// value per request kept every failure in a fresh per-IP bucket, so the lockout
// never tripped. This pins the fix: the trusted helper is used, the spoofable
// pattern is gone, and a client-independent business ceiling backstops rotation.
describe("redeem-token client IP hardening (H-1)", () => {
  const source = read("supabase/functions/redeem-token/index.ts");

  it("derives the client IP from the trusted shared helper", () => {
    expect(source).toMatch(/import\s*\{\s*clientIpFromRequest\s*\}\s*from\s*"\.\.\/_shared\/client-ip\.ts"/);
    expect(source).toMatch(/const clientIp = clientIpFromRequest\(req\)/);
  });

  it("no longer trusts the leftmost x-forwarded-for hop", () => {
    // The old attacker-controlled derivation split XFF and took index 0.
    expect(source).not.toMatch(/x-forwarded-for["']\)[\s\S]*?\.split\(","\)\[0\]/);
  });

  it("keeps a client-independent business failure ceiling that ignores ip_address", () => {
    expect(source).toMatch(/BUSINESS_FAILURE_CEILING/);
    // The ceiling query must NOT filter on ip_address, or rotation would evade it.
    const ceilingBlock = source.slice(source.indexOf("BUSINESS_FAILURE_CEILING"));
    const nextIpFilter = ceilingBlock.indexOf('.eq("ip_address"');
    expect(nextIpFilter === -1).toBe(true);
  });
});
