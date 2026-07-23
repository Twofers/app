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
    // No-card trial toggle (Dan, 2026-07-06): card is required unless the
    // global require_card_for_trial switch is off or a valid exemption code
    // was used -- see the dedicated describe block below for the full check.
    expect(source).toMatch(/payment_method_collection: skipCardCollection \? "if_required" : "always"/);
    expect(source).toMatch(/assertBusinessCanStartTrialCheckout/);
    expect(source).toMatch(/accessStatus: "approved_not_activated"/);
    expect(source).toMatch(/checkout_purpose: "trial_start"/);
    expect(source).toMatch(/trial_period_days: STANDARD_TRIAL_DAYS/);
    expect(source).toMatch(/app_access_after: "approved_not_activated"/);
    expect(source).not.toMatch(/user_owns_business_location/);
    expect(source).not.toMatch(/trial_acknowledged/);
    expect(source).not.toMatch(/trial_checkout_intents/);
    expect(source).not.toMatch(/trial_period_days: TRIAL_DAYS/);
    expect(source).not.toMatch(/subscription_tier/);
    // Audit F-005: the request body must never choose the Stripe price or a
    // gate-bypassing source. The price is resolved server-side only; "test"
    // does not exist as a source; the token branch is pinned to "email"; and
    // "admin" requires a verified active admin role.
    expect(source).not.toMatch(/body\.price_id/);
    expect(source).not.toMatch(/=== "test"/);
    expect(source).toMatch(/source = "email"/);
    expect(source).toMatch(/source = requestedSource === "admin" && adminCanCreateCheckout\(authz\.adminRole\) \? "admin" : "website"/);
    // Audit F-006: token consumption goes through the atomic RPC; no JS-side
    // read-then-update on use_count may remain.
    expect(source).toMatch(/rpc\("consume_billing_token"/);
    expect(source).not.toMatch(/use_count/);
  });

  it("consumes billing tokens only through the atomic service-role RPC (audit F-006)", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase", "migrations", "20260813120000_consume_billing_token_rpc.sql"),
      "utf8",
    );
    // One conditional UPDATE + GET DIAGNOSTICS => concrete boolean, race-safe.
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.consume_billing_token/);
    expect(migration).toMatch(/SET use_count = use_count \+ 1/);
    expect(migration).toMatch(/use_count < max_uses/);
    expect(migration).toMatch(/revoked_at IS NULL/);
    expect(migration).toMatch(/expires_at > p_now/);
    expect(migration).toMatch(/GET DIAGNOSTICS/);
    // Service-role only; anon/authenticated revoked explicitly (REVOKE FROM
    // PUBLIC alone does not remove Supabase's default grants).
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.consume_billing_token[^;]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.consume_billing_token[^;]*TO service_role/);
  });

  it("exchanges an emailed checkout token by reusing the audited checkout function", () => {
    const source = readFunction("business-checkout-link");
    // Resolve the application from the hashed, emailed token.
    expect(source).toMatch(/from\("business_applications"\)/);
    expect(source).toMatch(/\.eq\("checkout_token_hash", tokenHash\)/);
    // If the owner hasn't materialized a business yet, prompt signup WITHOUT
    // minting a token or touching Stripe.
    expect(source).toMatch(/reason: "signup_required"/);
    const signupAt = source.indexOf('reason: "signup_required"');
    const mintAt = source.indexOf('from("billing_tokens").insert');
    expect(signupAt).toBeGreaterThan(-1);
    expect(mintAt).toBeGreaterThan(-1);
    expect(signupAt).toBeLessThan(mintAt);
    // Reuse the audited checkout function through a single-use billing token,
    // preserving all of its guards, rather than duplicating checkout logic.
    expect(source).toMatch(/action: "subscription_checkout"/);
    expect(source).toMatch(/functions\/v1\/stripe-create-checkout-session/);
    expect(source).toMatch(/source: "email"/);
    expect(source).toMatch(/billing_token: rawBillingToken/);
    // Per-business abuse throttle before any Stripe session is created.
    expect(source).toMatch(/const THROTTLE_MAX_PER_BUSINESS\s*=\s*\d+/);
    expect(source).toMatch(/\},\s*429\)/);
    // Public endpoint: generic errors, never expose upstream secrets.
    expect(source).toMatch(/This link isn't available/);
    expect(source).not.toMatch(/OPENAI_API_KEY|STRIPE_SECRET_KEY/);
  });

  it("registers the public checkout-link exchange function", () => {
    const config = readFileSync(join(process.cwd(), "supabase", "config.toml"), "utf8");
    expect(config).toMatch(
      /\[functions\.business-checkout-link\][\s\S]*verify_jwt\s*=\s*false[\s\S]*entrypoint\s*=\s*"\.\/functions\/business-checkout-link\/index\.ts"/,
    );
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
    // Audit F-006: same atomic RPC as checkout; no use_count read-then-update.
    expect(source).toMatch(/rpc\("consume_billing_token"/);
    expect(source).not.toMatch(/use_count/);
    // Token sessions are always recorded as the "email" surface.
    expect(source).toMatch(/source = "email"/);
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
    expect(source).toMatch(/shouldDeferTrialSubscriptionSync\(existingStatus, status\)/);
    expect(source).toMatch(/metadata: mergedMetadata/);
    expect(source).toMatch(/existingStatus === "approved_not_activated"/);
    expect(source).toMatch(/effectiveAccess/);
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

  it("suspends access on chargebacks and never auto-restores on a won dispute", () => {
    const source = readFunction("stripe-webhook");
    // Finding 03: charge.dispute.created must be recognized and routed to an
    // immediate forced suspension, with the customer id resolved from the
    // Dispute's charge/payment_intent (Disputes have no .customer field).
    expect(source).toMatch(/async function stripeCustomerIdForDispute/);
    expect(source).toMatch(/event\.type === "charge\.dispute\.created"\s*\n\s*\? await stripeCustomerIdForDispute\(stripe, obj\)/);
    expect(source).toMatch(/forceChargebackSuspend\?:\s*boolean/);
    expect(source).toMatch(
      /const access = params\.forceChargebackSuspend\s*\n\s*\? \{ billingStatus: "chargeback", appAccessStatus: "suspended" \}/,
    );
    expect(source).toMatch(/event\.type === "charge\.dispute\.created"\) \{/);
    expect(source).toMatch(/forceChargebackSuspend: true/);
    // Dan confirmed 2026-07-06: no restore-on-won branch. charge.dispute.closed
    // must never be a handled dispatch condition that grants access back.
    expect(source).not.toMatch(/event\.type === "charge\.dispute\.closed"/);
  });

  it("asserts the expected Stripe price and fails closed on an unknown status (Finding 07)", () => {
    const source = readFunction("stripe-webhook");
    expect(source).toMatch(
      /if \(subscription && \(status === "active" \|\| status === "trialing" \|\| access\.appAccessStatus === "active" \|\| access\.appAccessStatus === "trialing"\)\) \{/,
    );
    expect(source).toMatch(/assertExpectedPrice\(priceConfig, subscription\)/);
    // The permissive `cancelAtPeriodEnd ? active : pending` fallback must be
    // gone -- any unrecognized status now always returns pending.
    expect(source).not.toMatch(/cancelAtPeriodEnd\s*\?\s*\{\s*billingStatus:\s*"active"/);
  });

  it("marks the location's trial as used once a trialing subscription is confirmed (Finding 05 bookkeeping)", () => {
    const source = readFunction("stripe-webhook");
    expect(source).toMatch(/if \(orderedAccess\.appAccessStatus === "trialing"\) \{/);
    expect(source).toMatch(/ensurePrimaryBusinessLocationId\(supabase, businessId\)/);
    expect(source).toMatch(/from\("business_location_identity"\)\.upsert\(/);
  });

  it("gates the no-card trial on the global switch + reuse guard, then a code as a last-resort override", () => {
    const source = readFunction("stripe-create-checkout-session");
    expect(source).toMatch(/async function consumeTrialNoCardExemptionCode/);
    expect(source).toMatch(/consume_trial_no_card_exemption_code/);
    expect(source).toMatch(/async function isBusinessLocationTrialAlreadyUsed/);
    expect(source).toMatch(/check_business_location_trial_reuse/);
    // The automatic no-card grant is gated on the switch AND the per-location
    // reuse guard...
    expect(source).toMatch(/if \(!config\.requireCardForTrial\) \{/);
    expect(source).toMatch(/skipCardCollection = !\(locationId && \(await isBusinessLocationTrialAlreadyUsed\(/);
    // ...and the code is only consumed when the card would otherwise be
    // required, so a limited-use code is never burned needlessly.
    expect(source).toMatch(/if \(!skipCardCollection\) \{\s*\n\s*skipCardCollection = await consumeTrialNoCardExemptionCode\(/);
    expect(source).toMatch(/trial_period_days: STANDARD_TRIAL_DAYS/);
    expect(source).not.toMatch(/trial_period_days: TRIAL_DAYS/);
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
