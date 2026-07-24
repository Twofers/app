import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const migrationPath =
  "supabase/migrations/20260817120000_approved_not_activated_activation_gate.sql";

describe("approved-not-activated lifecycle", () => {
  it("makes every standard approval setup-only without trial dates or access", () => {
    const admin = read("supabase/functions/admin-business-applications/index.ts");
    const approvalEmail = read("supabase/functions/_shared/approval-email.ts");
    expect(admin).toMatch(/decision === "approve_setup" \|\| decision === "approve_limited"/);
    expect(admin).toMatch(/decision === "approve_setup_verified"[\s\S]*?status: "approved_not_activated"/);
    expect(admin).toMatch(/trialDays: null/);
    expect(admin).toMatch(/subscriptionAccessStatus: "approved_not_activated"/);
    // The pre-2026-07-23 name read as "grants full access" and never did. It
    // survives ONLY as a transition shim for the not-yet-deployed website
    // forms; it must never be a decision key the `decide` action accepts, or
    // the retired name is effectively back.
    const isDecisionFn = admin.slice(
      admin.indexOf("function isDecision"),
      admin.indexOf("function isApprovalDecision"),
    );
    expect(isDecisionFn).toBeTruthy();
    expect(isDecisionFn).not.toMatch(/"approve_full"/);
    // While the shim exists it must map to the renamed key, never fall through
    // to approve_limited (which would write basic_verified on a form that
    // promises manual verification).
    expect(admin).toMatch(
      /decision === "approve_setup_verified" \|\| decision === "approve_full"\s*\n?\s*\? "approve_setup_verified"/,
    );
    expect(admin).toMatch(/APPROVED_ACTIVATION_GATE_DISABLED/);
    expect(admin).toMatch(/linkedBusinessHasProtectedAccess/);
    expect(admin).toMatch(/LINKED_BUSINESS_ACCESS_PROTECTED/);
    expect(admin).toMatch(/PROTECTED_BUSINESS_ACCESS_LEVELS/);
    expect(approvalEmail).toMatch(/trial starts after you activate it through secure Checkout/i);
    expect(approvalEmail).toMatch(/AI image generation, publishing, customer claims, and offer credits unlock only after activation/i);
  });

  it("grants approve_full_access a live, time-boxed trial instead of approved_not_activated", () => {
    const admin = read("supabase/functions/admin-business-applications/index.ts");
    const fullAccess = admin.slice(
      admin.indexOf('if (decision === "approve_full_access")'),
      admin.indexOf('if (decision === "waitlist")'),
    );
    expect(fullAccess).toBeTruthy();
    // Access turns on now; Stripe is offered for conversion, never required.
    expect(fullAccess).toMatch(/businessAccessLevel: "full_trial"/);
    expect(fullAccess).toMatch(/subscriptionAccessStatus: "trialing"/);
    expect(fullAccess).toMatch(/businessStatus: "trialing"/);
    // The APPLICATION must stay approved_not_activated or an unclaimed grant is
    // stranded: claim_approved_business_application_for_user only matches that.
    expect(fullAccess).toMatch(/status: "approved_not_activated"/);
    expect(read(migrationPath)).toMatch(/ba\.status = 'approved_not_activated'/);

    // Bounded countdown, owner/admin only, and a distinct audit trail.
    expect(admin).toMatch(/MIN_FULL_ACCESS_TRIAL_DAYS = 1/);
    expect(admin).toMatch(/MAX_FULL_ACCESS_TRIAL_DAYS = 120/);
    expect(admin).toMatch(/INVALID_TRIAL_DAYS/);
    expect(admin).toMatch(/FULL_ACCESS_GRANT_FORBIDDEN/);
    expect(admin).toMatch(/function canGrantFullAccess[\s\S]*?role === "owner" \|\| role === "admin"/);
    expect(admin).toMatch(/admin_business_application_approved_full_access_comp/);

    // One grant implementation for both moments it can fire: inline when the
    // business already exists, and post-claim when it did not.
    const grant = read("supabase/functions/_shared/admin-full-access-grant.ts");
    expect(admin).toMatch(/grantFullAccessTrial\(/);
    expect(read("supabase/functions/get-business-onboarding-context/index.ts"))
      .toMatch(/applyPendingFullAccessGrant\(/);
    // trial_type must be a value the business_subscriptions CHECK allows, and
    // must not be stripe_trial or the location entitlement resolves wrong.
    expect(grant).toMatch(/FULL_ACCESS_TRIAL_TYPE = "admin_comp"/);
    expect(grant).not.toMatch(/"admin_trial"/);
    expect(grant).toMatch(/app_access_status: "trialing"/);
    // A grant must never quietly overwrite paid or Stripe-backed access.
    expect(grant).toMatch(/stripe_subscription_id/);
    expect(grant).toMatch(/PROTECTED_APP_ACCESS/);
  });

  it("lets a card-free admin trial still reach Stripe Checkout to convert", () => {
    const checkout = read("supabase/functions/stripe-create-checkout-session/index.ts");
    expect(checkout).toMatch(/onCardFreeAdminTrial/);
    // Converting is allowed only for an admin grant with nothing billed behind
    // it; a Stripe-backed trial or an activated business is still refused.
    expect(checkout).toMatch(/trial_type"\) === "admin_comp"|trial_type\) === "admin_comp"/);
    expect(checkout).toMatch(/!alreadyActivated &&\s*!alreadyHasProviderSubscription/);
    expect(checkout).toMatch(/BUSINESS_ALREADY_ACTIVATED/);
    // The grant moves the application to trial_active, so the eligibility
    // lookup has to accept that status or comped owners can never convert.
    expect(checkout).toMatch(/"approved_not_activated", "trial_active"/);
  });

  it("tells approve_full_access owners access is already live but still links Checkout", () => {
    const approvalEmail = read("supabase/functions/_shared/approval-email.ts");
    const variant = approvalEmail.slice(approvalEmail.indexOf("function buildFullAccessEmail"));
    expect(variant).toMatch(/days of full access are live now/i);
    expect(variant).toMatch(/No payment needed to start/i);
    // Dan's decision 2026-07-23: path B still converts to paid, so the checkout
    // link ships in this variant too.
    expect(variant).toMatch(/checkoutUrl/);
    expect(approvalEmail).toMatch(/function grantsAccessImmediately[\s\S]*?decision === "approve_full_access"/);
  });

  it("claims one approved application for the confirmed auth email in one transaction", () => {
    const migration = read(migrationPath);
    const claimStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.claim_approved_business_application_for_user",
    );
    const claimEnd = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.get_business_capabilities",
    );
    const claim = migration.slice(claimStart, claimEnd);
    expect(claim).toMatch(/email_confirmed_at IS NOT NULL/);
    expect(claim).toMatch(/lower\(btrim\(coalesce\(u\.email, ''\)\)\) = v_email/);
    expect(claim).toMatch(/approved_email_normalized/);
    expect(claim).toMatch(/pg_advisory_xact_lock/);
    expect(claim).toMatch(/AMBIGUOUS_APPROVED_APPLICATION_EMAIL/);
    expect(claim).toMatch(/claimed_by_user_id = p_user_id[\s\S]*RETURN NEXT/);
    expect(claim).toMatch(/'approved_not_activated'/);
    expect(claim).toMatch(/'trial_eligible'/);
    expect(claim).toMatch(/WHEN 'verified_low_risk' THEN 'basic_verified'/);
    expect(claim).not.toMatch(/deal_credit_periods|deal_credit_ledger/);
    expect(migration).toMatch(/APPROVED_APPLICATION_EMAIL_IS_IMMUTABLE/);

    const context = read("supabase/functions/get-business-onboarding-context/index.ts");
    const ensureStart = context.indexOf("async function ensureLinkedBusiness");
    const ensureEnd = context.indexOf("serve(async", ensureStart);
    const ensure = context.slice(ensureStart, ensureEnd);
    expect(ensure).toMatch(/claim_approved_business_application_for_user/);
    expect(ensure).not.toMatch(/\.from\("businesses"\)|materializeBusinessForUser/);
  });

  it("defines one canonical capability matrix and enforces it at database boundaries", () => {
    const migration = read(migrationPath);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.get_business_capabilities/);
    expect(migration).toMatch(/'can_generate_ai', v_active_access/);
    expect(migration).toMatch(/'can_publish_offer', v_active_access AND/);
    expect(migration).toMatch(/'can_receive_new_claims', v_active_access AND/);
    expect(migration).toMatch(/'can_redeem_existing_claims', v_active_access OR v_lapsed_access/);
    expect(migration).toMatch(/COALESCE\(v_subscription\.trial_end, v_subscription\.current_period_end\) IS NOT NULL/);
    expect(migration).not.toMatch(/v_now \+ interval '1 second'/);
    expect(migration).toMatch(/CREATE TRIGGER enforce_live_deal_business_capability/);
    expect(migration).toMatch(/CREATE TRIGGER enforce_new_claim_business_capability/);
    expect(migration).toMatch(/CREATE TRIGGER enforce_credit_reservation_business_capability/);
    expect(migration).toMatch(/CREATE TRIGGER enforce_business_workspace_capability/);
    expect(migration).toMatch(/APPROVED_APPLICATION_CLAIM_REQUIRED/);
    expect(migration).toMatch(/CREATE TRIGGER enforce_business_menu_capability/);
    expect(migration).toMatch(/approved_not_activated', 'rejected'/);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.is_publicly_visible_business/);
    expect(migration).toMatch(/public\.is_public_business_status\(b\.status\)/);

    const uiHook = read("hooks/use-business-capabilities.ts");
    const gate = read("hooks/use-primary-location-billing-gate.ts");
    expect(uiHook).toMatch(/rpc\("get_business_capabilities"/);
    expect(gate).toMatch(/getMerchantAccessFromCapabilities/);
    expect(gate).toMatch(/reason: "capability_unavailable"/);
  });

  it("rechecks capabilities before external AI/setup work, publication, claims, redemption, and pushes", () => {
    const capabilityFiles = [
      "supabase/functions/ai-compose-offer/index.ts",
      "supabase/functions/ai-deal-suggestions/index.ts",
      "supabase/functions/ai-extract-menu/index.ts",
      "supabase/functions/ai-generate-ad-variants/index.ts",
      "supabase/functions/ai-generate-deal-copy/index.ts",
      "supabase/functions/ai-studio-generate-draft/index.ts",
      "supabase/functions/ai-translate-deal/index.ts",
      "supabase/functions/ai-business-lookup/index.ts",
      "supabase/functions/import-business-website/index.ts",
      "supabase/functions/publish-offer-version/index.ts",
      "supabase/functions/claim-deal/index.ts",
      "supabase/functions/redeem-token/index.ts",
      "supabase/functions/send-deal-push/index.ts",
      "supabase/functions/update-business-profile-section/index.ts",
    ];
    for (const path of capabilityFiles) {
      expect(read(path), path).toMatch(/business-capabilities|getBusinessCapabilities/);
    }
    const menu = read("supabase/functions/ai-extract-menu/index.ts");
    // The OpenAI request now routes through the shared prepaid/fallback wrapper; the
    // allowance must still be consumed before that request is issued.
    expect(menu.indexOf("consume_setup_menu_extraction_allowance")).toBeLessThan(
      menu.indexOf('url: "https://api.openai.com/v1/responses"'),
    );
  });

  it("reserves one local activation checkout before Stripe and always requests a 30-day trial", () => {
    const checkout = read("supabase/functions/stripe-create-checkout-session/index.ts");
    const reservation = checkout.indexOf('.from("stripe_checkout_sessions").insert');
    const providerCreate = checkout.indexOf("stripe.checkout.sessions.create");
    expect(reservation).toBeGreaterThan(-1);
    expect(providerCreate).toBeGreaterThan(reservation);
    expect(checkout).toMatch(/application_id: applicationId/);
    expect(checkout).toMatch(/checkout_purpose: "trial_start"/);
    expect(checkout).toMatch(/trial_period_days: STANDARD_TRIAL_DAYS/);
    expect(checkout).toMatch(/STANDARD_TRIAL_DAYS\s*=\s*30/);
    expect(checkout).toMatch(/session_id=\{CHECKOUT_SESSION_ID\}/);
    expect(checkout).toMatch(/APPROVED_ACTIVATION_GATE_DISABLED/);
    expect(checkout).toMatch(/Production billing requires a live Stripe key/);
    expect(checkout).toMatch(/stripe\.checkout\.sessions\.expire\(staleStripeSessionId\)/);
    expect(checkout).toMatch(/TRIAL_CHECKOUT_COMPLETION_PENDING/);
  });

  it("makes verified Checkout completion the sole atomic initial unlock", () => {
    const webhook = read("supabase/functions/stripe-webhook/index.ts");
    const migration = read(migrationPath);
    expect(webhook).toMatch(/stripe\.checkout\.sessions\.retrieve\(sessionId\)/);
    expect(webhook).toMatch(/stripe\.subscriptions\.retrieve\(subscriptionId\)/);
    expect(webhook).toMatch(/status\) !== "trialing"/);
    expect(webhook).toMatch(/rpc\("activate_business_trial_from_checkout"/);
    expect(webhook).toMatch(/shouldDeferTrialSubscriptionSync/);
    expect(webhook).toMatch(/appAccessStatus: previousAppAccessStatus \?\? "pending"/);
    expect(webhook).toMatch(/checkout\.session\.expired/);
    expect(webhook).toMatch(/isRealPaidSubscriptionCycleInvoice/);
    expect(webhook).toMatch(/capabilities\.can_consume_offer_credits/);
    expect(webhook).toMatch(/event\.livemode !== expectedLivemode/);

    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.activate_business_trial_from_checkout/);
    expect(migration).toMatch(/activation_checkout_session_id/);
    expect(migration).toMatch(/activation_provider_event_id/);
    expect(migration).toMatch(/BUSINESS_TRIAL_ALREADY_ACTIVATED/);
    expect(migration).toMatch(/stripe_customer_livemode IS DISTINCT FROM p_livemode/);
    expect(migration).toMatch(/'stripe_trial:' \|\| p_checkout_session_id/);
    expect(migration).toMatch(/protect_business_subscription_activation/);
  });

  it("prevents stale provider events and locked accounts from being resurrected", () => {
    const migration = read(migrationPath);
    const webhook = read("supabase/functions/stripe-webhook/index.ts");
    expect(migration).toMatch(/protect_business_subscription_provider_order/);
    expect(migration).toMatch(/STALE_BUSINESS_SUBSCRIPTION_PROVIDER_EVENT/);
    expect(migration).toMatch(/BUSINESS_SUBSCRIPTION_ACCESS_IS_LOCKED/);
    expect(webhook).toMatch(/incomingEventMs < previousEventMs/);
    expect(webhook).toMatch(/if \(subscriptionSyncError\) throw subscriptionSyncError/);
    expect(webhook).toMatch(/access_locked_reason: "refund"/);
    expect(webhook).toMatch(/status: "suspended",[\s\S]*access_tier: "suspended"/);
    expect(webhook).toMatch(/forceChargebackSuspend: true/);
  });

  it("keeps preactivation drafts non-public and provides localized activation status", () => {
    const migration = read(migrationPath);
    const menuOffer = read("app/create/menu-offer.tsx");
    const createLayout = read("app/create/_layout.tsx");
    const tabsLayout = read("app/(tabs)/_layout.tsx");
    const statusScript = read("website/business/billing/activation-status.js");
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_deal_drafts/);
    expect(menuOffer).toMatch(/from\("business_deal_drafts"\)/);
    expect(menuOffer).toMatch(/draft_type: "text_only"/);
    expect(createLayout).toMatch(/leafRoute === "menu-scan" && access\.canExtractInitialMenu/);
    expect(createLayout).toMatch(/leafRoute === "menu-offer" && \(access\.canUseSetupTools \|\| access\.canCreateTextDraft\)/);
    expect(tabsLayout).toMatch(/!businessAccess\.canUseSetupTools/);
    expect(tabsLayout).toMatch(/!businessAccess\.canRedeemExistingClaims/);
    expect(statusScript).toMatch(/en: \{/);
    expect(statusScript).toMatch(/es: \{/);
    expect(statusScript).toMatch(/ko: \{/);
    expect(statusScript).toMatch(/twofer:localechange/);
  });

  it("classifies legacy cohorts using paginated evidence and preserves protected access", () => {
    const classifier = read("scripts/classify-approved-activation-cohorts.mjs");
    expect(classifier).toMatch(/async function fetchAll/);
    expect(classifier).toMatch(/\.range\(from, from \+ pageSize - 1\)/);
    expect(classifier).toMatch(/ai_generation_costs/);
    expect(classifier).toMatch(/hasLiveDeal/);
    expect(classifier).toMatch(/creditUseByLocation/);
    expect(classifier).toMatch(/hasActiveStripeSubscription/);
    expect(classifier).toMatch(/preserve/);
  });
});
