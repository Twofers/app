import { MAX_DEAL_DURATION_MINUTES } from "./deal-schedule-defaults";

/**
 * Builds a deal-schedule preset from `business_slow_hours` rows (collected at
 * website signup / onboarding). Only structured rows (day_of_week + both times)
 * are used; free-text-only rows are ignored so the preset never guesses.
 * The window is clamped to the max deal duration so applying the preset always
 * passes the schedule guardrail.
 */

export type SlowHoursRow = {
  day_of_week: number | null;
  /** Postgres `time` — "HH:MM:SS" or "HH:MM". */
  starts_at: string | null;
  ends_at: string | null;
};

export type SlowHoursSchedulePreset = {
  /** Deal-schedule day values: 1 = Monday … 7 = Sunday. */
  days: number[];
  startMin: number;
  endMin: number;
};

function timeToMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

/** business_slow_hours uses 0–6 (0 = Sunday); deal schedules use 1–7 (7 = Sunday). */
function toDealDayOfWeek(day: number): number {
  return day === 0 ? 7 : day;
}

export function buildSlowHoursSchedulePreset(
  rows: SlowHoursRow[] | null | undefined,
): SlowHoursSchedulePreset | null {
  if (!rows?.length) return null;
  const structured = rows.filter(
    (row) =>
      row.day_of_week != null &&
      row.day_of_week >= 0 &&
      row.day_of_week <= 6 &&
      timeToMinutes(row.starts_at) != null &&
      timeToMinutes(row.ends_at) != null,
  );
  if (!structured.length) return null;

  const days = [...new Set(structured.map((row) => toDealDayOfWeek(row.day_of_week as number)))].sort(
    (a, b) => a - b,
  );
  const startMin = Math.min(...structured.map((row) => timeToMinutes(row.starts_at) as number));
  const rawEndMin = Math.max(...structured.map((row) => timeToMinutes(row.ends_at) as number));
  const endMin = Math.min(rawEndMin, startMin + MAX_DEAL_DURATION_MINUTES);
  if (!days.length || endMin <= startMin) return null;

  return { days, startMin, endMin };
}
