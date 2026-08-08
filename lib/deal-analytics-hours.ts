/**
 * Timezone-safe bucketing for "busiest hour" analytics on the deal-analytics
 * screen (`app/deal-analytics/[id].tsx`).
 *
 * Bug this exists to fix: the screen used to read `new Date(c.created_at).getDay()`
 * / `.getHours()` directly, which reads the DEVICE's local clock. A claim made at
 * 10:40 PM America/Chicago (03:40 UTC the next day) was reported as "Busiest
 * around 3:00 AM local" because the reporting device's local timezone was
 * effectively UTC. `deal_claims.created_at` is a Postgres `TIMESTAMPTZ` column,
 * and PostgREST always serializes it with an explicit UTC offset (e.g.
 * `2026-08-06T22:40:00-05:00` or `...+00:00`), so `new Date(...)` already
 * captures the correct absolute instant — the parsing itself was never the
 * problem. `normalizeTimestamp` below is a defensive belt-and-suspenders step
 * only, in case a caller ever hands this an offset-less string (which `Date`
 * would otherwise treat as LOCAL time and silently mis-parse).
 */

/**
 * Ensure a timestamp string carries an explicit UTC/offset designator before
 * handing it to `new Date(...)`. A string missing "Z" or a `+HH:MM`/`-HH:MM`
 * suffix would otherwise be parsed as LOCAL time by the JS `Date` constructor,
 * silently shifting every downstream calculation. Postgres `TIMESTAMPTZ`
 * values returned via PostgREST always include an offset already, so this is
 * a defensive fallback rather than the normal path.
 */
export function normalizeTimestamp(raw: string): string {
  const trimmed = raw.trim();
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) return trimmed;
  return `${trimmed}Z`;
}

export type LocalDayAndHour = {
  /** 0=Sunday … 6=Saturday, matching JS `Date.getDay()` convention. */
  day: number;
  /** 0–23, local to the resolved timezone. */
  hour: number;
};

function partsToDayAndHour(date: Date, timeZone: string | undefined): LocalDayAndHour {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const year = Number(map.year);
  const month = Number(map.month);
  const dayOfMonth = Number(map.day);
  let hour = Number(map.hour);
  // Some ICU implementations format midnight as "24" under hour12:false; normalize to 0.
  if (hour === 24) hour = 0;
  // Reconstruct just the calendar date (already the timeZone's local date, since it came
  // from formatToParts against that zone) as a UTC instant purely to read a reliable
  // day-of-week index via getUTCDay() — this avoids hand-rolled offset arithmetic and
  // avoids re-interpreting the parts through the device's own timezone.
  const asUtcMidnight = new Date(Date.UTC(year, month - 1, dayOfMonth));
  return { day: asUtcMidnight.getUTCDay(), hour };
}

/**
 * Resolve the weekday + hour of a claim timestamp IN A GIVEN TIMEZONE.
 *
 * - `timeZone` should be the deal's stored IANA zone (`deals.timezone`). Pass
 *   `null`/`undefined`/blank to fall back to the device's timezone.
 * - An invalid/unrecognized IANA id is caught and also falls back to the
 *   device timezone rather than throwing — a bad value in the `timezone`
 *   column must never crash the analytics screen.
 */
export function getLocalDayAndHour(createdAt: string, timeZone?: string | null): LocalDayAndHour {
  const date = new Date(normalizeTimestamp(createdAt));
  const tz = timeZone && timeZone.trim() ? timeZone.trim() : undefined;
  if (tz) {
    try {
      return partsToDayAndHour(date, tz);
    } catch {
      // Invalid IANA id — fall through to device timezone below.
    }
  }
  return partsToDayAndHour(date, undefined);
}

/** Floor an hour (0-23) to the start of its 2-hour bucket. */
export function bucketStartHour(hour: number): number {
  const normalized = ((Math.trunc(hour) % 24) + 24) % 24;
  return Math.floor(normalized / 2) * 2;
}

/**
 * AM/PM period for a 2-hour bucket, derived from the bucket's START hour.
 *
 * Deriving it from the END hour (the previous behavior) mislabels any bucket
 * that crosses midnight: a 10 PM–12 AM bucket has an end hour of 0, which read
 * as "AM" for a 10 PM peak. Buckets that straddle noon or midnight are labeled
 * by their start, which is the hour merchants actually see first in the range.
 */
export function periodForBucketStart(startHour: number): "AM" | "PM" {
  const normalized = ((Math.trunc(startHour) % 24) + 24) % 24;
  return normalized < 12 ? "AM" : "PM";
}

/** Convert a 24-hour value to its 12-hour display number (0/12 → 12). */
export function to12Hour(hour: number): number {
  const normalized = ((Math.trunc(hour) % 24) + 24) % 24;
  const mod = normalized % 12;
  return mod === 0 ? 12 : mod;
}
