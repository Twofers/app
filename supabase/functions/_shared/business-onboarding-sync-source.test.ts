import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("website-to-app business onboarding sync", () => {
  it("creates canonical sync tables with closed RLS posture", () => {
    const migration = read("supabase/migrations/20260730126000_website_app_onboarding_sync.sql");
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_onboarding_requests/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_members/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_invites/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_contact_channels/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_slow_hours/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_promotable_items/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_profile_field_sources/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_profile_revision_log/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_setup_checklist/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.terms_acceptances/i);
    expect(migration).toMatch(/policy_name := 'redeemer_' \|\| tbl \|\| '_block_all'/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.business_onboarding_requests FROM anon, authenticated/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.can_business_publish/i);
  });

  it("connects website submit to normalized onboarding and app materialization", () => {
    const source = read("supabase/functions/submit-business-application/index.ts");
    expect(source).toMatch(/createOnboardingRequest/);
    expect(source).toMatch(/materializeBusinessForUser/);
    expect(source).toMatch(/business_linked/);
    expect(source).toMatch(/ensureStripeCustomerForBusiness/);
    expect(source).toMatch(/enqueueStripeCustomerSync/);
    expect(source).not.toMatch(/OPENAI_API_KEY/);
  });

  it("registers app-safe context and update endpoints", () => {
    const config = read("supabase/config.toml");
    expect(config).toMatch(/\[functions\.get-business-onboarding-context\][\s\S]*entrypoint\s*=\s*"\.\/functions\/get-business-onboarding-context\/index\.ts"/);
    expect(config).toMatch(/\[functions\.update-business-profile-section\][\s\S]*entrypoint\s*=\s*"\.\/functions\/update-business-profile-section\/index\.ts"/);

    const context = read("supabase/functions/get-business-onboarding-context/index.ts");
    expect(context).toMatch(/materializeBusinessForUser/);
    expect(context).toMatch(/can_business_publish/);
    expect(context).not.toMatch(/stripe-create-checkout|customer-portal|STRIPE_SECRET_KEY/i);

    const update = read("supabase/functions/update-business-profile-section/index.ts");
    expect(update).toMatch(/profile_conflict/);
    expect(update).toMatch(/business_profile_revision_log/);
    expect(update).toMatch(/business_profile_field_sources/);
    expect(update).not.toMatch(/stripe-create-checkout|customer-portal|STRIPE_SECRET_KEY/i);
  });
});
