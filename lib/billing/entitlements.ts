export const PURCHASE_SURFACES = ["disabled", "in_app_link", "web_only"] as const;
export type PurchaseSurface = (typeof PURCHASE_SURFACES)[number];

export const BILLING_STATUSES = [
  "trial_eligible",
  "trial_active",
  "trial_credit_limit_reached",
  "trial_expired_suspended",
  "checkout_pending",
  "paid_active",
  "paid_canceling",
  "payment_failed_suspended",
  "canceled_suspended",
  "refunded_suspended",
] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export type LocationBillingSummary = {
  businessLocationId: string | null;
  status: BillingStatus;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodStartedAt: string | null;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  suspensionReason: string | null;
  creditsGranted: number;
  creditsUsed: number;
  creditsReserved: number;
  creditsRemaining: number;
  refundEligible: boolean;
  purchaseSurface: PurchaseSurface;
  configuredTrialAllowance: number;
  configuredPaidAllowance: number;
};

const PURCHASE_SURFACE_SET = new Set<string>(PURCHASE_SURFACES);
const BILLING_STATUS_SET = new Set<string>(BILLING_STATUSES);

export function normalizePurchaseSurface(value: unknown): PurchaseSurface {
  return typeof value === "string" && PURCHASE_SURFACE_SET.has(value) ? (value as PurchaseSurface) : "disabled";
}

export function normalizeBillingStatus(value: unknown): BillingStatus {
  return typeof value === "string" && BILLING_STATUS_SET.has(value) ? (value as BillingStatus) : "trial_eligible";
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nonNegativeInt(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

export function createSafeDisabledBillingSummary(
  businessLocationId: string | null = null,
): LocationBillingSummary {
  return {
    businessLocationId,
    status: "trial_eligible",
    trialStartedAt: null,
    trialEndsAt: null,
    currentPeriodStartedAt: null,
    currentPeriodEndsAt: null,
    cancelAtPeriodEnd: false,
    suspensionReason: null,
    creditsGranted: 0,
    creditsUsed: 0,
    creditsReserved: 0,
    creditsRemaining: 0,
    refundEligible: false,
    purchaseSurface: "disabled",
    configuredTrialAllowance: 30,
    configuredPaidAllowance: 60,
  };
}

export function parseLocationBillingSummary(
  value: unknown,
  fallbackLocationId: string | null = null,
): LocationBillingSummary {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") {
    return createSafeDisabledBillingSummary(fallbackLocationId);
  }

  const data = row as Record<string, unknown>;
  const creditsGranted = nonNegativeInt(data.credits_granted);
  const creditsUsed = nonNegativeInt(data.credits_used);
  const creditsReserved = nonNegativeInt(data.credits_reserved);
  const creditsRemaining = nonNegativeInt(
    data.credits_remaining,
    Math.max(creditsGranted - creditsUsed - creditsReserved, 0),
  );

  return {
    businessLocationId: stringOrNull(data.business_location_id) ?? fallbackLocationId,
    status: normalizeBillingStatus(data.status),
    trialStartedAt: stringOrNull(data.trial_started_at),
    trialEndsAt: stringOrNull(data.trial_ends_at),
    currentPeriodStartedAt: stringOrNull(data.current_period_started_at),
    currentPeriodEndsAt: stringOrNull(data.current_period_ends_at),
    cancelAtPeriodEnd: data.cancel_at_period_end === true,
    suspensionReason: stringOrNull(data.suspension_reason),
    creditsGranted,
    creditsUsed,
    creditsReserved,
    creditsRemaining,
    refundEligible: data.refund_eligible === true,
    purchaseSurface: normalizePurchaseSurface(data.purchase_surface),
    configuredTrialAllowance: nonNegativeInt(data.configured_trial_allowance, 30),
    configuredPaidAllowance: nonNegativeInt(data.configured_paid_allowance, 60),
  };
}

export function isSuspendedBillingStatus(status: BillingStatus): boolean {
  return (
    status === "trial_expired_suspended" ||
    status === "payment_failed_suspended" ||
    status === "canceled_suspended" ||
    status === "refunded_suspended"
  );
}

export function isBillingStatusCreditBlocked(status: BillingStatus): boolean {
  return status === "trial_credit_limit_reached" || isSuspendedBillingStatus(status);
}
