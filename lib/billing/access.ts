import type { SubscriptionStatus } from "@/hooks/use-business";
import type { BillingStatus, PurchaseSurface } from "@/lib/billing/entitlements";

/** Paid tiers, checkout, and customer portal surfaces are enabled for this build. */
export const PAID_BILLING_ENABLED = true;

/**
 * While true, billing is visible for checkout testing but does not block setup
 * or deal creation.
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

function isCurrentOrMissing(endsAt: string | null): boolean {
  if (!endsAt) return true;
  return !isTrialExpired(endsAt);
}

export function canCreateDealWithLocationBilling(params: {
  isLoggedIn: boolean;
  status: BillingStatus;
  purchaseSurface: PurchaseSurface;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  bypass?: boolean;
}): boolean {
  if (!params.isLoggedIn) return false;
  if (params.bypass) return true;
  if (PILOT_DISABLE_BILLING_GATE) return true;
  if (params.purchaseSurface === "disabled") return true;

  switch (params.status) {
    case "trial_active":
    case "admin_trial_active":
      return isCurrentOrMissing(params.trialEndsAt ?? params.currentPeriodEndsAt);
    case "trial_canceling":
      return isCurrentOrMissing(params.trialEndsAt ?? params.currentPeriodEndsAt);
    case "pro_active":
    case "paid_active":
      return true;
    case "pro_canceling":
    case "paid_canceling":
      return isCurrentOrMissing(params.currentPeriodEndsAt);
    default:
      return false;
  }
}

