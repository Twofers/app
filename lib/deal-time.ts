import type { TFunction } from "i18next";
import { addDays, format, isValid } from "date-fns";
import type { Locale } from "date-fns";
import { dateFnsLocaleFor } from "./i18n/date-locale";

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

/** Jan 1, 2024 is Monday — aligns with `days_of_week` 1=Mon … 7=Sun. */
const BASE_MONDAY = new Date(2024, 0, 1);

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

function formatDaysLocalized(days: number[], locale: Locale, t?: TFunction) {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return t?.("dealValidity.everyDay") ?? "Every day";
  if (sorted.join(",") === "1,2,3,4,5") return t?.("dealValidity.weekdaysMonFri") ?? "Mon–Fri";
  if (sorted.join(",") === "6,7") return t?.("dealValidity.weekend") ?? "Sat–Sun";
  return sorted
    .map((d) => format(dayNumberToDate(d), "EEE", { locale }))
    .join(", ");
}

export function isDealActiveNow(deal: RecurringInfo) {
  if (!deal) return false;
  const now = new Date();
  const start = deal.start_time ? new Date(deal.start_time) : null;
  const end = deal.end_time ? new Date(deal.end_time) : null;

  if (start && now < start) return false;
  if (end && now >= end) return false;

  if (!deal.is_recurring) return true;

  const days = Array.isArray(deal.days_of_week) ? deal.days_of_week : [];
  const windowStart = deal.window_start_minutes;
  const windowEnd = deal.window_end_minutes;
  const tz = deal.timezone || "America/Chicago";

  if (!days.length || windowStart == null || windowEnd == null || windowStart >= windowEnd) return false;
  const { day, minutes } = getLocalParts(now, tz);
  if (!days.includes(day)) return false;
  return minutes >= windowStart && minutes < windowEnd;
}

export type FormatValiditySummaryOptions = {
  lang?: string;
  /** Prefix before end date when only `end_time` is set (e.g. t('commonUi.dealEndsVerb')). */
  endsVerb?: string;
  /** When set, preset day patterns (every day, weekdays, weekend) use translated copy. */
  t?: TFunction;
};

export function formatValiditySummary(deal: RecurringInfo, options?: FormatValiditySummaryOptions) {
  const lang = options?.lang;
  const endsVerb = options?.endsVerb ?? "Ends";
  const t = options?.t;
  const loc = dateFnsLocaleFor(lang);
  const fmt = (d: Date) => (isValid(d) ? format(d, "PPp", { locale: loc }) : "");

  if (!deal) return t?.("dealValidity.unavailable") ?? "Validity unavailable";
  if (deal.is_recurring) {
    const days = Array.isArray(deal.days_of_week) ? deal.days_of_week : [];
    const windowStart = deal.window_start_minutes;
    const windowEnd = deal.window_end_minutes;
    const tz = deal.timezone || "America/Chicago";
    if (!days.length || windowStart == null || windowEnd == null) {
      return t?.("dealValidity.recurringWindow") ?? "Recurring window";
    }
    return `${formatDaysLocalized(days, loc, t)} · ${formatMinutesLocalized(windowStart, loc)}–${formatMinutesLocalized(windowEnd, loc)} (${tz})`;
  }
  const start = deal.start_time ? new Date(deal.start_time) : null;
  const end = deal.end_time ? new Date(deal.end_time) : null;
  if (start && end) {
    return `${fmt(start)} → ${fmt(end)}`;
  }
  if (end) return `${endsVerb} ${fmt(end)}`.trim();
  return t?.("dealValidity.oneTime") ?? "One-time deal";
}
