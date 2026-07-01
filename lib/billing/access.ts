import type { SubscriptionStatus } from "@/hooks/use-business";
import type { BillingStatus, PurchaseSurface } from "@/lib/billing/entitlements";
import { isMerchantAccessAllowedStatus } from "@/lib/merchant-access";

/** Backend/web billing remains enabled in the codebase. Mobile purchase UI is gated separately below. */
export const PAID_BILLING_ENABLED = true;

/**
 * Legacy pilot switch. Do not use this to bypass mobile merchant access; the
 * App Store build gates merchant tools by Supabase entitlement status.
 */
export const PILOT_DISABLE_BILLING_GATE = true;

const MOBILE_STRIPE_FLAG = "EXPO_PUBLIC_ENABLE_MOBILE_STRIPE";
const MOBILE_SUBSCRIPTION_CTA_FLAG = "EXPO_PUBLIC_ENABLE_MOBILE_SUBSCRIPTION_CTA";
const BUSINESS_SELF_SERVE_MOBILE_FLAG = "EXPO_PUBLIC_ENABLE_BUSINESS_SELF_SERVE_MOBILE";
const MOBILE_PRICING_PAGE_FLAG = "EXPO_PUBLIC_ENABLE_MOBILE_PRICING_PAGE";
const MOBILE_BILLING_LINKS_FLAG = "EXPO_PUBLIC_ENABLE_MOBILE_BILLING_LINKS";

function isDevRuntime(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

function isExplicitlyEnabled(name: string): boolean {
  return process.env[name] === "true";
}

function isDevEnabledFlag(name: string): boolean {
  return isDevRuntime() && isExplicitlyEnabled(name);
}

export function isMobileStripeEnabled(): boolean {
  return isDevEnabledFlag(MOBILE_STRIPE_FLAG);
}

export function isMobileSubscriptionCtaEnabled(): boolean {
  return isDevEnabledFlag(MOBILE_SUBSCRIPTION_CTA_FLAG);
}

export function isBusinessSelfServeMobileEnabled(): boolean {
  return isDevEnabledFlag(BUSINESS_SELF_SERVE_MOBILE_FLAG);
}

export function isMobilePricingPageEnabled(): boolean {
  return isDevEnabledFlag(MOBILE_PRICING_PAGE_FLAG);
}

export function isMobileBillingLinksEnabled(): boolean {
  return isDevEnabledFlag(MOBILE_BILLING_LINKS_FLAG);
}

export function isMobilePaidBillingEnabled(): boolean {
  return (
    PAID_BILLING_ENABLED &&
    isMobileStripeEnabled() &&
    isMobileSubscriptionCtaEnabled() &&
    isBusinessSelfServeMobileEnabled() &&
    isMobilePricingPageEnabled() &&
    isMobileBillingLinksEnabled()
  );
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

