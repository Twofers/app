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
