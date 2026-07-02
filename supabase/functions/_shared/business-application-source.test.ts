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
    expect(source).toMatch(/admin_business_application_approved_limited/);
    expect(source).toMatch(/admin_business_application_approved_full/);
    expect(source).toMatch(/ensureStripeCustomerForBusiness/);
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
    expect(script).toMatch(/Decision saved, but the queue refresh failed/);
  });

  it("lets an admin field-create a business trial through the same audited decision path", () => {
    const source = read("supabase/functions/admin-business-applications/index.ts");
    // The founder field-invite path (admin/businesses/new) must insert its own
    // application row, then reuse applyDecision — not a separate, divergent
    // code path — so it gets the same business materialization, Stripe billing
    // hook, and audit logging as a normal trial-request approval.
    expect(source).toMatch(/action === "create"/);
    expect(source).toMatch(/async function createApplication/);
    expect(source).toMatch(/canDecideApplications\(ctx\.adminUser\.role\)/);
    expect(source).toMatch(/admin_field_invite/);
    expect(source).toMatch(/admin_business_application_created/);
    expect(source).toMatch(/return applyDecision\(req, ctx, application/);
    // terms/privacy acceptance belongs to the owner, not the admin creating the record
    expect(source).toMatch(/terms_accepted:\s*false/);
    expect(source).toMatch(/privacy_acknowledged:\s*false/);
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
    expect(script).not.toMatch(/OPENAI_API_KEY|STRIPE_SECRET_KEY/);
  });
});
