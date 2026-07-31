import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("external admin security alerts", () => {
  it("uses a separate configured destination and never returns provider bodies", () => {
    const source = read("supabase/functions/_shared/admin-security-alert.ts");
    expect(source).toMatch(/ADMIN_SECURITY_ALERT_EMAIL/);
    expect(source).toMatch(/RESEND_API_KEY/);
    expect(source).toContain("https://api.resend.com/emails");
    expect(source).not.toMatch(/response\.(?:json|text)\(/);
  });

  it("alerts on login, MFA verification, and lifecycle actions", () => {
    const auth = read("supabase/functions/admin-auth-session/index.ts");
    const accounts = read("supabase/functions/admin-account-management/index.ts");
    expect(auth).toMatch(/event: "admin_login_success"/);
    expect(auth).toMatch(/event: "admin_mfa_verified"/);
    expect(accounts).toMatch(/event: `admin_account_\$\{action\}`/);
  });
});
