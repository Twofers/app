import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { constantTimeEqual } from "./constant-time-equal.ts";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

// Web-attack review 2026-07-31: M-5 (anon read rate limits), L-1/L-2 (CORS), L-3
// (constant-time cron secret), F4 (session TDZ bug).

describe("constantTimeEqual (L-3)", () => {
  it("matches equal strings and rejects differences and length mismatches", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("CORS hardening (L-1, L-2)", () => {
  const cors = read("supabase/functions/_shared/cors.ts");
  it("gates localhost dev origins behind ALLOW_LOCALHOST_CORS (L-1)", () => {
    expect(cors).toMatch(/ALLOW_LOCALHOST_CORS/);
    expect(cors).toMatch(/DEV_ORIGINS/);
  });
  it("emits Vary: Origin (L-2)", () => {
    expect(cors).toMatch(/"Vary": "Origin"/);
  });
});

describe("anon read rate limits (M-5)", () => {
  const fns = ["business-activation-status", "deal-share-lookup", "qr-campaign-redirect"];
  for (const fn of fns) {
    it(`${fn} enforces an anon read rate limit`, () => {
      const source = read(`supabase/functions/${fn}/index.ts`);
      expect(source).toMatch(/enforceAnonReadRateLimit/);
      expect(source).toMatch(/from "\.\.\/_shared\/anon-read-rate-limit\.ts"/);
    });
  }
  it("the shared limiter fails open (never blocks a public read on missing config/error)", () => {
    const helper = read("supabase/functions/_shared/anon-read-rate-limit.ts");
    expect(helper).toMatch(/if \(!actorHash\) return \{ limited: false \}/);
    // On RPC error it returns limited:false (fail open), not a throw.
    expect(helper).toMatch(/return \{ limited: false \}/);
  });
});

describe("cron secret constant-time compare (L-3)", () => {
  for (const fn of ["weekly-deal-digest", "send-trial-ending-reminders", "expire-billing-access"]) {
    it(`${fn} no longer compares the cron secret with ===`, () => {
      const source = read(`supabase/functions/${fn}/index.ts`);
      expect(source).toMatch(/constantTimeEqual\(provided, envSecret\)/);
      expect(source).not.toMatch(/provided === envSecret/);
    });
  }
});

describe("admin session non-MFA login (F4)", () => {
  it("issues a fresh session without reading the not-yet-declared `pending`", () => {
    const source = read("website/api/admin/session.js");
    expect(source).not.toMatch(/issued_at: pending\.issued_at/);
    expect(source).toMatch(/setState\(res, sessionState\(payload\.session\)\);/);
  });
});
