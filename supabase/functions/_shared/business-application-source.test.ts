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
    expect(source).toMatch(/ensureStripeCustomerForBusiness/);
    expect(source).toMatch(/enqueueStripeCustomerSync/);
    expect(source).toMatch(/STRIPE_SECRET_KEY/);
    expect(source).not.toMatch(/OPENAI_API_KEY/);
  });

  it("registers the public function and website CORS origin", () => {
    const config = read("supabase/config.toml");
    expect(config).toMatch(
      /\[functions\.submit-business-application\][\s\S]*verify_jwt\s*=\s*false[\s\S]*entrypoint\s*=\s*"\.\/functions\/submit-business-application\/index\.ts"/,
    );

    const cors = read("supabase/functions/_shared/cors.ts");
    expect(cors).toContain('"https://www.twoferapp.com"');
    expect(cors).toContain('"https://twoferapp.com"');
  });
});
