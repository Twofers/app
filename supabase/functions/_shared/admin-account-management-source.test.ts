import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("admin account management", () => {
  it("adds protected lifecycle state and a service-role-only auth directory", () => {
    const migration = read("supabase/migrations/20260823120000_admin_account_management.sql");
    expect(migration).toMatch(/account_status IN \('active', 'suspended', 'archived'\)/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.account_lifecycle_state/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.protect_profile_account_lifecycle/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_account_directory/i);
    expect(migration).toMatch(/FROM auth\.users u/i);
    expect(migration).toMatch(/raw_app_meta_data ->> 'app_role'[\s\S]+<> 'redeemer'/);
    expect(migration).toMatch(/LEFT JOIN public\.admin_users au/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_account_directory[\s\S]+TO service_role/i);
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_account_directory[\s\S]+TO (?:anon|authenticated)/i);
  });

  it("hides suspended/archived businesses and their live deals from public discovery", () => {
    const migration = read("supabase/migrations/20260823120000_admin_account_management.sql");
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.is_public_business_status/);
    expect(migration).not.toMatch(/p_status NOT IN \('draft', 'pending_verification', 'rejected'\)/);
    expect(migration).toMatch(/CREATE POLICY "businesses_public_read"[\s\S]+user_has_business_claim/);
    expect(migration).toMatch(/CREATE POLICY "deals_public_read"[\s\S]+is_publicly_visible_business\(business_id\)/);
  });

  it("requires the centralized founder guard, role gates, reasons, and typed reversible confirmations", () => {
    const source = read("supabase/functions/admin-account-management/index.ts");
    expect(source).toMatch(/requireAdmin\(req, requestId, "prospect\.read"\)/);
    expect(source).toMatch(/LIFECYCLE_ROLES/);
    expect(source).toMatch(/reason\.length < 5/);
    expect(source).toMatch(/payload\.confirmation !== "ARCHIVE"/);
    expect(source).toMatch(/isFreshTotp\(bearerToken\)/);
    expect(source).toMatch(/admin_account_protected/);
    expect(source).not.toMatch(/permanent_delete/);
    expect(source).not.toMatch(/auth\.admin\.listUsers/);
  });

  it("makes suspension and archival reversible and removes admin deletion", () => {
    const source = read("supabase/functions/admin-account-management/index.ts");
    expect(source).toMatch(/ban_duration: "876000h"/);
    expect(source).toMatch(/ban_duration: "none"/);
    expect(source).toMatch(/account_lifecycle_state/);
    expect(source).toMatch(/previous_active_deal_ids/);
    expect(source).toMatch(/cancelStripeForBusinesses/);
    expect(source).not.toMatch(/purge_user_data/);
    expect(source).not.toMatch(/deleteAuthUserWithRetry/);
  });

  it("ties self-service deletion to Stripe before purge", () => {
    const source = read("supabase/functions/delete-user-account/index.ts");
    const cancel = source.indexOf("await cancelStripeForBusinesses");
    const purge = source.indexOf('rpc("purge_user_data"');
    expect(cancel).toBeGreaterThan(-1);
    expect(purge).toBeGreaterThan(cancel);
    expect(source).toMatch(/error_code: "billing_cancel_failed"/);
    expect(source).toMatch(/consume_account_deletion_attempt/);
    expect(source).toMatch(/p_global_max: 50/);
    expect(source).toMatch(/error_code: "deletion_rate_limited"/);
  });

  it("ships one searchable UI for both roles with safe lifecycle wording", () => {
    const page = read("website/admin/accounts/index.html");
    const script = read("website/admin/accounts.js");
    expect(page).toMatch(/Business and customer directory/);
    expect(page).toMatch(/Archive &amp; cancel Stripe/);
    expect(page).toMatch(/Permanent deletion is not available/);
    expect(page).toMatch(/Reason for edit/);
    expect(script).toMatch(/action: "list"/);
    expect(script).toMatch(/action: "detail"/);
    expect(script).toMatch(/action: "update_profile"/);
    expect(script).toMatch(/Type ARCHIVE/);
    expect(script).not.toMatch(/permanent_delete|Type DELETE/);
    expect(script).not.toMatch(/STRIPE_SECRET_KEY|service_role/i);
  });

  it("registers the account management Edge Function", () => {
    const config = read("supabase/config.toml");
    expect(config).toMatch(
      /\[functions\.admin-account-management\][\s\S]*verify_jwt\s*=\s*false[\s\S]*entrypoint\s*=\s*"\.\/functions\/admin-account-management\/index\.ts"/,
    );
  });

  it("ships the audited account-repair actions without exposing generated links", () => {
    const source = read("supabase/functions/admin-account-management/index.ts");
    const page = read("website/admin/account-repair/index.html");
    const script = read("website/admin/account-repair.js");
    expect(source).toMatch(/"send_password_reset"/);
    expect(source).toMatch(/"resend_verification"/);
    expect(source).toMatch(/"reset_mfa"/);
    expect(source).toMatch(/"correct_email"/);
    expect(source).toMatch(/"extend_trial"/);
    expect(source).toMatch(/"unlock"/);
    expect(source).toMatch(/auth\.admin\.generateLink/);
    expect(source).toMatch(/auth\.admin\.mfa\.deleteFactor/);
    expect(source).toMatch(/applyBusinessBillingAccessState/);
    expect(source).toMatch(/failed_redeem_attempts/);
    expect(source).not.toMatch(/action_link:\s*actionLink/);
    expect(page).toMatch(/Account Repair/);
    expect(page).toMatch(/merchant can claim a business only when the login email matches/i);
    expect(script).toMatch(/RESET MFA/);
    expect(script).toMatch(/CONFIRM EMAIL/);
    expect(script).toMatch(/SUSPEND/);
  });
});
