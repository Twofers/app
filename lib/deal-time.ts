import type { TFunction } from "i18next";
import { addDays, format, isValid } from "date-fns";
import type { Locale } from "date-fns";
import { dateFnsLocaleFor } from "./i18n/date-locale";
import { devWarn } from "./dev-log";

type RecurringInfo = {
  is_recurring?: boolean | null;
  days_of_week?: number[] | null;
  window_start_minutes?: number | null;
  window_end_minutes?: number | null;
  timezone?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

const dayMap: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const DEFAULT_DEAL_TIME_ZONE = "America/Chicago";

/** Jan 1, 2024 is Monday — aligns with `days_of_week` 1=Mon … 7=Sun. */
const BASE_MONDAY = new Date(2024, 0, 1);

function dealTimeZone(deal: RecurringInfo) {
  return deal.timezone?.trim() || DEFAULT_DEAL_TIME_ZONE;
}

function dayNumberToDate(dayNum: number): Date {
  return addDays(BASE_MONDAY, dayNum - 1);
}

function getLocalParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { day: dayMap[weekday] ?? 1, minutes: hour * 60 + minute };
}

function formatMinutesLocalized(minutes: number, locale: Locale) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return format(new Date(2000, 0, 1, h, m, 0, 0), "p", { locale });
}

/** Format an hour-of-day (0–23) as a locale-aware time label, e.g. "7:00 PM". */
export function formatHourOfDayLabel(hour: number, lang?: string): string {
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  return formatMinutesLocalized(h * 60, dateFnsLocaleFor(lang));
}

function formatDaysLocalized(days: number[], locale: Locale, t?: TFunction) {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return t?.("dealValidity.everyDay") ?? "Every day";
  if (sorted.join(",") === "1,2,3,4,5") return t?.("dealValidity.weekdaysMonFri") ?? "Mon–Fri";
  if (sorted.join(",") === "6,7") return t?.("dealValidity.weekend") ?? "Sat–Sun";
  return sorted
    .map((d) => format(dayNumberToDate(d), "EEE", { locale }))
    .join(", ");
}

function formatDateTimeInTimeZone(date: Date, timeZone: string, lang?: string) {
  if (!isValid(date)) return "";
  const formatOptions: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  };
  try {
    return new Intl.DateTimeFormat(lang || "en", formatOptions).format(date);
  } catch (e) {
    devWarn("[deal-time] formatDateTimeInTimeZone failed (bad timezone?)", e);
    return new Intl.DateTimeFormat(lang || "en", {
      ...formatOptions,
      timeZone: DEFAULT_DEAL_TIME_ZONE,
    }).format(date);
  }
}

export function isDealActiveNow(deal: RecurringInfo, now = new Date()) {
  if (!deal) return false;
  try {
    const start = deal.start_time ? new Date(deal.start_time) : null;
    const end = deal.end_time ? new Date(deal.end_time) : null;

    if (start && now < start) return false;
    if (end && now >= end) return false;

    if (!deal.is_recurring) return true;

    const days = Array.isArray(deal.days_of_week) ? deal.days_of_week : [];
    const windowStart = deal.window_start_minutes;
    const windowEnd = deal.window_end_minutes;
    const tz = dealTimeZone(deal);

    if (!days.length || windowStart == null || windowEnd == null) return false;
    const { day, minutes } = getLocalParts(now, tz);
    if (windowEnd <= windowStart) {
      // Overnight window (e.g., 10PM-2AM): active if on a scheduled day after windowStart,
      // or on the following day before windowEnd.
      if (days.includes(day) && minutes >= windowStart) return true;
      const prevDay = day === 1 ? 7 : day - 1;
      if (days.includes(prevDay) && minutes < windowEnd) return true;
      return false;
    }
    if (!days.includes(day)) return false;
    return minutes >= windowStart && minutes < windowEnd;
  } catch (e) {
    devWarn("[deal-time] isDealActiveNow failed (bad dates/timezone?)", e);
    return false;
  }
}

export type DealClaimScheduleBlockReason =
  | "not_started"
  | "expired"
  | "claim_closed"
  | "not_active_today"
  | "not_active_now"
  | "claim_window_closed"
  | "misconfigured";

