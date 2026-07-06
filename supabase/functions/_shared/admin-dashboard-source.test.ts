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

  it("uses the canonical admin redemption facts view for redemption metrics", () => {
    const source = read("supabase/functions/admin-dashboard-summary/index.ts");
    expect(source).toMatch(/redemptionsToday/);
    expect(source).toMatch(/from\("admin_redemption_facts_v1"\)[\s\S]+select\("claim_id", \{ count: "exact", head: true \}\)[\s\S]+gte\("redeemed_at"/);
    expect(source).toMatch(/from\("deal_claims"\)[\s\S]+select\("id", \{ count: "exact", head: true \}\)[\s\S]+gte\("created_at"/);
    expect(source).not.toMatch(/from\("deal_claims"\)[\s\S]+not\("redeemed_at", "is", null\)/);
  });

  it("registers the admin summary edge function", () => {
    const config = read("supabase/config.toml");
    expect(config).toMatch(
      /\[functions\.admin-dashboard-summary\][\s\S]*verify_jwt\s*=\s*false[\s\S]*entrypoint\s*=\s*"\.\/functions\/admin-dashboard-summary\/index\.ts"/,
    );
  });

  it("adds AI spend reporting and admin quota resets", () => {
    const summarySource = read("supabase/functions/admin-dashboard-summary/index.ts");
    const usageSource = read("supabase/functions/admin-ai-usage/index.ts");
    const resetMigration = read("supabase/migrations/20260730128000_admin_ai_quota_resets.sql");
    const adminPage = read("website/admin/index.html");
    const adminScript = read("website/admin/admin.js");
    const config = read("supabase/config.toml");

    expect(summarySource).toMatch(/ai_generation_cost_daily/);
    expect(summarySource).toMatch(/apiSpend/);
    expect(resetMigration).toMatch(/CREATE TABLE IF NOT EXISTS public\.admin_ai_quota_resets/i);
    expect(resetMigration).toMatch(/CREATE OR REPLACE FUNCTION public\.ai_compose_quota_status/i);
    expect(usageSource).toMatch(/admin_ai_quota_reset/);
    expect(usageSource).toMatch(/countAiQuotaUsage/);
    expect(usageSource).toMatch(/business_members/);
    expect(adminPage).toMatch(/data-admin-ai-usage-endpoint/);
    expect(adminPage).toMatch(/AI Spend & Quotas/);
    expect(adminPage).toMatch(/data-ai-reset-button disabled/);
    expect(adminScript).toMatch(/reset_quota/);
    expect(adminScript).toMatch(/syncAiResetState/);
    expect(config).toMatch(
      /\[functions\.admin-ai-usage\][\s\S]*verify_jwt\s*=\s*false[\s\S]*entrypoint\s*=\s*"\.\/functions\/admin-ai-usage\/index\.ts"/,
    );
  });

  it("enforces admin_users.require_mfa (aal2) at every admin endpoint, not just login", () => {
    const mfaHelper = read("supabase/functions/_shared/admin-mfa.ts");
    expect(mfaHelper).toMatch(/export function decodeJwtAal/);
    expect(mfaHelper).toMatch(/export function isAal2/);
    expect(mfaHelper).toMatch(/export function verifiedTotpFactor/);

    const authSession = read("supabase/functions/admin-auth-session/index.ts");
    expect(authSession).toMatch(/mfa_enroll/);
    expect(authSession).toMatch(/mfa_verify/);
    expect(authSession).toMatch(/mfa_required/);
    expect(authSession).toMatch(/mfa_enrollment_required/);
    expect(authSession).toMatch(/decodeJwtAal/);

    for (const fn of [
      "supabase/functions/admin-dashboard-summary/index.ts",
      "supabase/functions/admin-ai-usage/index.ts",
      "supabase/functions/admin-business-applications/index.ts",
    ]) {
      const source = read(fn);
      expect(source, `${fn} must import isAal2`).toMatch(/isAal2/);
      expect(source, `${fn} must select require_mfa`).toMatch(/require_mfa/);
      expect(source, `${fn} must reject aal1 sessions for require_mfa admins`).toMatch(
        /adminUser\.require_mfa\s*&&\s*!isAal2\(/,
      );
    }

    const loginPage = read("website/admin/login/index.html");
    expect(loginPage).toMatch(/data-mfa-panel/);
    expect(loginPage).toMatch(/data-mfa-code/);

    const loginScript = read("website/admin/admin-login.js");
    expect(loginScript).toMatch(/mfa_enroll/);
    expect(loginScript).toMatch(/mfa_verify/);
    expect(loginScript).toMatch(/beginEnrollment/);
    expect(loginScript).toMatch(/beginStepUp/);
  });

  it("serves audited per-tab reads for every admin directory page", () => {
    const source = read("supabase/functions/admin-dashboard-summary/index.ts");
    expect(source).toMatch(/SECTION_NAMES = \[[\s\S]*"businesses"[\s\S]*"offers"[\s\S]*"billing_events"[\s\S]*"audit_log"[\s\S]*"settings"[\s\S]*"business_detail"[\s\S]*"prospects"[\s\S]*"prospect_detail"[\s\S]*\]/);
    expect(source).toMatch(/isSectionName\(payload\.section\)/);
    // Section reads must be audited the same way as the summary view.
    expect(source).toMatch(/admin_\$\{payload\.section\}_viewed/);
    // Admin-user management is sensitive; only owner/admin should see the allowlist.
    expect(source).toMatch(/canViewAdminUsers = adminUser\.role === "owner" \|\| adminUser\.role === "admin"/);
    expect(source).toMatch(/admin_users_visible/);
    expect(source).not.toMatch(/OPENAI_API_KEY|STRIPE_SECRET_KEY/);

    for (const [page, script] of [
      ["website/admin/businesses/index.html", null],
      ["website/admin/offers/index.html", null],
      ["website/admin/billing/events/index.html", null],
      ["website/admin/audit-log/index.html", null],
      ["website/admin/settings/index.html", null],
      ["website/admin/businesses/detail/index.html", null],
    ] as const) {
      const html = read(page);
      expect(html, `${page} must post to the admin summary endpoint`).toMatch(/data-admin-summary-endpoint/);
      expect(html, `${page} must declare its section`).toMatch(/data-admin-section=/);
      expect(html, `${page} must load the shared directory script`).toMatch(/\/admin\/admin-directory\.js/);
      void script;
    }

    const directoryScript = read("website/admin/admin-directory.js");
    expect(directoryScript).toMatch(/section === "business_detail"/);
    expect(directoryScript).toMatch(/clearSession/);
    expect(directoryScript).toMatch(/401.*403|403.*401|status === 401 \|\| response\.status === 403/);
  });

  it("computes offer status from start/end timestamps, not stored is_active alone", () => {
    const source = read("supabase/functions/admin-dashboard-summary/index.ts");

    // A single effective-status helper must exist so the offers list, the
    // aggregate Business Health list, and the Business Detail drilldown can
    // never disagree with each other about what "live" means.
    expect(source).toMatch(/function offerEffectiveStatus\(/);
    expect(source).toMatch(/end && end\.getTime\(\) <= now\.getTime\(\)\) return "expired"/);
    expect(source).toMatch(/start && start\.getTime\(\) > now\.getTime\(\)\) return "scheduled"/);

    // The raw offers-section query must no longer be trusted as-is; it has to
    // run every row through the shared helper before returning it.
    expect(source).toMatch(/effective_status: offerEffectiveStatus\(row, now\)/);

    // The aggregate and per-business health calculators must derive
    // isCurrent/isScheduled from the same helper instead of duplicating
    // is_active-only date math.
    const offerStatusUses = source.match(/offerEffectiveStatus\(deal, now\)/g) ?? [];
    expect(offerStatusUses.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toMatch(/deal\.is_active === true && \(!end \|\| end\.getTime\(\)/);

    const directoryScript = read("website/admin/admin-directory.js");
    // The Offers page must filter and render effective status, not raw is_active,
    // so an expired offer can never display or filter as Live.
    expect(directoryScript).toMatch(/getValue: \(r\) => r\.effective_status \|\| "inactive"/);
    expect(directoryScript).toMatch(/value: "expired", label: "Expired"/);
    expect(directoryScript).toMatch(/offerStatusBadge\(r\.effective_status\)/);
    expect(directoryScript).not.toMatch(/r\.is_active \? "Live" : "Inactive"/);
  });

  it("treats current app access as canonical and flags stale trial-request records on the business detail page", () => {
    const source = read("supabase/functions/admin-dashboard-summary/index.ts");

    // Current access must be read from business_subscriptions.app_access_status, never
    // from the business_applications decision record, which is written once and never
    // updated after a later cancellation/expiration.
    expect(source).toMatch(/const canonicalAppAccessStatus = \(subscription\?\.app_access_status as string \| undefined\) \?\? null/);
    expect(source).toMatch(/const activeTrial = canonicalAppAccessStatus === "trialing" \|\| canonicalAppAccessStatus === "trial_limited"/);

    // Trial timing must only be surfaced while the canonical status is actually trialing,
    // so a canceled business can never show a stale "N days left".
    expect(source).toMatch(/trial_ends_at: activeTrial \? trialEnd : null/);
    expect(source).toMatch(/trial_days_remaining: activeTrial \? trialDaysRemaining : null/);

    // A mismatch between the (stale) application record and canonical access must be
    // surfaced explicitly rather than silently trusting the application row.
    expect(source).toMatch(/const accessMismatch = accessIsNonCurrent && Boolean\(applicationStatus\)/);
    expect(source).toMatch(/access_mismatch: accessMismatch/);
    expect(source).toMatch(/access_mismatch_note: accessMismatch/);

    const detailPage = read("website/admin/businesses/detail/index.html");
    expect(detailPage).toMatch(/data-access-mismatch-warning/);
    expect(detailPage).toMatch(/Current app access status/);
    expect(detailPage).toMatch(/Trial request status \(history\)/);

    const directoryScript = read("website/admin/admin-directory.js");
    // The Applications table must be relabeled so a stale request-level status
    // (e.g. "trial_active") is never confused with current access.
    expect(directoryScript).toMatch(/label: "Request status"/);
    expect(directoryScript).toMatch(/label: "Requested access"/);
    expect(directoryScript).toMatch(/label: "Approved trial days"/);
    expect(directoryScript).toMatch(/data-access-mismatch-warning/);
    expect(directoryScript).toMatch(/access_mismatch_note/);
  });
});
