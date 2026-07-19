import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readFunction(name: string): string {
  return readFileSync(join(process.cwd(), "supabase", "functions", name, "index.ts"), "utf8");
}

function readSharedFile(name: string): string {
  return readFileSync(join(process.cwd(), "supabase", "functions", "_shared", name), "utf8");
}

describe("business billing access state sync wiring", () => {
  it("seeds business_subscriptions and mirrors the result into location_entitlements in one place", () => {
    const source = readSharedFile("stripe-business-billing.ts");
    expect(source).toMatch(/import \{ applyBusinessBillingAccessState \} from "\.\/business-location-entitlement-sync\.ts"/);
    expect(source).toMatch(/await applyBusinessBillingAccessState\(/);
    expect(source).toMatch(/provider: "admin"/);
  });

  it("replaces the null-skip access_level bug in the Stripe webhook with an explicit sync call", () => {
    const source = readFunction("stripe-webhook");
    expect(source).toMatch(/import \{[\s\S]*applyBusinessBillingAccessState[\s\S]*\} from "\.\.\/_shared\/business-location-entitlement-sync\.ts"/);
    expect(source).toMatch(/await applyBusinessBillingAccessState\(/);
    expect(source).toMatch(/provider: "stripe"/);
    // The old ternary silently skipped the businesses.access_level update for
    // every terminal status (canceled/expired/past_due) by falling to null.
    expect(source).not.toMatch(/const nextAccessLevel = access\.appAccessStatus === "active"/);
  });

  it("mirrors subscription lifecycle changes back to the linked application", () => {
    const source = readSharedFile("business-location-entitlement-sync.ts");
    expect(source).toMatch(/resolveBusinessApplicationStateForAppAccessStatus/);
    expect(source).toMatch(/\.from\("business_applications"\)/);
    expect(source).toMatch(/status: applicationState\.status/);
    expect(source).toMatch(/access_tier: applicationState\.accessTier/);
  });

  it("materializes the business on first login as setup-only approved, without starting a trial", () => {
    const source = readFunction("get-business-onboarding-context");
    expect(source).toMatch(/claim_approved_business_application_for_user/);
    expect(source).toMatch(/can_use_setup_tools/);
    expect(source).toMatch(/can_generate_ai/);
    expect(source).toMatch(/can_publish_offer/);
    expect(source).not.toMatch(/enqueueStripeCustomerSync/);
  });

  it("reconciles already-active billing access without turning approved applications into trials", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase", "migrations", "20260817120000_approved_not_activated_activation_gate.sql"),
      "utf8",
    );
    expect(migration).toMatch(/app_access_status IN \('pending', 'approved_not_activated'\)/);
    expect(migration).toMatch(/WHEN 'trialing' THEN 'trial_active'/);
    expect(migration).toMatch(/WHEN 'active' THEN 'active'/);
    expect(migration).toMatch(/WHEN 'comped' THEN 'active'/);
    expect(migration).toMatch(/v_location_status := CASE v_subscription\.app_access_status/);
    expect(migration).toMatch(/WHEN 'active' THEN CASE[\s\S]*'pro_active'/);
    expect(migration).toMatch(/WHEN 'comped' THEN NULL/);
  });

  it("creates prospect approvals as setup-only and leaves Stripe/trial activation to Checkout", () => {
    const source = readFunction("admin-trial-create-from-prospect");
    expect(source).toMatch(/applicationStatus: "approved_not_activated"/);
    expect(source).toMatch(/businessAccessLevel: "approved_not_activated"/);
    expect(source).toMatch(/trialDays: null/);
    expect(source).toMatch(/trial_days: null/);
    expect(source).not.toMatch(/trialDays: 30|trialDays: 14|trialDays: 90/);
    expect(source).not.toMatch(/ensureStripeCustomerForBusiness/);
    expect(source).toMatch(/APPROVED_ACTIVATION_GATE_DISABLED/);
    expect(source).toMatch(/approved_email_normalized: normalized\.email\.toLowerCase\(\)/);
    expect(source).toMatch(/linkedBusinessHasProtectedAccess/);
    expect(source).toMatch(/LINKED_BUSINESS_ACCESS_PROTECTED/);
    expect(source).toMatch(/Boolean\(subscription\?\.activated_at\)/);
    expect(source).toMatch(/Boolean\(subscription\?\.stripe_subscription_id\)/);
  });

  it("schedules the billing access expiry sweep and reuses the existing cron secret infrastructure", () => {
    const cronMigration = readFileSync(
      join(process.cwd(), "supabase", "migrations", "20260803120000_expire_billing_access_cron_schedule.sql"),
      "utf8",
    );
    expect(cronMigration).toMatch(/expire-billing-access/);
    expect(cronMigration).toMatch(/billing_reminder_cron_secret/);
    expect(cronMigration).toMatch(/cron\.schedule/);

    const fn = readFunction("expire-billing-access");
    expect(fn).toMatch(/verify_billing_reminder_secret/);
    expect(fn).toMatch(/app_access_status", \["trialing", "trial_limited"\]/);
    expect(fn).toMatch(/eq\("app_access_status", "active"\)/);
    expect(fn).toMatch(/eq\("cancel_at_period_end", true\)/);
    expect(fn).toMatch(/appAccessStatus: "canceled"/);
    expect(fn).toMatch(/paid_cancel_expirations/);
    expect(fn).toMatch(/eq\("app_access_status", "past_due_grace"\)/);
    expect(fn).toMatch(/applyBusinessBillingAccessState/);
    // "expired" is ambiguous in the shared resolver (trial-ran-out vs
    // paid-grace-lapsed); each sweep branch sets its own businesses.status label directly.
    expect(fn).toMatch(/status: "trial_expired"/);
    expect(fn).toMatch(/status: "canceled"/);
  });

  it("documents the production backfill without applying it automatically", () => {
    const backfill = readFileSync(
      join(process.cwd(), "supabase", "migrations", "20260803121000_billing_access_state_backfill.sql"),
      "utf8",
    );
    expect(backfill).toMatch(/Do not apply without Dan's explicit approval/);
    expect(backfill).toMatch(/location_entitlements/);
    expect(backfill).not.toMatch(/DROP TABLE/i);
    expect(backfill).not.toMatch(/DELETE FROM/i);
  });
});
