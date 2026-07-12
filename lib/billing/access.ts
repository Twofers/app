import type { SubscriptionStatus } from "@/hooks/use-business";
import type { BillingStatus, PurchaseSurface } from "@/lib/billing/entitlements";
import { isMerchantAccessAllowedStatus } from "@/lib/merchant-access";

/** Backend/web billing remains enabled in the codebase. Mobile purchase UI is gated separately below. */
export const PAID_BILLING_ENABLED = true;

/**
 * Legacy pilot switch. Only gates the dead canCreateDeal() path below (it has
 * no callers anywhere in the app — the real merchant gate is
 * usePrimaryLocationBillingGate / get_location_billing_summary, which this
 * flag does not touch). Flipped to false once billing enforcement was
 * verified end-to-end (2026-07-06 QA pass): trial/paid publish succeeds,
 * canceled/expired/suspended publish is blocked with LOCATION_BILLING_SUSPENDED.
 */
export const PILOT_DISABLE_BILLING_GATE = false;

export function isMobileStripeEnabled(): boolean {
  return false;
}

export function isMobileSubscriptionCtaEnabled(): boolean {
  return false;
}

export function isBusinessSelfServeMobileEnabled(): boolean {
  return false;
}

export function isMobilePricingPageEnabled(): boolean {
  return false;
}

export function isMobileBillingLinksEnabled(): boolean {
  return false;
}

export function isMobilePaidBillingEnabled(): boolean {
  return false;
}

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
      return isMerchantAccessAllowedStatus(params.status);
  }
}

