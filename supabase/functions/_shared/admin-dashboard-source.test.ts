import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("admin dashboard foundation", () => {
  it("creates admin allowlist, audit, and publish eligibility primitives", () => {
    const migration = read("supabase/migrations/20260730125000_admin_dashboard_foundation.sql");
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.admin_users/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.admin_audit_log/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.admin_notes/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.launch_areas/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.feature_flags/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.can_business_publish/i);
    expect(migration).toMatch(/location_entitlements/i);
    expect(migration).toMatch(/ALTER TABLE public\.admin_users ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.admin_audit_log FROM anon, authenticated/i);
    expect(migration).toMatch(/GRANT SELECT, INSERT ON TABLE public\.admin_audit_log TO service_role/i);
  });

  it("requires an active admin user and writes audit logs in the summary function", () => {
    const source = read("supabase/functions/admin-dashboard-summary/index.ts");
    expect(source).toMatch(/auth\.getUser/);
    expect(source).toMatch(/from\("admin_users"\)/);
    expect(source).toMatch(/!adminUser\?\.is_active/);
    expect(source).toMatch(/hasReadableAdminRole/);
    expect(source).toMatch(/admin_dashboard_denied/);
    expect(source).toMatch(/admin_dashboard_summary_viewed/);
    expect(source).toMatch(/from\("admin_audit_log"\)\.insert/);
    expect(source).toMatch(/location_entitlements/);
    expect(source).not.toMatch(/STRIPE_SECRET_KEY/);
    expect(source).not.toMatch(/OPENAI_API_KEY/);
  });

  it("registers the admin summary edge function", () => {
    const config = read("supabase/config.toml");
    expect(config).toMatch(
      /\[functions\.admin-dashboard-summary\][\s\S]*verify_jwt\s*=\s*false[\s\S]*entrypoint\s*=\s*"\.\/functions\/admin-dashboard-summary\/index\.ts"/,
    );
  });
});
