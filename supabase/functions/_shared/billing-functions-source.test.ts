import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readFunction(name: string): string {
  return readFileSync(join(process.cwd(), "supabase", "functions", name, "index.ts"), "utf8");
}

describe("billing edge function safety", () => {
  it("gates checkout creation on the server-owned in-app purchase surface", () => {
    const source = readFunction("stripe-create-checkout-session");
    expect(source).toMatch(/loadRuntimeBillingConfig/);
    expect(source).toMatch(/config\.purchaseSurface !== "in_app_link"/);
    expect(source).toMatch(/user_owns_business_location/);
    expect(source).toMatch(/STRIPE_TWOFER_BUSINESS_PRICE_ID/);
    expect(source).toMatch(/trial_acknowledged/);
    expect(source).toMatch(/trial_checkout_intents/);
    expect(source).toMatch(/check_business_location_trial_reuse/);
    expect(source).toMatch(/TRIAL_LOCATION_ALREADY_USED/);
    expect(source).toMatch(/TRIAL_LOCATION_REVIEW_REQUIRED/);
    expect(source).toMatch(/trial_period_days: TRIAL_DAYS/);
    expect(source).toMatch(/payment_method_collection: "always"/);
    expect(source).toMatch(/entitlementError/);
    expect(source).toMatch(/trialHistoryError/);
    expect(source).toMatch(/customerUpdateError/);
    expect(source).toMatch(/intentUpdateError/);
    expect(source).toMatch(/pendingEntitlementError/);
    expect(source).not.toMatch(/payment_method_collection: "if_required"/);
    expect(source).not.toMatch(/subscription_tier/);
  });

  it("gates portal creation on location ownership and purchase surface", () => {
    const source = readFunction("stripe-customer-portal-session");
    expect(source).toMatch(/loadRuntimeBillingConfig/);
    expect(source).toMatch(/config\.purchaseSurface !== "in_app_link"/);
    expect(source).toMatch(/user_owns_business_location/);
    expect(source).toMatch(/location_id/);
    expect(source).toMatch(/STRIPE_SECRET_KEY/);
    expect(source).toMatch(/stripeSecretKey\.startsWith\("sk_live_"\)/);
    expect(source).toMatch(/config\.billingEnvironment !== "production"/);
  });

  it("expires canceled pending checkout sessions without starting trials", () => {
    const source = readFunction("stripe-expire-pending-checkout");
    expect(source).toMatch(/auth\.getUser/);
    expect(source).toMatch(/isRedeemerUser/);
    expect(source).toMatch(/config\.purchaseSurface !== "in_app_link"/);
    expect(source).toMatch(/user_owns_business_location/);
    expect(source).toMatch(/trial_checkout_pending/);
    expect(source).toMatch(/trial_checkout_intents/);
    expect(source).toMatch(/stripe\.checkout\.sessions\.expire/);
    expect(source).toMatch(/status: "trial_eligible"/);
    expect(source).toMatch(/stripeSecretKey\.startsWith\("sk_live_"\)/);
    expect(source).not.toMatch(/deal_credit_periods"\)\s*\.insert/);
  });

  it("makes verified webhook invoice events the paid activation path", () => {
    const source = readFunction("stripe-webhook");
    expect(source).toMatch(/constructEventAsync/);
    expect(source).toMatch(/billing_provider_events/);
    expect(source).toMatch(/event\.type === "invoice\.paid"/);
    expect(source).toMatch(/grantPaidPeriod/);
    expect(source).toMatch(/paid_deal_credit_allowance/);
    expect(source).toMatch(/isRealPaidSubscriptionCycleInvoice/);
    expect(source).toMatch(/billingReason === "subscription_cycle"/);
    expect(source).toMatch(/amountPaid > 0/);
    expect(source).toMatch(/paid_subscription:\$\{subscriptionId\}:\$\{startedAt\}/);
    expect(source).toMatch(/event\.type === "customer\.subscription\.updated"/);
    expect(source).not.toMatch(/event\.type === "invoice\.payment_succeeded"\) \{\s*await grantPaidPeriod/);
  });

  it("retries failed Stripe provider events without replaying processed duplicates", () => {
    const source = readFunction("stripe-webhook");
    expect(source).toMatch(/provider_event_id", event\.id/);
    expect(source).toMatch(/processing_status"\)/);
    expect(source).toMatch(/processing_status\) === "failed"/);
    expect(source).toMatch(/processing_status: "processing"/);
    expect(source).toMatch(/processed_at: null/);
    expect(source).toMatch(/error_message: null/);
    expect(source).toMatch(/return \{ duplicate: true, id: existingId \}/);
  });

  it("activates card-required trials only from checkout webhooks", () => {
    const source = readFunction("stripe-webhook");
    expect(source).toMatch(/activateTrialFromCheckout/);
    expect(source).toMatch(/checkout_purpose/);
    expect(source).toMatch(/trial_start/);
    expect(source).toMatch(/status: "trial_active"/);
    expect(source).toMatch(/trial:\$\{locationId\}:\$\{subscriptionId\}/);
  });

  it("defers checkout trial subscription sync until checkout completion activates credits", () => {
    const source = readFunction("stripe-webhook");
    expect(source).toMatch(/shouldDeferTrialSubscriptionSync/);
    expect(source).toMatch(/safeGetString\(metadata\.checkout_purpose\) === "trial_start"/);
    expect(source).toMatch(/existingStatus === "trial_checkout_pending"/);
    expect(source).toMatch(/stripeStatus === "trialing"/);
    expect(source).toMatch(/shouldDeferTrialSubscriptionSync\(metadata, existingStatus, status\)/);
    expect(source).toMatch(/metadata: mergedMetadata/);
  });

  it("disables the old simulate subscribe helper", () => {
    const source = readFunction("simulate-subscribe");
    expect(source).toMatch(/status: 410/);
    expect(source).not.toMatch(/subscription_status/);
    expect(source).not.toMatch(/subscription_tier/);
  });

  it("blocks suspended locations in server-owned deal action functions", () => {
    for (const name of [
      "ai-create-deal",
      "ai-generate-ad-variants",
      "claim-deal",
      "publish-offer-version",
      "send-deal-push",
    ]) {
      const source = readFunction(name);
      expect(source).toMatch(/billing-suspension/);
      expect(source).toMatch(/suspendedLocationResponseBody/);
    }
  });

  it("checks business verification before live publish-style actions when the server gate is enabled", () => {
    for (const name of ["ai-create-deal", "publish-offer-version", "send-deal-push"]) {
      const source = readFunction(name);
      expect(source).toMatch(/business-verification/);
      expect(source).toMatch(/businessVerificationRequiredResponseBody/);
    }
  });
});
