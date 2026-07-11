import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("native wallet pass — migration (20260811120000)", () => {
  const migration = read("supabase/migrations/20260811120000_wallet_passes.sql");

  it("creates both tables service-role-only: RLS on, no policies, grants revoked from anon+authenticated", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.wallet_passes/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.wallet_pass_registrations/);
    expect(migration).toMatch(/ALTER TABLE public\.wallet_passes ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/ALTER TABLE public\.wallet_pass_registrations ENABLE ROW LEVEL SECURITY/);
    // Supabase lesson 2026-06-10: PUBLIC alone is not enough.
    for (const table of ["wallet_passes", "wallet_pass_registrations"]) {
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        expect(migration).toMatch(new RegExp(`REVOKE ALL ON public\\.${table} FROM ${role}`));
      }
    }
    expect(migration).not.toMatch(/CREATE POLICY|DROP POLICY|CREATE OR REPLACE FUNCTION/i);
  });

  it("stores only the Apple auth-token hash and cascades on account deletion", () => {
    expect(migration).toMatch(/apple_auth_token_hash text/);
    expect(migration).not.toMatch(/apple_auth_token text/);
    expect(migration).toMatch(/REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
  });
});

describe("native wallet pass — sc/ scheme on the redeem path", () => {
  it("redeem-token routes wallet-pass scans to the existing short-code lookup", () => {
    const source = read("supabase/functions/redeem-token/index.ts");
    expect(source).toMatch(/import \{ parseShortCodeScanValue \} from "\.\.\/_shared\/wallet-pass-content\.ts"/);
    expect(source).toMatch(/const walletScanShortCode = parseShortCodeScanValue\(tokenInput\)/);
    expect(source).toMatch(/if \(walletScanShortCode\) shortCodeNorm = walletScanShortCode/);
  });

  it("staff-redemption converts wallet-pass scans before preflight AND the RPC", () => {
    const source = read("supabase/functions/staff-redemption/index.ts");
    expect(source).toMatch(/import \{ parseShortCodeScanValue \} from "\.\.\/_shared\/wallet-pass-content\.ts"/);
    expect(source).toMatch(/parseShortCodeScanValue\(tokenNorm\)/);
    // The RPC must receive the parsed code as p_short_code, never the raw URI as p_token.
    expect(source).toMatch(/: walletScanShortCode\s*\?\s*walletScanShortCode/);
  });
});

describe("native wallet pass — lifecycle sync wiring", () => {
  const lifecycleFunctions = [
    "supabase/functions/claim-deal/index.ts",
    "supabase/functions/redeem-token/index.ts",
    "supabase/functions/complete-visual-redeem/index.ts",
    "supabase/functions/release-claim/index.ts",
    "supabase/functions/finalize-stale-redeems/index.ts",
    "supabase/functions/staff-redemption/index.ts",
  ];

  it("every claim-lifecycle function calls syncWalletPassForUser", () => {
    for (const path of lifecycleFunctions) {
      const source = read(path);
      expect(source, path).toMatch(/import \{ .*syncWalletPassForUser.* \} from "\.\.\/_shared\/wallet-pass-sync\.ts"/);
      expect(source, path).toMatch(/await syncWalletPassForUser\(/);
    }
  });

  it("redeem-token and staff-redemption sync the CUSTOMER's pass, not the scanner's", () => {
    expect(read("supabase/functions/redeem-token/index.ts")).toMatch(
      /syncWalletPassForUser\(supabaseAdmin, \(claim\.user_id/,
    );
    expect(read("supabase/functions/staff-redemption/index.ts")).toMatch(
      /syncWalletPassForUser\(supabaseAdmin, preflightRow\?\.user_id/,
    );
  });

  it("finalize-stale-redeems only syncs when a claim actually changed state", () => {
    expect(read("supabase/functions/finalize-stale-redeems/index.ts")).toMatch(
      /if \(finalizedCount \+ expiredCount > 0\) \{[\s\S]*?syncWalletPassForUser/,
    );
  });
});

describe("native wallet pass — sync helper contract", () => {
  const source = read("supabase/functions/_shared/wallet-pass-sync.ts");

  it("is gated by the NATIVE_WALLET_PASS_ENABLED kill switch and never throws into callers", () => {
    expect(source).toMatch(/Deno\.env\.get\("NATIVE_WALLET_PASS_ENABLED"\) === "true"/);
    expect(source).toMatch(/export async function syncWalletPassForUser[\s\S]*?try \{[\s\S]*?\} catch/);
  });

  it("never logs provider response bodies, save URLs, tokens, or codes", () => {
    expect(source).not.toMatch(/console\.[a-z]+\([^;]*saveUrl/);
    expect(source).not.toMatch(/console\.[a-z]+\([^;]*shortCode/i);
    // Status codes are fine to log; bodies are not.
    expect(source).not.toMatch(/console\.[a-z]+\([^;]*response\.(text|json|body)/);
    expect(source).not.toMatch(/await response\.text\(\)/);
  });

  it("reads Google credentials from secrets, not literals", () => {
    expect(source).toMatch(/Deno\.env\.get\("GOOGLE_WALLET_ISSUER_ID"\)/);
    expect(source).toMatch(/Deno\.env\.get\("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON"\)/);
  });
});

describe("native wallet pass — issue endpoint", () => {
  const source = read("supabase/functions/wallet-pass-issue/index.ts");

  it("requires auth, blocks redeemer sessions, and honors the kill switch", () => {
    expect(source).toMatch(/supabase\.auth\.getUser\(\)/);
    expect(source).toMatch(/isRedeemerUser\(user\)/);
    expect(source).toMatch(/isNativeWalletPassServerEnabled\(\)/);
    expect(source).toMatch(/"feature_disabled"/);
  });

  it("Apple returns 501 until the pkpass spike lands", () => {
    expect(source).toMatch(/body\.platform === "apple"/);
    expect(source).toMatch(/501/);
  });

  it("is registered in supabase/config.toml", () => {
    expect(read("supabase/config.toml")).toMatch(/\[functions\.wallet-pass-issue\]/);
  });
});

describe("native wallet pass — client flag + surfaces", () => {
  it("runtime-env exposes the client flag and the snapshot line", () => {
    const source = read("lib/runtime-env.ts");
    expect(source).toMatch(/export function isNativeWalletPassEnabled\(\): boolean/);
    expect(source).toMatch(/EXPO_PUBLIC_ENABLE_NATIVE_WALLET_PASS/);
  });

  it("eas.json documents the flag as OFF in every profile that lists it", () => {
    const eas = read("eas.json");
    const matches = eas.match(/"EXPO_PUBLIC_ENABLE_NATIVE_WALLET_PASS": "(true|false)"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    for (const match of matches) expect(match).toContain('"false"');
  });

  it("the button renders nothing unless the flag is on and the platform is Android", () => {
    const source = read("components/add-to-wallet-button.tsx");
    expect(source).toMatch(/isNativeWalletPassEnabled\(\) && Platform\.OS === "android"/);
    expect(source).toMatch(/if \(!visible \|\| added !== false\) return null/);
  });

  it("all three locales carry the walletPass strings", () => {
    for (const locale of ["en", "es", "ko"]) {
      const json = JSON.parse(read(`lib/i18n/locales/${locale}.json`)) as Record<string, unknown>;
      const section = json.walletPass as Record<string, string> | undefined;
      expect(section, locale).toBeDefined();
      for (const key of ["addToGoogleWallet", "preparing", "errAdd"]) {
        expect(typeof section?.[key], `${locale}.walletPass.${key}`).toBe("string");
      }
    }
  });
});
