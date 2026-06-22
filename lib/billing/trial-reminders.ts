import type { BillingStatus } from "./entitlements";

export type TrialReminderWindowDays = 7 | 3 | 1;

const DAY_MS = 24 * 60 * 60 * 1000;

export function getTrialReminderWindowDays(
  status: BillingStatus,
  trialEndsAt: string | null,
  nowMs: number = Date.now(),
): TrialReminderWindowDays | null {
  if (status !== "trial_active" || !trialEndsAt) return null;
  const trialEndsAtMs = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(trialEndsAtMs)) return null;

  const remainingDays = Math.ceil((trialEndsAtMs - nowMs) / DAY_MS);
  if (remainingDays <= 0 || remainingDays > 7) return null;
  if (remainingDays <= 1) return 1;
  if (remainingDays <= 3) return 3;
  return 7;
}

export function canManageBillingInPortal(status: BillingStatus): boolean {
  return (
    status === "trial_active" ||
    status === "trial_canceling" ||
    status === "pro_active" ||
    status === "pro_canceling" ||
    status === "paid_active" ||
    status === "paid_canceling"
  );
}
