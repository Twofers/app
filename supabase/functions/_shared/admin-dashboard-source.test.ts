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
    const guard = read("supabase/functions/_shared/admin-prospects.ts");
    expect(source).toMatch(/requireAdmin\(req, requestId, "prospect\.read"\)/);
    expect(guard).toMatch(/auth\.getUser/);
    expect(guard).toMatch(/from\("admin_users"\)/);
    expect(guard).toMatch(/!adminUser\?\.is_active/);
    expect(guard).toMatch(/isFounderAdminUser/);
    expect(guard).toMatch(/admin_founder_access_denied/);
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
    // The dashboard IA lives in the token-gated fragment (audit F-015), not
    // the signed-out /admin shell.
    const adminPage = read("website/admin/app.html");
    const adminScript = read("website/admin/admin.js");
    const adminShell = read("website/admin/admin-shell.js");
    const config = read("supabase/config.toml");

    expect(summarySource).toMatch(/ai_generation_cost_daily/);
    expect(summarySource).toMatch(/apiSpend/);
    expect(resetMigration).toMatch(/CREATE TABLE IF NOT EXISTS public\.admin_ai_quota_resets/i);
    expect(resetMigration).toMatch(/CREATE OR REPLACE FUNCTION public\.ai_compose_quota_status/i);
    expect(usageSource).toMatch(/admin_ai_quota_reset/);
    expect(usageSource).toMatch(/countAiQuotaUsage/);
    expect(usageSource).toMatch(/business_members/);
    // Owner email lookup must use the direct RPC, never auth.admin.listUsers,
    // which 500s ("Database error finding users") on malformed auth.users rows.
    expect(usageSource).not.toMatch(/auth\.admin\.listUsers/);
    expect(usageSource).toMatch(/admin_user_id_by_email/);
    const emailRpcMigration = read(
      "supabase/migrations/20260808130000_admin_user_id_by_email_rpc.sql",
    );
    expect(emailRpcMigration).toMatch(
      /create or replace function public\.admin_user_id_by_email/i,
    );
    expect(emailRpcMigration).toMatch(/security definer/i);
    expect(emailRpcMigration).toMatch(
      /grant execute on function public\.admin_user_id_by_email\(text\) to service_role/i,
    );
    expect(adminShell).toMatch(/adminAiUsageEndpoint: "admin-ai-usage"/);
    expect(adminPage).toMatch(/data-ops-metric="ai"/);
    expect(adminPage).not.toMatch(/data-ai-reset-button/);
    expect(adminScript).toMatch(/perGeneratedDealUsd/);
    expect(config).toMatch(
      /\[functions\.admin-ai-usage\][\s\S]*verify_jwt\s*=\s*false[\s\S]*entrypoint\s*=\s*"\.\/functions\/admin-ai-usage\/index\.ts"/,
    );
  });

  it("keeps the signed-out /admin shell minimal (audit F-015)", () => {
    const shell = read("website/admin/index.html");
    // Stays non-indexable and carries the injection root for the dashboard.
    expect(shell).toMatch(/noindex,nofollow/);
    expect(shell).toMatch(/data-admin-app-root/);
    // No internal IA, queue names, or admin endpoint config may ship signed out.
    for (const leaked of [
      /Prospects/,
      /Business Access/,
      /Sales AI/,
      /AI Spend/,
      /audit-log/,
      /billing\/events/,
      /ai-prompts/,
      /ai-operating-report/,
      /data-admin-summary-endpoint/,
      /data-admin-auth-endpoint/,
      /data-admin-ai-usage-endpoint/,
    ]) {
      expect(shell, `signed-out shell must not contain ${leaked}`).not.toMatch(leaked);
    }

    // The dashboard fragment carries the IA, while endpoint config lives in
    // the shared external shell and is fetched only after the token gate.
    const fragment = read("website/admin/app.html");
    expect(fragment).toMatch(/data-admin-app/);
    expect(fragment).not.toMatch(/data-admin-[a-z0-9-]+-endpoint/);
    expect(fragment).toMatch(/Twofer Admin/);
    expect(fragment).not.toMatch(/<script/i);
    const sharedShell = read("website/admin/admin-shell.js");
    expect(sharedShell).toMatch(/SUPABASE_FN_BASE/);
    expect(sharedShell).toMatch(/adminSummaryEndpoint: "admin-dashboard-summary"/);

    const script = read("website/admin/admin.js");
    const tokenGate = script.indexOf("await Shell.getAccessToken()");
    const fragmentFetch = script.indexOf('fetch("/admin/app.html"');
    expect(tokenGate).toBeGreaterThan(-1);
    expect(fragmentFetch).toBeGreaterThan(-1);
    expect(script).toMatch(/if \(!\(await Shell\.getAccessToken\(\)\)\) return/);

    // Robots/CSP headers for /admin(.*) must persist so the fragment inherits
    // noindex and inline scripts stay blocked.
    const vercel = read("website/vercel.json");
    expect(vercel).toMatch(/X-Robots-Tag/);
    expect(vercel).toMatch(/script-src 'self'/);
  });

  it("enforces founder-only mandatory MFA through the shared guard", () => {
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

    const sharedGuard = read("supabase/functions/_shared/admin-prospects.ts");
    expect(sharedGuard).toMatch(/isFounderAdminUser/);
    expect(sharedGuard).toMatch(/adminUser\.require_mfa !== true/);
    expect(sharedGuard).toMatch(/!isAal2\(bearerToken\)/);

    for (const fn of [
      "supabase/functions/admin-dashboard-summary/index.ts",
      "supabase/functions/admin-ai-usage/index.ts",
      "supabase/functions/admin-business-applications/index.ts",
    ]) {
      const source = read(fn);
      expect(source, `${fn} must use the centralized guard`).toMatch(/requireAdmin\(/);
    }

    const loginPage = read("website/admin/login/index.html");
    expect(loginPage).toMatch(/data-mfa-panel/);
    expect(loginPage).toMatch(/data-mfa-code/);
    expect(loginPage).not.toMatch(/name="remember"/);

    const browserSession = read("website/server/admin-session.js");
    expect(browserSession).toMatch(/__Host-twofer_admin_session/);
    expect(browserSession).toMatch(/HttpOnly/);
    expect(browserSession).toMatch(/Secure/);
    expect(browserSession).toMatch(/SameSite=Strict/);
    expect(browserSession).toMatch(/aes-256-gcm/);
    expect(browserSession).toMatch(/MAX_COOKIE_AGE_SECONDS = 60 \* 60 \* 8/);
    expect(browserSession).toMatch(/absolute_expires_at/);
    expect(browserSession).not.toMatch(/Domain=/);

    const sessionEndpoint = read("website/api/admin/session.js");
    // Web-attack review 2026-07-31, F4: the non-MFA login path must issue a FRESH
    // session and must NOT read `pending` before its declaration (a temporal-dead-
    // zone ReferenceError, and semantically wrong on a fresh login).
    expect(sessionEndpoint).toMatch(/setState\(res, sessionState\(payload\.session\)\);/);
    expect(sessionEndpoint).not.toMatch(/issued_at: pending\.issued_at/);

    const loginScript = read("website/admin/admin-login.js");
    const shellScript = read("website/admin/admin-shell.js");
    expect(loginScript).not.toMatch(/localStorage|sessionStorage|access_token|refresh_token/);
    expect(shellScript).not.toMatch(/localStorage|twofer_admin_access_token|twofer_admin_refresh_token/);

    expect(loginScript).toMatch(/mfa_enroll/);
    expect(loginScript).toMatch(/mfa_verify/);
    expect(loginScript).toMatch(/beginEnrollment/);
    expect(loginScript).toMatch(/beginStepUp/);
  });

  it("serves audited per-tab reads for every admin directory page", () => {
    const source = read("supabase/functions/admin-dashboard-summary/index.ts");
    expect(source).toMatch(/SECTION_NAMES = \[[\s\S]*"businesses"[\s\S]*"offers"[\s\S]*"billing_events"[\s\S]*"audit_log"[\s\S]*"settings"[\s\S]*"business_detail"[\s\S]*"owner_view"[\s\S]*"prospects"[\s\S]*"prospect_detail"[\s\S]*\]/);
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
      expect(html, `${page} must load shared endpoint configuration`).toMatch(/\/admin\/admin-shell\.js/);
      expect(html, `${page} must not duplicate endpoint configuration`).not.toMatch(/data-admin-[a-z0-9-]+-endpoint/);
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

  it("returns additive operations v2 metrics, active-user definition, normalized queue, and recent deals", () => {
    const source = read("supabase/functions/admin-dashboard-summary/index.ts");
    expect(source).toMatch(/ACTIVE_USER_EVENT_NAMES[\s\S]*"app_opened"[\s\S]*"deal_viewed"[\s\S]*"deal_claimed"[\s\S]*"deal_redeemed"/);
    expect(source).toMatch(/from\("app_analytics_events"\)[\s\S]*\.in\("event_name"/);
    expect(source).toMatch(/from\("profiles"\)[\s\S]*select\("id,role"\)/);
    expect(source).toMatch(/profile\.role === "customer"/);
    expect(source).toMatch(/deals:\s*\{[\s\S]*createdToday[\s\S]*created7d[\s\S]*liveNow/);
    expect(source).toMatch(/redemptions:\s*\{[\s\S]*today[\s\S]*last7d[\s\S]*claimToRedeemRate30d/);
    expect(source).toMatch(/withLiveOffer: businessesWithLiveOffer/);
    expect(source).toMatch(/perGeneratedDealUsd/);
    expect(source).toMatch(/function normalizeQueue\(/);
    expect(source).toMatch(/businessHealthTotal/);
    expect(source).toMatch(/recentDeals/);
    expect(source).toMatch(/summaryV2Errors/);
  });

  it("reports service-role-only customer and business account growth from auth creation time", () => {
    const migration = read("supabase/migrations/20260824122000_admin_account_growth_summary.sql");
    const source = read("supabase/functions/admin-dashboard-summary/index.ts");
    const page = read("website/admin/app.html");
    const script = read("website/admin/admin.js");
    const accountsScript = read("website/admin/accounts.js");

    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_account_growth_summary/i);
    expect(migration).toMatch(/FROM auth\.users u/i);
    expect(migration).toMatch(/u\.created_at/i);
    expect(migration).toMatch(/p\.role = 'business'/i);
    expect(migration).toMatch(/p\.role = 'customer'/i);
    expect(migration).toMatch(/NOT EXISTS \([\s\S]*FROM public\.admin_users/i);
    expect(migration).toMatch(/raw_app_meta_data ->> 'app_role'.*<> 'redeemer'/i);
    expect(migration).toMatch(/interval '24 hours'/i);
    expect(migration).toMatch(/interval '7 days'/i);
    expect(migration).toMatch(/interval '30 days'/i);
    expect(migration).toMatch(/SECURITY DEFINER/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_account_growth_summary\(timestamptz\)[\s\S]*TO service_role/i);
    expect(source).toMatch(/rpc\("admin_account_growth_summary"/);
    expect(source).toMatch(/accounts: accountGrowth/);
    expect(source).toMatch(/accountGrowth: accountGrowthError/);
    expect(page).toMatch(/data-account-growth-section/);
    expect(page).toMatch(/Customer accounts/);
    expect(page).toMatch(/Business accounts/);
    expect(page).toMatch(/Last 24 hours/);
    expect(page).toMatch(/Last 7 days/);
    expect(page).toMatch(/Last 30 days/);
    expect(script).toMatch(/function renderAccountGrowth/);
    expect(script).toMatch(/30-day signups/);
    expect(script).toMatch(/Marketplace balance/);
    expect(page).toMatch(/\/admin\/accounts\?role=customer/);
    expect(page).toMatch(/\/admin\/accounts\?role=business/);
    expect(accountsScript).toMatch(/queryParams\.get\("role"\)/);
    expect(accountsScript).toMatch(/requestedRole === "customer" \|\| requestedRole === "business"/);
  });

  it("stores queue workflow state behind service-role-only RLS and audits updates", () => {
    const migration = read("supabase/migrations/20260824120000_admin_queue_item_status.sql");
    const source = read("supabase/functions/admin-dashboard-summary/index.ts");
    const adminScript = read("website/admin/admin.js");
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.admin_queue_item_status/i);
    expect(migration).toMatch(/new'.*reviewing'.*waiting_owner'.*resolved'.*dismissed'/s);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/AS RESTRICTIVE/i);
    expect(migration).toMatch(/COALESCE\(false, false\)/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.admin_queue_item_status FROM PUBLIC, anon, authenticated/i);
    expect(source).toMatch(/payload\.section === "queue_status"/);
    expect(source).toMatch(/admin_queue_status_set/);
    expect(source).toMatch(/function overlayQueueStatuses/);
    expect(source).toMatch(/queueAll/);
    expect(adminScript).toMatch(/admin-queue-status-select/);
    expect(adminScript).toMatch(/updateQueueStatus/);
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

  it("provides an audited read-only owner picture without minting owner sessions", () => {
    const source = read("supabase/functions/admin-dashboard-summary/index.ts");
    const view = read("website/admin/owner-view.js");
    expect(source).toMatch(/"owner_view"/);
    expect(source).toMatch(/admin_owner_view_opened/);
    expect(source).toMatch(/read_only: true/);
    expect(source).toMatch(/impersonation: false/);
    expect(source).not.toMatch(/generateLink[\s\S]+owner_view|signInWithPassword[\s\S]+owner_view/);
    expect(view).toMatch(/Viewing as \$\{business\.name\} — read-only/);
    expect(view).toMatch(/is-owner-viewing/);
    expect(view).toMatch(/Exit owner view/);
  });
});
