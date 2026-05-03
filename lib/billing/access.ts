import type { SubscriptionStatus } from "@/hooks/use-business";

/**
 * Pilot launch flag. While true, the trial-end paywall does not block deal
 * creation: any logged-in business user can keep working past their trial
 * expiration. Subscribe buttons are also hidden in `app/(tabs)/billing.tsx`.
 *
 * Flip to `false` for v1.1 once Stripe live mode is wired (see
 * `docs/stripe-setup.md`) and pilot cafes have signed paid agreements.
 */
export const PILOT_DISABLE_BILLING_GATE = true;

export function isBillingBypassEnabled(skipSetup?: string, e2e?: string): boolean {
  if (!__DEV__) return false;
  return String(e2e ?? "") === "1" || String(skipSetup ?? "") === "1";
}

export function isTrialExpired(trialEndsAt: string | null): boolean {
  if (!trialEndsAt) return true;
  const ms = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(ms)) return true;
  return Date.now() > ms;
}

export function canCreateDeal(params: {
  isLoggedIn: boolean;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  bypass?: boolean;
}): boolean {
  // Only check billing eligibility for logged-in users. When not logged in,
  // the auth gate will redirect — billing check is irrelevant.
  if (!params.isLoggedIn) return false;
  if (params.bypass) return true;
  // Pilot: trial expiration does not block deal creation.
  if (PILOT_DISABLE_BILLING_GATE) return true;
  if (params.subscriptionStatus === "active") return true;
  if (params.subscriptionStatus === "trial") {
    // Null trialEndsAt with trial status means the trial was just created and the
    // date hasn't been set yet (auto-repair in useBusiness is still in-flight).
    // Treat as active trial rather than blocking the user.
    if (!params.trialEndsAt) return true;
    if (!isTrialExpired(params.trialEndsAt)) return true;
  }
  return false;
}

