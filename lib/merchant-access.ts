import type { BillingStatus, LocationBillingSummary } from "@/lib/billing/entitlements";
import type { CanonicalBusinessCapabilities } from "@/lib/business-capabilities";

export type MerchantAccessResult = {
  canAccessMerchantTools: boolean;
  canUseSetupTools: boolean;
  canUseMenuTools: boolean;
  canExtractInitialMenu: boolean;
  canCreateTextDraft: boolean;
  canGenerateAi: boolean;
  canPublishOffer: boolean;
  canReceiveNewClaims: boolean;
  canRedeemExistingClaims: boolean;
  canManageBilling: boolean;
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
  "approved_not_activated",
  "trial_eligible",
  "trial_checkout_pending",
]);

const APPROVED_SETUP_BUSINESS_STATUSES = new Set<string>([
  "approved_not_activated",
]);

const LAPSED_STATUSES = new Set<string>([
  "trial_expired_suspended",
  "trial_expired_payment_failed_suspended",
  "trial_canceled",
  "canceled_suspended",
]);

export function isNeverActivatedBillingStatus(status: BillingStatus | string | null | undefined): boolean {
  return status == null || NEVER_ACTIVATED_STATUSES.has(status);
}

export function getMerchantAccessFromCapabilities(params: {
  capabilities: CanonicalBusinessCapabilities;
  status: string | null;
}): MerchantAccessResult {
  const capabilities = params.capabilities;
  return {
    canAccessMerchantTools:
      capabilities.can_generate_ai ||
      capabilities.can_consume_offer_credits ||
      capabilities.can_publish_offer,
    canUseSetupTools: capabilities.can_use_setup_tools,
    canUseMenuTools: capabilities.can_use_menu_tools,
    canExtractInitialMenu: capabilities.can_extract_initial_menu,
    canCreateTextDraft: capabilities.can_create_text_draft,
    canGenerateAi: capabilities.can_generate_ai,
    canPublishOffer: capabilities.can_publish_offer,
    canReceiveNewClaims: capabilities.can_receive_new_claims,
    canRedeemExistingClaims: capabilities.can_redeem_existing_claims,
    canManageBilling: capabilities.can_manage_billing,
    status: params.status,
    reason: capabilities.reason_code,
  };
}

export function getMerchantAccessForBillingSummary(params: {
  isLoggedIn: boolean;
  businessId: string | null;
  summary: LocationBillingSummary;
  businessStatus?: string | null;
  bypass?: boolean;
}): MerchantAccessResult {
  const inactive = {
    canAccessMerchantTools: false,
    canUseSetupTools: false,
    canUseMenuTools: false,
    canExtractInitialMenu: false,
    canCreateTextDraft: false,
    canGenerateAi: false,
    canPublishOffer: false,
    canReceiveNewClaims: false,
    canRedeemExistingClaims: false,
    canManageBilling: false,
  };
  if (!params.isLoggedIn) {
    return { ...inactive, status: null, reason: "unauthenticated" };
  }
  if (params.bypass) {
    return {
      canAccessMerchantTools: true,
      canUseSetupTools: true,
      canUseMenuTools: true,
      canExtractInitialMenu: true,
      canCreateTextDraft: true,
      canGenerateAi: true,
      canPublishOffer: true,
      canReceiveNewClaims: true,
      canRedeemExistingClaims: true,
      canManageBilling: true,
      status: params.summary.status,
      reason: "development_bypass",
    };
  }
  if (!params.businessId) {
    return { ...inactive, status: null, reason: "no_business" };
  }
  const approvedSetup = APPROVED_SETUP_BUSINESS_STATUSES.has(String(params.businessStatus ?? "")) ||
    params.summary.status === "approved_not_activated";
  if (approvedSetup) {
    return {
      canAccessMerchantTools: false,
      canUseSetupTools: true,
      canUseMenuTools: true,
      canExtractInitialMenu: true,
      canCreateTextDraft: true,
      canGenerateAi: false,
      canPublishOffer: false,
      canReceiveNewClaims: false,
      canRedeemExistingClaims: false,
      canManageBilling: true,
      status: params.summary.status,
      reason: "approved_not_activated",
    };
  }
  if (isMerchantAccessAllowedStatus(params.summary.status)) {
    return {
      canAccessMerchantTools: true,
      canUseSetupTools: true,
      canUseMenuTools: true,
      canExtractInitialMenu: true,
      canCreateTextDraft: true,
      canGenerateAi: true,
      canPublishOffer: true,
      canReceiveNewClaims: true,
      canRedeemExistingClaims: true,
      canManageBilling: true,
      status: params.summary.status,
      reason: null,
    };
  }
  const lapsed = LAPSED_STATUSES.has(params.summary.status);
  return {
    ...inactive,
    canUseMenuTools: lapsed,
    canExtractInitialMenu: false,
    canCreateTextDraft: lapsed,
    canRedeemExistingClaims: lapsed,
    canManageBilling: lapsed,
    status: params.summary.status,
    reason: "inactive_status",
  };
}