export function getDealClaimScheduleBlock(
  deal: RecurringInfo & { claim_cutoff_buffer_minutes?: number | null },
  now = new Date(),
): DealClaimScheduleBlockReason | null {
  if (!deal) return "misconfigured";
  try {
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) return "misconfigured";

    const start = deal.start_time ? new Date(deal.start_time) : null;
    const end = deal.end_time ? new Date(deal.end_time) : null;
    const endMs = end?.getTime() ?? NaN;
    const rawCutoff = deal.claim_cutoff_buffer_minutes;
    const cutoffBufferMinutes = typeof rawCutoff === "number" && Number.isFinite(rawCutoff) ? rawCutoff : 15;

    if (start && nowMs < start.getTime()) return "not_started";
    if (!end || !Number.isFinite(endMs)) return "misconfigured";
    if (nowMs >= endMs) return "expired";

    const absoluteCutoffMs = endMs - cutoffBufferMinutes * 60_000;
    if (Number.isFinite(absoluteCutoffMs) && nowMs >= absoluteCutoffMs) return "claim_closed";

    if (!deal.is_recurring) return null;

    const days = Array.isArray(deal.days_of_week) ? deal.days_of_week : [];
    const windowStart = deal.window_start_minutes;
    const windowEnd = deal.window_end_minutes;
    const tz = dealTimeZone(deal);

    if (!days.length || windowStart == null || windowEnd == null) return "misconfigured";

    const { day, minutes } = getLocalParts(now, tz);
    if (!days.includes(day)) return "not_active_today";
    if (windowStart >= windowEnd) return "misconfigured";
    if (minutes < windowStart || minutes >= windowEnd) return "not_active_now";
    if (minutes >= windowEnd - cutoffBufferMinutes) return "claim_window_closed";

    return null;
  } catch (e) {
    devWarn("[deal-time] getDealClaimScheduleBlock failed (bad dates/timezone?)", e);
    return "misconfigured";
  }
}

export type FormatValiditySummaryOptions = {
  lang?: string;
  /** Prefix before end date when only `end_time` is set (e.g. t('commonUi.dealEndsVerb')). */
  endsVerb?: string;
  /** When set, preset day patterns (every day, weekdays, weekend) use translated copy. */
  t?: TFunction;
  /** Customer-facing screens should avoid exposing raw IANA timezone ids. */
  showTimeZone?: boolean;
};

/** Merchant dashboard: how this deal should be labeled (not identical to consumer "live"). */
export type MerchantDealScheduleStatus =
  | "ended"
  | "scheduled"
  | "live"
  /** Recurring campaign active but outside the weekly window right now */
  | "recurring_inactive";

export function getMerchantDealScheduleStatus(
  deal: RecurringInfo & { is_active?: boolean | null },
): MerchantDealScheduleStatus {
  const now = Date.now();
  const endMs = deal.end_time ? new Date(deal.end_time).getTime() : 0;
  if (deal.is_active === false || !Number.isFinite(endMs) || endMs <= now) {
    return "ended";
  }
  const startMs = deal.start_time ? new Date(deal.start_time).getTime() : 0;
  if (!deal.is_recurring && Number.isFinite(startMs) && startMs > now) {
    return "scheduled";
  }
  if (deal.is_recurring) {
    return isDealActiveNow(deal) ? "live" : "recurring_inactive";
  }
  return isDealActiveNow(deal) ? "live" : "ended";
}

/**
 * Turn an IANA timezone id into a short, customer-friendly label. Uses the
 * locale's short zone name ("CST"/"CDT") and collapses the US daylight/standard
 * variants to one generic abbreviation ("CT"). Falls back to the short name, or
 * the raw id, when no clean abbreviation is available.
 */
export function shortTimeZoneLabel(timeZone: string, lang?: string): string {
  try {
    const parts = new Intl.DateTimeFormat(lang || "en", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(new Date());
    const name = parts.find((p) => p.type === "timeZoneName")?.value;
    if (!name) return timeZone;
    // Collapse US "CST"/"CDT" → "CT" (X[S|D]T pattern); leave "GMT+9" etc. as-is.
    const generic = name.match(/^([A-Z]{1,3})[SD]T$/);
    return generic ? `${generic[1]}T` : name;
  } catch {
    return timeZone;
  }
}

export function formatValiditySummary(deal: RecurringInfo, options?: FormatValiditySummaryOptions) {
  const lang = options?.lang;
  const endsVerb = options?.endsVerb ?? "Ends";
  const t = options?.t;
  const loc = dateFnsLocaleFor(lang);

  if (!deal) return t?.("dealValidity.unavailable") ?? "Validity unavailable";
  if (deal.is_recurring) {
    const days = Array.isArray(deal.days_of_week) ? deal.days_of_week : [];
    const windowStart = deal.window_start_minutes;
    const windowEnd = deal.window_end_minutes;
    const tz = dealTimeZone(deal);
    if (!days.length || windowStart == null || windowEnd == null) {
      return t?.("dealValidity.recurringWindow") ?? "Recurring window";
    }
    const timeZoneSuffix = options?.showTimeZone === false ? "" : ` (${shortTimeZoneLabel(tz, lang)})`;
    return `${formatDaysLocalized(days, loc, t)} · ${formatMinutesLocalized(windowStart, loc)}–${formatMinutesLocalized(windowEnd, loc)}${timeZoneSuffix}`;
  }
  const start = deal.start_time ? new Date(deal.start_time) : null;
  const end = deal.end_time ? new Date(deal.end_time) : null;
  const tz = dealTimeZone(deal);
  if (start && end) {
    return `${formatDateTimeInTimeZone(start, tz, lang)} → ${formatDateTimeInTimeZone(end, tz, lang)}`;
  }
  if (end) return `${endsVerb} ${formatDateTimeInTimeZone(end, tz, lang)}`.trim();
  return t?.("dealValidity.oneTime") ?? "One-time deal";
}
