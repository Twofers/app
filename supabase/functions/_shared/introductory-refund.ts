export type IntroductoryRefundDecisionReason =
  | "eligible"
  | "missing_first_paid_at"
  | "already_refunded"
  | "outside_window"
  | "usage_requires_support";

export type IntroductoryRefundDecision = {
  eligible: boolean;
  reason: IntroductoryRefundDecisionReason;
};

const DAY_MS = 24 * 60 * 60 * 1000;
export const INTRODUCTORY_REFUND_WINDOW_DAYS = 7;

export function isWithinIntroductoryRefundWindow(
  firstPaidAt: string | null | undefined,
  nowMs: number,
  windowDays = INTRODUCTORY_REFUND_WINDOW_DAYS,
): boolean {
  if (!firstPaidAt) return false;
  const firstPaidAtMs = Date.parse(firstPaidAt);
  if (!Number.isFinite(firstPaidAtMs)) return false;
  if (nowMs < firstPaidAtMs) return false;
  return nowMs - firstPaidAtMs <= windowDays * DAY_MS;
}

export function decideIntroductoryRefund(params: {
  firstPaidAt: string | null | undefined;
  introductoryRefundUsedAt: string | null | undefined;
  creditsUsed: number;
  refundMaxPaidCreditsUsed: number | null | undefined;
  nowMs: number;
}): IntroductoryRefundDecision {
  if (!params.firstPaidAt) return { eligible: false, reason: "missing_first_paid_at" };
  if (params.introductoryRefundUsedAt) return { eligible: false, reason: "already_refunded" };
  if (!isWithinIntroductoryRefundWindow(params.firstPaidAt, params.nowMs)) {
    return { eligible: false, reason: "outside_window" };
  }

  const maxUsed = params.refundMaxPaidCreditsUsed;
  if (typeof maxUsed === "number" && Number.isFinite(maxUsed) && params.creditsUsed > maxUsed) {
    return { eligible: false, reason: "usage_requires_support" };
  }

  return { eligible: true, reason: "eligible" };
}

export function nonNegativeInteger(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}
