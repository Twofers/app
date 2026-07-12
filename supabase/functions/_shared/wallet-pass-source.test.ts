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

describe("native wallet pass — Apple pkpass (part 1)", () => {
  it("apple-pkpass signs with node-forge (SHA-256 detached) + zips with fflate", () => {
    const source = read("supabase/functions/_shared/apple-pkpass.ts");
    expect(source).toMatch(/import forge from "https:\/\/esm\.sh\/node-forge@/);
    expect(source).toMatch(/import \{ zipSync \} from "https:\/\/esm\.sh\/fflate@/);
    expect(source).toMatch(/createSignedData\(\)/);
    expect(source).toMatch(/digestAlgorithm: forge\.pki\.oids\.sha256/);
    expect(source).toMatch(/p7\.sign\(\{ detached: true \}\)/);
    // manifest is SHA-1 per PassKit spec; signature is over manifest.json
    expect(source).toMatch(/sha1/);
    expect(source).toMatch(/files\["signature"\] = signManifest/);
  });

  it("apple signing secrets are read in the shared env module", () => {
    const source = read("supabase/functions/_shared/apple-pass-env.ts");
    expect(source).toMatch(/APPLE_PASS_CERT_PEM_B64/);
    expect(source).toMatch(/APPLE_PASS_KEY_PEM_B64/);
    expect(source).toMatch(/APPLE_WWDR_CERT_PEM_B64/);
  });

  it("apple-wallet-issue is kill-switch gated and mints a stable serial", () => {
    const source = read("supabase/functions/_shared/apple-wallet-issue.ts");
    expect(source).toMatch(/isNativeWalletPassServerEnabled\(\)/);
    // reuse existing serial, else mint one
    expect(source).toMatch(/apple_serial_number.*\?\?.*crypto\.randomUUID\(\)/s);
  });

  it("wallet-pass-issue returns a real .pkpass for the apple platform (no more 501)", () => {
    const source = read("supabase/functions/wallet-pass-issue/index.ts");
    expect(source).toMatch(/issueAppleWalletPass\(/);
    expect(source).toMatch(/application\/vnd\.apple\.pkpass/);
    expect(source).not.toMatch(/Apple Wallet support is coming soon/);
  });

  it("never logs the Apple private key or cert secrets", () => {
    for (const p of ["supabase/functions/_shared/apple-wallet-issue.ts", "supabase/functions/_shared/apple-pkpass.ts"]) {
      const source = read(p);
      expect(source, p).not.toMatch(/console\.[a-z]+\([^;]*keyPem/);
      expect(source, p).not.toMatch(/console\.[a-z]+\([^;]*PEM_B64/);
    }
  });
});

describe("native wallet pass — Apple auto-update (part 2)", () => {
  it("web service implements the PassKit endpoints with ApplePass auth", () => {
    const source = read("supabase/functions/wallet-pass-webservice/index.ts");
    expect(source).toMatch(/registrations/);
    expect(source).toMatch(/passesUpdatedSince/);
    expect(source).toMatch(/wallet_pass_registrations/);
    expect(source).toMatch(/v1\\\/log/); // the /v1/log route (escaped in a regex literal)
    expect(source).toMatch(/parseApplePassAuthHeader/);
    expect(source).toMatch(/timingSafeEqualStrings/);
    expect(source).toMatch(/application\/vnd\.apple\.pkpass/);
  });

  it("web service is registered with verify_jwt=false (Apple calls it directly)", () => {
    const cfg = read("supabase/config.toml");
    expect(cfg).toMatch(/\[functions\.wallet-pass-webservice\]/);
    expect(cfg).toMatch(/\[functions\.wallet-pass-webservice\][\s\S]*?verify_jwt = false/);
  });

  it("get-pass builds without bumping updated_at (no version feedback loop)", () => {
    const source = read("supabase/functions/_shared/apple-wallet-issue.ts");
    expect(source).toMatch(/export async function buildAppleWalletPassBytes/);
    // the DB-writing issue path is separate from the pure builder
    expect(source).toMatch(/buildAppleWalletPassBytes\(supabaseAdmin, userId, serialNumber/);
  });

  it("APNs push uses the pass-cert mTLS and drops dead device tokens", () => {
    const apns = read("supabase/functions/_shared/apple-apns.ts");
    expect(apns).toMatch(/Deno\.createHttpClient\(\{ cert/);
    expect(apns).toMatch(/apns-topic/);
    expect(apns).toMatch(/BadDeviceToken|Unregistered/);
    const sync = read("supabase/functions/_shared/wallet-pass-sync.ts");
    expect(sync).toMatch(/sendApnsUpdatePush/);
    expect(sync).toMatch(/shouldUnregister/);
    // Apple sync bumps the version so the device re-fetch sees new content
    expect(sync).toMatch(/apple_serial_number/);
  });

  it("issued Apple passes carry the webServiceURL + stable HMAC token", () => {
    const issue = read("supabase/functions/_shared/apple-wallet-issue.ts");
    expect(issue).toMatch(/deriveAppleAuthToken/);
    expect(issue).toMatch(/getWalletWebServiceUrl/);
    const passJson = read("supabase/functions/_shared/apple-pass-json.ts");
    expect(passJson).toMatch(/webServiceURL/);
    expect(passJson).toMatch(/authenticationToken/);
  });
});

describe("native wallet pass — client flag + surfaces", () => {
  it("runtime-env exposes the client flag and the snapshot line", () => {
    const source = read("lib/runtime-env.ts");
    expect(source).toMatch(/export function isNativeWalletPassEnabled\(\): boolean/);
    expect(source).toMatch(/EXPO_PUBLIC_ENABLE_NATIVE_WALLET_PASS/);
  });

  // Native wallet pass is enabled for the launch build (owner decision 2026-07-11).
  // Guard flipped to enforce ON so a shipping profile cannot silently regress to off.
  it("eas.json documents the flag as ON in every profile that lists it", () => {
    const eas = read("eas.json");
    const matches = eas.match(/"EXPO_PUBLIC_ENABLE_NATIVE_WALLET_PASS": "(true|false)"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    for (const match of matches) expect(match).toContain('"true"');
  });

  it("the button is flag-gated and branches iOS (Apple) vs Android (Google)", () => {
    const source = read("components/add-to-wallet-button.tsx");
    expect(source).toMatch(/isNativeWalletPassEnabled\(\) && \(isApple \|\| isGoogle\)/);
    expect(source).toMatch(/if \(!visible\) return null/);
    // Apple path: fetch pkpass -> native system button -> PassKit add controller.
    expect(source).toMatch(/fetchAppleWalletPassBase64/);
    expect(source).toMatch(/AppleWalletPassButton/);
    expect(source).toMatch(/presentAppleWalletPass/);
    expect(source).not.toMatch(/Sharing\.shareAsync/);

    const nativeModule = read("modules/twofer-passkit/ios/TwoferPassKitModule.swift");
    const nativeButton = read("modules/twofer-passkit/ios/TwoferPassKitButtonView.swift");
    expect(nativeModule).toMatch(/PKAddPassesViewController\(pass: pass\)/);
    expect(nativeButton).toMatch(/PKAddPassButton\(addPassButtonStyle: \.black\)/);
  });

  it("all three locales carry the Apple button label", () => {
    for (const locale of ["en", "es", "ko"]) {
      const json = JSON.parse(read(`lib/i18n/locales/${locale}.json`)) as { walletPass?: Record<string, string> };
      expect(typeof json.walletPass?.addToAppleWallet, `${locale}.walletPass.addToAppleWallet`).toBe("string");
    }
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
