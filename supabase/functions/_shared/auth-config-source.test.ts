import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/**
 * Guards the desired-state Auth config (supabase/config.toml) against the
 * locked product decisions (audit F-011): email/password only, email
 * confirmation ON, no anonymous/social/third-party sign-in. There is no local
 * Supabase stack — the file records intent, and these tests keep a stray edit
 * from silently recording the wrong intent. Hosted parity is verified
 * separately (Dan-gated dashboard review).
 */
describe("auth config — locked product policy guards", () => {
  const config = read("supabase/config.toml");

  /** The body of one [section] up to the next [header] (tolerates comments). */
  function section(name: string): string {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = config.match(new RegExp(`\\[${escaped}\\]([\\s\\S]*?)(?=\\n\\[|$)`));
    expect(match, `config.toml must contain a [${name}] section`).toBeTruthy();
    return match![1];
  }

  it("keeps email confirmation ON (locked decision)", () => {
    expect(section("auth.email")).toMatch(/^\s*enable_confirmations\s*=\s*true\s*$/m);
  });

  it("keeps anonymous sign-ins and manual linking off", () => {
    expect(config).toMatch(/^\s*enable_anonymous_sign_ins\s*=\s*false\s*$/m);
    expect(config).toMatch(/^\s*enable_manual_linking\s*=\s*false\s*$/m);
  });

  it("keeps SMS signup off", () => {
    expect(section("auth.sms")).toMatch(/^\s*enable_signup\s*=\s*false\s*$/m);
  });

  it("keeps every external/social/third-party provider disabled (email/password only)", () => {
    const providerHeaders = [...config.matchAll(
      /^\[(auth\.(?:external|web3|third_party)\.[a-z0-9_]+|auth\.oauth_server)\]/gm,
    )].map((m) => m[1]);
    expect(providerHeaders.length).toBeGreaterThan(0);
    for (const header of providerHeaders) {
      expect(section(header), `[${header}] must stay disabled`).toMatch(/^\s*enabled\s*=\s*false\s*$/m);
    }
  });

  it("requires recent sign-in before password changes", () => {
    expect(section("auth.email")).toMatch(/^\s*secure_password_change\s*=\s*true\s*$/m);
  });

  it("keeps the password minimum in sync with the app's client policy", () => {
    const configMin = Number(config.match(/^\s*minimum_password_length\s*=\s*(\d+)\s*$/m)?.[1]);
    const clientSource = read("lib/auth-password-recovery.ts");
    const clientMin = Number(clientSource.match(/PASSWORD_MIN_LENGTH\s*=\s*(\d+)/)?.[1]);
    expect(clientMin).toBe(8);
    expect(configMin).toBe(clientMin);
  });

  it("enforces the client minimum at signup with the localized reset-screen copy", () => {
    const authLanding = read("app/auth-landing.tsx");
    expect(authLanding).toMatch(/PASSWORD_MIN_LENGTH/);
    expect(authLanding).toMatch(/screenMode === "signup" && pw\.length < PASSWORD_MIN_LENGTH/);
    expect(authLanding).toMatch(/passwordRecovery\.errPasswordMin/);
  });
});
