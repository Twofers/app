export type DealReleaseNotificationInput = {
  is_active?: boolean | null;
  start_time?: string | null;
  end_time?: string | null;
};

export type DealReleaseNotificationState =
  | "live"
  | "upcoming"
  | "inactive"
  | "ended"
  | "missing_window"
  | "invalid_window";

export function resolveDealReleaseNotificationState(
  deal: DealReleaseNotificationInput,
  nowMs = Date.now(),
): DealReleaseNotificationState {
  if (deal.is_active === false) return "inactive";
  if (!deal.start_time || !deal.end_time) return "missing_window";

  const startMs = new Date(deal.start_time).getTime();
  const endMs = new Date(deal.end_time).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return "invalid_window";
  }
  if (startMs > nowMs) return "upcoming";
  if (endMs <= nowMs) return "ended";
  return "live";
}

export function dealReleaseScheduledFor(deal: DealReleaseNotificationInput): string | null {
  if (!deal.start_time) return null;
  const start = new Date(deal.start_time);
  return Number.isFinite(start.getTime()) ? start.toISOString() : null;
}
