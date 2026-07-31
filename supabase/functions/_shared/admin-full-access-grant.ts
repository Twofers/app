import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { applyBusinessBillingAccessState } from "./business-location-entitlement-sync.ts";

type DbClient = SupabaseClient<any, any, any, any, any>;

/**
 * The approve_full_access grant: working access now, no Checkout step, running
 * out after an admin-chosen number of days.
 *
 * There are two moments this can fire, which is why it lives here rather than in
 * either caller:
 *   - the business already exists at approval time -> admin-business-applications
 *     applies it inline as part of the decision;
 *   - the business does not exist yet (the common case: business_id is NULL
 *     until the owner claims) -> the decision only records the marker columns,
 *     and get-business-onboarding-context applies it right after the claim.
 *
 * Both paths must produce byte-identical state, so both call this.
 *
 * `admin_comp` is the only trial_type the business_subscriptions CHECK allows
 * for an admin grant, and deliberately is not `stripe_trial` — the location
 * entitlement resolver keys off that to pick `admin_trial_active`.
 *
 * No deal-credit period is created: credit enforcement short-circuits on
 * app_runtime_config.deal_credit_enforcement_enabled, which is false. If that is
 * ever switched on, this is the place that needs a credit grant.
 */
export const FULL_ACCESS_TRIAL_TYPE = "admin_comp";

/** Access states a grant must never quietly overwrite. */
const PROTECTED_APP_ACCESS = new Set([
  "trialing",
  "trial_limited",
  "active",
  "past_due_grace",
  "comped",
]);

export async function grantFullAccessTrial(params: {
  supabase: DbClient;
  businessId: string;
  trialDays: number;
  /** Recorded on business_subscriptions.source for traceability. */
  source: string;
}): Promise<{ trialStart: string; trialEnd: string }> {
  const { supabase, businessId, trialDays, source } = params;
  const startedAt = new Date();
  const trialStart = startedAt.toISOString();
  const trialEnd = new Date(startedAt.getTime() + trialDays * 24 * 60 * 60 * 1000).toISOString();

  const { error: upsertError } = await supabase.from("business_subscriptions").upsert(
    {
      business_id: businessId,
      billing_mode: "web_stripe",
      billing_status: "none",
      app_access_status: "trialing",
      trial_type: FULL_ACCESS_TRIAL_TYPE,
      trial_start: trialStart,
      trial_end: trialEnd,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      source,
      updated_at: trialStart,
    },
    { onConflict: "business_id" },
  );
  if (upsertError) throw upsertError;

  // Mirrors into businesses, business_applications, and location_entitlements.
  await applyBusinessBillingAccessState({
    supabase,
    businessId,
    provider: "admin",
    appAccessStatus: "trialing",
    trialType: FULL_ACCESS_TRIAL_TYPE,
    trialStart,
    trialEnd,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });

  return { trialStart, trialEnd };
}

/**
 * Applies a grant that was approved before the business existed. Safe to call on
 * every owner sign-in: it no-ops unless an unspent marker is present and the
 * business is still inert, and applying it moves app_access_status to `trialing`
 * so a second call finds nothing to do.
 *
 * Never throws into the caller's request — a failed grant leaves the marker in
 * place so the next sign-in retries.
 */
export async function applyPendingFullAccessGrant(params: {
  supabase: DbClient;
  businessId: string;
}): Promise<boolean> {
  const { supabase, businessId } = params;
  try {
    const { data: application, error: applicationError } = await supabase
      .from("business_applications")
      .select("id,full_access_trial_days")
      .eq("business_id", businessId)
      .not("full_access_trial_days", "is", null)
      .limit(1)
      .maybeSingle();
    if (applicationError) throw applicationError;

    const trialDays = Number(application?.full_access_trial_days);
    if (!Number.isFinite(trialDays) || trialDays < 1 || trialDays > 120) return false;

    const { data: subscription, error: subscriptionError } = await supabase
      .from("business_subscriptions")
      .select("app_access_status,activated_at,stripe_subscription_id")
      .eq("business_id", businessId)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;

    // Already live, already paid, or already converted: leave it alone. This is
    // also what makes repeat sign-ins idempotent.
    if (
      subscription?.activated_at ||
      subscription?.stripe_subscription_id ||
      PROTECTED_APP_ACCESS.has(String(subscription?.app_access_status ?? ""))
    ) {
      return false;
    }

    await grantFullAccessTrial({
      supabase,
      businessId,
      trialDays,
      source: "admin_approval_full_access_claim",
    });
    return true;
  } catch (error) {
    console.error(
      "[full-access-grant] could not apply pending grant:",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}
