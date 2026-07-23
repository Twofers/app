import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Stripe business billing reconnection sources", () => {
  it("creates the server-owned business billing tables with RLS", () => {
    const source = readRepoFile("supabase/migrations/20260730127000_stripe_business_billing_reconnection.sql");
    for (const table of [
      "business_billing_profiles",
      "business_subscriptions",
      "billing_events",
      "stripe_checkout_sessions",
      "stripe_portal_sessions",
      "stripe_sync_jobs",
      "billing_reminders",
      "billing_tokens",
    ]) {
      expect(source).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`, "i"));
      expect(source).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
    }
    expect(source).toMatch(/policy_name := 'redeemer_' \|\| tbl \|\| '_block_all'/i);
    expect(source).toMatch(/CREATE OR REPLACE FUNCTION public\.can_business_publish/i);
    expect(source).toMatch(/business_subscriptions/i);
    expect(source).toMatch(/location_entitlements/i);
    expect(source).toMatch(/GRANT SELECT ON TABLE public\.business_billing_profiles TO authenticated/i);
    expect(source).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE public\.business_billing_profiles TO service_role/i);
  });

  it("keeps Stripe billing helpers server-side without exposing Stripe to app context", () => {
    const helper = readRepoFile("supabase/functions/_shared/stripe-business-billing.ts");
    expect(helper).toMatch(/upsertBusinessBillingProfile/);
    expect(helper).toMatch(/seedBusinessSubscription/);
    expect(helper).toMatch(/enqueueStripeCustomerSync/);
    expect(helper).toMatch(/ensureStripeCustomerForBusiness/);
    expect(helper).toMatch(/stripe_sync_jobs/);
    expect(helper).toMatch(/business_billing_profiles/);
    expect(helper).toMatch(/business_subscriptions/);
    expect(helper).toMatch(/billing_events/);

    const context = readRepoFile("supabase/functions/get-business-onboarding-context/index.ts");
    const activationMigration = readRepoFile(
      "supabase/migrations/20260817120000_approved_not_activated_activation_gate.sql",
    );
    expect(context).toMatch(/claim_approved_business_application_for_user/);
    expect(context).not.toMatch(/seedBusinessSubscription/);
    expect(activationMigration).toMatch(/INSERT INTO public\.business_billing_profiles/);
    expect(activationMigration).toMatch(/INSERT INTO public\.business_subscriptions/);
    expect(activationMigration).toMatch(/'approved_not_activated'/);
    expect(context).not.toMatch(/enqueueStripeCustomerSync/);
    expect(context).not.toMatch(/STRIPE_SECRET_KEY/);
    expect(context).not.toMatch(/new Stripe/);
  });
});
