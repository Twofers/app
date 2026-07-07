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

  it("materializes the business on first login with the admin-approved trial length instead of an eternal trial", () => {
    const source = readFunction("get-business-onboarding-context");
    expect(source).toMatch(/trial_days/);
    expect(source).toMatch(/trialDays: typeof decision\.trial_days === "number" \? decision\.trial_days : null/);
    expect(source).not.toMatch(/trialDays: null,/);
  });

  it("creates prospect-approved trials with the same 30\/14-day lengths as admin-business-applications, and seeds business_subscriptions immediately when the business already exists", () => {
    const source = readFunction("admin-trial-create-from-prospect");
    expect(source).toMatch(/trialDays: 30/);
    expect(source).toMatch(/trialDays: 14/);
    expect(source).not.toMatch(/trialDays: 90/);
    expect(source).toMatch(/ensureStripeCustomerForBusiness/);
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
