export const DEFAULT_DEAL_START_DELAY_MINUTES = 5;
export const DEFAULT_DEAL_DURATION_MINUTES = 60;
/** Guardrail: a deal may be claimable for at most 4 hours at a time (one-time span or recurring daily window). */
export const MAX_DEAL_DURATION_MINUTES = 4 * 60;

const MINUTE_MS = 60 * 1000;

export function dealDurationExceedsMax(durationMinutes: number): boolean {
  return durationMinutes > MAX_DEAL_DURATION_MINUTES;
}

export type OneTimeDealSchedule = {
  startTime: Date;
  endTime: Date;
};

export function createOneTimeDealScheduleFromStart(
  startTime: Date,
  durationMinutes = DEFAULT_DEAL_DURATION_MINUTES,
): OneTimeDealSchedule {
  const start = new Date(startTime);
  const end = new Date(start.getTime() + durationMinutes * MINUTE_MS);
  return { startTime: start, endTime: end };
}

export function createDefaultOneTimeDealSchedule(now = new Date()): OneTimeDealSchedule {
  const startTime = new Date(now.getTime() + DEFAULT_DEAL_START_DELAY_MINUTES * MINUTE_MS);
  return createOneTimeDealScheduleFromStart(startTime);
}
