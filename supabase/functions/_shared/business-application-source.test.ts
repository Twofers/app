import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("business application intake", () => {
  it("keeps the table RLS-closed to public client roles", () => {
    const migration = read("supabase/migrations/20260730123000_business_applications.sql");
    const workflowMigration = read("supabase/migrations/20260730124000_business_onboarding_workflow.sql");
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_applications/i);
    expect(migration).toMatch(/ALTER TABLE public\.business_applications ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.business_applications FROM anon, authenticated/i);
    expect(migration).toMatch(/CREATE TRIGGER business_applications_set_updated_at/i);
    expect(workflowMigration).toMatch(/ADD COLUMN IF NOT EXISTS access_tier/i);
    expect(workflowMigration).toMatch(/trial_limited/i);
    expect(workflowMigration).toMatch(/field_invited/i);
  });

  it("uses the Edge Function to validate and insert applications", () => {
    const source = read("supabase/functions/submit-business-application/index.ts");
    expect(source).toMatch(/company_website/);
    expect(source).toMatch(/terms_accepted/);
    expect(source).toMatch(/privacy_acknowledged/);
    expect(source).toMatch(/scoreApplication/);
    expect(source).toMatch(/website_start_trial/);
    expect(source).toMatch(/risk_reasons/);
    expect(source).toMatch(/from\("business_applications"\)\.insert/);
    // Public, unauthenticated submissions never materialize a business or
    // create a Stripe customer for an existing account — see
    // business-onboarding-sync-source.test.ts for the account-takeover guard.
    expect(source).not.toMatch(/ensureStripeCustomerForBusiness/);
    expect(source).toMatch(/enqueueStripeCustomerSync/);
    expect(source).not.toMatch(/STRIPE_SECRET_KEY/);
    expect(source).not.toMatch(/OPENAI_API_KEY/);
  });

  it("keeps even low-risk public applications pending until an explicit approval", () => {
    const source = read("supabase/functions/submit-business-application/index.ts");
    const lowRiskBranch = source.slice(source.indexOf("if (score >= 70)"), source.indexOf("if (score >= 40)"));
    expect(lowRiskBranch).toMatch(/status:\s*"pending_review"/);
    expect(lowRiskBranch).toMatch(/access_tier:\s*"pending_verification"/);
    expect(lowRiskBranch).toMatch(/verification_status:\s*"verified_low_risk"/);
    expect(lowRiskBranch).not.toMatch(/status:\s*"trial_limited"|access_tier:\s*"trial_limited"/);
  });

  it("rate-limits the public endpoint per email and per IP before inserting", () => {
    const source = read("supabase/functions/submit-business-application/index.ts");
    // Per-email and per-IP throttles must both exist with finite ceilings.
    expect(source).toMatch(/const RATE_LIMIT_WINDOW_MINUTES\s*=\s*\d+/);
    expect(source).toMatch(/const RATE_LIMIT_MAX_PER_EMAIL\s*=\s*\d+/);
    expect(source).toMatch(/const RATE_LIMIT_MAX_PER_IP\s*=\s*\d+/);
    // The throttle counts prior onboarding requests within a recent window,
    // keyed by both the submitted email and the forwarded client IP.
    expect(source).toMatch(/from\("business_onboarding_requests"\)/);
    expect(source).toMatch(/\.eq\("owner_email", params\.email\)/);
    expect(source).toMatch(/\.eq\("ip_address", params\.ip\)/);
    expect(source).toMatch(/\.gte\("created_at", windowStart\)/);
    // Exceeding either ceiling returns HTTP 429. The client IP is derived from
    // trusted edge/CDN headers and validated as a real IP — never trusting the
    // attacker-controllable leftmost x-forwarded-for hop on this public endpoint.
    expect(source).toMatch(/Too many requests/);
    expect(source).toMatch(/\},\s*429\)/);
    // IP derivation lives in the shared trusted-IP helper (validated, prefers
    // unspoofable edge headers, never the leftmost XFF hop) — see client-ip.test.ts.
    expect(source).toMatch(/from "\.\.\/_shared\/client-ip\.ts"/);
    expect(source).toMatch(/clientIpFromRequest\(req\)/);
    expect(source).not.toMatch(/firstForwardedIp/);
    // A client-independent flood ceiling backstops evasion of the per-actor caps
    // (email/IP rotation) by bounding the costly admin alert + quick-approval mint.
    expect(source).toMatch(/const RATE_LIMIT_MAX_ALERTS_PER_WINDOW\s*=\s*\d+/);
    expect(source).toMatch(/alertFloodExceeded/);
    // A honeypot field short-circuits obvious bots before any DB work.
    expect(source).toMatch(/cleanString\(payload\.company_website/);

    // The rate-limit gate must run BEFORE the application row is inserted,
    // otherwise a flood still writes rows before being rejected.
    const rateCheckAt = source.indexOf("await isRateLimited(");
    const insertAt = source.indexOf('from("business_applications").insert');
    expect(rateCheckAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(-1);
    expect(rateCheckAt).toBeLessThan(insertAt);

    // The throttle-counted onboarding request must be recorded BEFORE the costly
    // outbound admin alert, so network I/O stays out of the rate-limit window.
    const onboardingAt = source.indexOf("createOnboardingRequest(supabase");
    const alertAt = source.indexOf("sendNewApplicationAdminAlert(");
    expect(onboardingAt).toBeGreaterThan(-1);
    expect(alertAt).toBeGreaterThan(-1);
    expect(onboardingAt).toBeLessThan(alertAt);
  });

  it("registers the public function and website CORS origin", () => {
    const config = read("supabase/config.toml");
    expect(config).toMatch(
      /\[functions\.submit-business-application\][\s\S]*verify_jwt\s*=\s*false[\s\S]*entrypoint\s*=\s*"\.\/functions\/submit-business-application\/index\.ts"/,
    );
    expect(config).toMatch(
      /\[functions\.admin-business-applications\][\s\S]*verify_jwt\s*=\s*false[\s\S]*entrypoint\s*=\s*"\.\/functions\/admin-business-applications\/index\.ts"/,
    );

    const cors = read("supabase/functions/_shared/cors.ts");
    expect(cors).toContain('"https://www.twoferapp.com"');
    expect(cors).toContain('"https://twoferapp.com"');
  });

  it("keeps admin trial decisions server-authorized and audited", () => {
    const source = read("supabase/functions/admin-business-applications/index.ts");
    expect(source).toMatch(/from\("admin_users"\)/);
    expect(source).toMatch(/from\("business_applications"\)/);
    expect(source).toMatch(/createOnboardingRequest/);
    expect(source).toMatch(/admin_business_application_approved_limited/);
    expect(source).toMatch(/admin_business_application_approved_full/);
    expect(source).toMatch(/admin_business_application_billing_sync_failed/);
    expect(source).toMatch(/ensureStripeCustomerForBusiness/);
    expect(source).toMatch(/billing_sync_warning/);
    expect(source).not.toMatch(/auth\.admin\.listUsers/);
    expect(source).not.toMatch(/OPENAI_API_KEY|STRIPE_SECRET_KEY/);
  });

  it("wires the admin trial request page to live list and decision actions", () => {
    const page = read("website/admin/trial-requests/index.html");
    const script = read("website/admin/trial-requests.js");
    expect(page).toMatch(/data-admin-business-applications-endpoint/);
    expect(page).toMatch(/\/admin\/trial-requests\.js/);
    expect(script).toMatch(/action: "list"/);
    expect(script).toMatch(/action: "decide"/);
    expect(script).toMatch(/approve_limited/);
    expect(script).toMatch(/approve_full/);
    expect(script).toMatch(/AbortController/);
    expect(script).toMatch(/networkFailureMessage/);
    expect(script).toMatch(/billing_sync_warning/);
    expect(script).toMatch(/Request id:/);
    expect(script).toMatch(/Decision saved, but the queue refresh failed/);
  });

  it("lets an admin field-create a business trial through the same audited decision path", () => {
    const source = read("supabase/functions/admin-business-applications/index.ts");
    // The founder field-invite path (admin/businesses/new) must insert its own
    // application row, then reuse applyDecision so it gets the same approval,
    // owner-linkable onboarding request, billing follow-up, and audit logging
    // as a normal trial-request approval.
    expect(source).toMatch(/action === "create"/);
    expect(source).toMatch(/async function createApplication/);
    expect(source).toMatch(/canDecideApplications\(ctx\.adminUser\.role\)/);
    expect(source).toMatch(/admin_field_invite/);
    expect(source).toMatch(/admin_business_application_created/);
    expect(source).toMatch(/return applyDecision\(req, ctx, application/);
    expect(source).toMatch(/ensureOnboardingRequestForDecision/);
    // terms/privacy acceptance belongs to the owner, not the admin creating the record
    expect(source).toMatch(/terms_accepted:\s*false/);
    expect(source).toMatch(/privacy_acknowledged:\s*false/);
  });

  it("rejects an unrecognized action with a clear 400 instead of silently falling through to listApplications", () => {
    const source = read("supabase/functions/admin-business-applications/index.ts");
    expect(source).toMatch(/const KNOWN_ACTIONS = new Set\(\["list", "decide", "create", "verify_business", "quick_preview", "quick_confirm"\]\)/);
    expect(source).toMatch(/if \(!KNOWN_ACTIONS\.has\(action\)\) \{\s*\n\s*return json\(req, \{ ok: false, error: "Unknown action\.", request_id: requestId \}, 400\);/);
  });

  it("wires the founder field-invite page to the create action", () => {
    const page = read("website/admin/businesses/new/index.html");
    const script = read("website/admin/admin-new-trial.js");
    expect(page).toMatch(/data-admin-business-applications-endpoint/);
    expect(page).toMatch(/data-new-trial-form/);
    expect(page).toMatch(/name="business_name"/);
    expect(page).toMatch(/name="email"/);
    expect(script).toMatch(/action: "create"/);
    expect(script).toMatch(/fields/);
    expect(script).toMatch(/billing_sync_warning/);
    expect(script).toMatch(/Request id:/);
    expect(script).not.toMatch(/OPENAI_API_KEY|STRIPE_SECRET_KEY/);
  });
});
