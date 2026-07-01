import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readFunction(name: string): string {
  return readFileSync(join(process.cwd(), "supabase", "functions", name, "index.ts"), "utf8");
}

describe("billing edge function safety", () => {
  it("creates checkout sessions only through web/admin business billing", () => {
    const source = readFunction("stripe-create-checkout-session");
    expect(source).toMatch(/loadRuntimeBillingConfig/);
    expect(source).toMatch(/config\.purchaseSurface !== "web_only"/);
    expect(source).toMatch(/business_id/);
    expect(source).toMatch(/business_billing_profiles/);
    expect(source).toMatch(/business_members/);
    expect(source).toMatch(/admin_users/);
    expect(source).toMatch(/billing_tokens/);
    expect(source).toMatch(/ensureStripeCustomerForBusiness/);
    expect(source).toMatch(/stripe_checkout_sessions/);
    expect(source).toMatch(/billing_events/);
    expect(source).toMatch(/\/business\/billing\/success\//);
    expect(source).toMatch(/\/business\/billing\/cancel\//);
    expect(source).toMatch(/STRIPE_TWOFER_BUSINESS_PRICE_ID/);
    expect(source).toMatch(/mode: "subscription"/);
    expect(source).toMatch(/payment_method_collection: "always"/);
    expect(source).not.toMatch(/payment_method_collection: "if_required"/);
    expect(source).not.toMatch(/user_owns_business_location/);
    expect(source).not.toMatch(/trial_acknowledged/);
    expect(source).not.toMatch(/trial_checkout_intents/);
    expect(source).not.toMatch(/trial_period_days: TRIAL_DAYS/);
    expect(source).not.toMatch(/subscription_tier/);
  });

  it("creates portal sessions only for business billing customers", () => {
    const source = readFunction("stripe-customer-portal-session");
    expect(source).toMatch(/loadRuntimeBillingConfig/);
    expect(source).toMatch(/business_id/);
    expect(source).toMatch(/business_billing_profiles/);
    expect(source).toMatch(/business_members/);
    expect(source).toMatch(/admin_users/);
    expect(source).toMatch(/billing_tokens/);
    expect(source).toMatch(/customer_portal/);
    expect(source).toMatch(/stripe_portal_sessions/);
    expect(source).toMatch(/billing_events/);
    expect(source).toMatch(/\/business\/billing\/manage\//);
    expect(source).toMatch(/STRIPE_SECRET_KEY/);
    expect(source).toMatch(/stripeSecretKey\.startsWith\("sk_live_"\)/);
    expect(source).toMatch(/config\.billingEnvironment !== "production"/);
    expect(source).not.toMatch(/user_owns_business_location/);
    expect(source).not.toMatch(/location_id/);
  });

  it("keeps checkout redirect handling on website pages only", () => {
    const source = readFunction("billing-checkout-redirect");
    expect(source).toMatch(/\/business\/billing\/success\//);
    expect(source).toMatch(/\/business\/billing\/cancel\//);
    expect(source).not.toMatch(/twoforone:\/\//);
    expect(source).not.toMatch(/exp\+/);
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
    expect(source).toMatch(/if \(!existingPeriod\?\.id\)/);
    expect(source).not.toMatch(/if \(existingPeriod\?\.id\) return/);
    expect(source).toMatch(/event\.type === "customer\.subscription\.updated"/);
    expect(source).not.toMatch(/event\.type === "invoice\.payment_succeeded"\) \{\s*await grantPaidPeriod/);
  });

  it("syncs business subscriptions from verified Stripe webhooks without intercepting refunds", () => {
    const source = readFunction("stripe-webhook");
    expect(source).toMatch(/syncBusinessSubscriptionFromStripe/);
    expect(source).toMatch(/businessIdForStripeCustomer/);
    expect(source).toMatch(/business_subscriptions/);
    expect(source).toMatch(/business_billing_profiles/);
    expect(source).toMatch(/stripe_checkout_sessions/);
    expect(source).toMatch(/billing_reminders/);
    expect(source).toMatch(/event\.type === "invoice\.payment_failed"/);
    expect(source).toMatch(/appAccessStatus: "past_due_grace"/);
    expect(source).toMatch(/businessId && !isRefundWebhookEvent\(event\.type\)/);
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

  it("records refund webhook details before requiring billing account metadata", () => {
    const source = readFunction("stripe-webhook");
    expect(source).toMatch(/isRefundWebhookEvent/);
    expect(source).toMatch(/recordRefundWebhookDetails/);
    expect(source).toMatch(/billing_refund_requests/);
    expect(source).toMatch(/provider_refund_id/);
    expect(source).toMatch(/provider_charge_id/);
    expect(source).toMatch(/provider_payment_intent_id/);
    expect(source).toMatch(/refundMetadataFromCharge/);
    expect(source).toMatch(/refund_purpose/);
    expect(source).toMatch(/introductory_refund/);
    expect(source).toMatch(/introductory_refund_used_at/);
    expect(source).toMatch(/const metadataLocationId = safeGetString\(mergedMetadata\.business_location_id\)/);
  });

  it("disables the old simulate subscribe helper", () => {
    const source = readFunction("simulate-subscribe");
    expect(source).toMatch(/status: 410/);
    expect(source).not.toMatch(/subscription_status/);
    expect(source).not.toMatch(/subscription_tier/);
  });

  it("blocks suspended locations in server-owned deal action functions", () => {
    for (const name of [
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
    for (const name of ["publish-offer-version", "send-deal-push"]) {
      const source = readFunction(name);
      expect(source).toMatch(/business-verification/);
      expect(source).toMatch(/businessVerificationRequiredResponseBody/);
    }
  });
});
