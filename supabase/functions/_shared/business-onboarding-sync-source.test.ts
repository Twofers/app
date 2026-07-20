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

  it("caps self-serve business creation per owner while allowing service-role onboarding", () => {
    // Gate v3 (20260814130000) superseded the invite-code posture: v1
    // (20260706120000) and v2 (20260730129000) required a
    // business_invite_validations row, v3 explicitly dropped that requirement
    // and replaced it with a per-owner cap. Assert v3, since that is the body
    // CREATE OR REPLACE actually installs on businesses_require_invite_trg.
    const gate = read("supabase/migrations/20260814130000_business_open_application_gate.sql");
    expect(gate).toMatch(/CREATE OR REPLACE FUNCTION public\.businesses_require_invite/i);
    // Admin/server onboarding paths bypass the cap and manage their own rules.
    expect(gate).toMatch(/auth\.role\(\).*service_role/is);
    // Pilot cap: one non-rejected/non-archived business per owner.
    expect(gate).toMatch(/business limit reached/i);
    expect(gate).toMatch(/b\.status NOT IN \('rejected', 'archived'\)/i);
    // TOCTOU guard: two parallel inserts must not both read count=0.
    expect(gate).toMatch(/pg_advisory_xact_lock\(hashtext\('businesses_owner_cap:/i);
    // The v3 body must not reinstate the dropped validation-row requirement.
    const v3Body = gate.slice(gate.indexOf("CREATE OR REPLACE FUNCTION public.businesses_require_invite"));
    expect(v3Body).not.toMatch(/business_invite_validations/i);

    // Materialization itself is SQL-side and requires a confirmed auth email;
    // no edge function creates the business row from an onboarding snapshot.
    const claimGate = read("supabase/migrations/20260817120000_approved_not_activated_activation_gate.sql");
    expect(claimGate).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_approved_business_application_for_user/i);
    expect(claimGate).toMatch(/CONFIRMED_AUTH_EMAIL_REQUIRED/);
    const helper = read("supabase/functions/_shared/business-onboarding-sync.ts");
    expect(helper).not.toMatch(/from\("businesses"\)\.insert/);
  });

  it("connects website submit to normalized onboarding without eager unauthenticated materialization", () => {
    const source = read("supabase/functions/submit-business-application/index.ts");
    expect(source).toMatch(/createOnboardingRequest/);
    // This is a public, unauthenticated endpoint: it must never materialize a
    // business or Stripe customer for an existing account based on an
    // unverified email in the request body (account-takeover-adjacent risk).
    // Materialization happens only after the real owner authenticates in the
    // app, via get-business-onboarding-context.
    //
    // materializeBusinessForUser no longer exists anywhere (removed once
    // claim_approved_business_application_for_user superseded it), so this
    // assertion is now a guard against reintroducing that helper or its name.
    expect(source).not.toMatch(/materializeBusinessForUser/);
    expect(source).not.toMatch(/ensureStripeCustomerForBusiness/);
    expect(source).not.toMatch(/auth\.admin\.listUsers/);
    // The public response must stay generic: echoing business_linked would
    // disclose whether an email already has a Twofer account.
    expect(source).not.toMatch(/business_linked: Boolean/);
    expect(source).toMatch(/enqueueStripeCustomerSync/);
    expect(source).not.toMatch(/OPENAI_API_KEY/);
  });

  it("rate limits public business application submissions", () => {
    const source = read("supabase/functions/submit-business-application/index.ts");
    expect(source).toMatch(/RATE_LIMIT_MAX_PER_EMAIL/);
    expect(source).toMatch(/RATE_LIMIT_MAX_PER_IP/);
    expect(source).toMatch(/business_onboarding_requests/);
  });

  it("registers app-safe context and update endpoints", () => {
    const config = read("supabase/config.toml");
    expect(config).toMatch(/\[functions\.get-business-onboarding-context\][\s\S]*entrypoint\s*=\s*"\.\/functions\/get-business-onboarding-context\/index\.ts"/);
    expect(config).toMatch(/\[functions\.update-business-profile-section\][\s\S]*entrypoint\s*=\s*"\.\/functions\/update-business-profile-section\/index\.ts"/);

    const context = read("supabase/functions/get-business-onboarding-context/index.ts");
    expect(context).toMatch(/claim_approved_business_application_for_user/);
    // Reintroduction guard: the TS helper this replaced has been deleted.
    expect(context).not.toMatch(/materializeBusinessForUser/);
    expect(context).toMatch(/get_business_capabilities/);
    expect(context).not.toMatch(/stripe-create-checkout|customer-portal|STRIPE_SECRET_KEY/i);

    const update = read("supabase/functions/update-business-profile-section/index.ts");
    expect(update).toMatch(/profile_conflict/);
    expect(update).toMatch(/business_profile_revision_log/);
    expect(update).toMatch(/business_profile_field_sources/);
    expect(update).not.toMatch(/stripe-create-checkout|customer-portal|STRIPE_SECRET_KEY/i);
  });
});
