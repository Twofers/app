import type { BillingStatus, LocationBillingSummary } from "@/lib/billing/entitlements";

export type MerchantAccessResult = {
  canAccessMerchantTools: boolean;
  status: string | null;
  reason: string | null;
};

const ALLOWED_STATUSES = new Set<string>([
  "trial_active",
  "admin_trial_active",
  "trial_canceling",
  "pro_active",
  "pro_canceling",
  "paid_active",
  "paid_canceling",
]);

export function isMerchantAccessAllowedStatus(status: BillingStatus | string | null): boolean {
  return typeof status === "string" && ALLOWED_STATUSES.has(status);
}

// Blocked statuses that mean the owner never activated anything yet: a brand-new
// business (fresh location defaults to trial_eligible) or a web checkout they
// started but never finished. These get the "start your free trial" path.
// Every OTHER blocked status is a lapsed account — trial expired, suspended,
// canceled, or refunded — and must NOT be told to start a free trial; those keep
// the "contact support" message.
const NEVER_ACTIVATED_STATUSES = new Set<string>([
  "trial_eligible",
  "trial_checkout_pending",
]);

export function isNeverActivatedBillingStatus(status: BillingStatus | string | null | undefined): boolean {
  return status == null || NEVER_ACTIVATED_STATUSES.has(status);
}

export function getMerchantAccessForBillingSummary(params: {
  isLoggedIn: boolean;
  businessId: string | null;
  summary: LocationBillingSummary;
  bypass?: boolean;
}): MerchantAccessResult {
  if (!params.isLoggedIn) {
    return { canAccessMerchantTools: false, status: null, reason: "unauthenticated" };
  }
  if (params.bypass) {
    return { canAccessMerchantTools: true, status: params.summary.status, reason: "development_bypass" };
  }
  if (!params.businessId) {
    return { canAccessMerchantTools: false, status: null, reason: "no_business" };
  }
  if (isMerchantAccessAllowedStatus(params.summary.status)) {
    return { canAccessMerchantTools: true, status: params.summary.status, reason: null };
  }
  return { canAccessMerchantTools: false, status: params.summary.status, reason: "inactive_status" };
}
