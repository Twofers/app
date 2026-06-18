import { format, isValid, parseISO } from "date-fns";
import { dateFnsLocaleFor } from "./date-locale";

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const d = value.includes("T") || value.includes("Z") ? parseISO(value) : new Date(value);
  return d;
}

/** Long date + time for app language (date-fns + locale). */
export function formatAppDateTime(value: string | Date, lang: string | undefined): string {
  const d = toDate(value);
  if (!isValid(d)) return "";
  return format(d, "PPp", { locale: dateFnsLocaleFor(lang) });
}

/** Compact date + time for deal cards and detail metadata. */
export function formatCompactAppDateTime(value: string | Date, lang: string | undefined): string {
  const d = toDate(value);
  if (!isValid(d)) return "";
  return format(d, "MMM d 'at' p", { locale: dateFnsLocaleFor(lang) });
}

/** Compact full range for detail screens. */
export function formatAppDateTimeRange(
  startValue: string | Date,
  endValue: string | Date,
  lang: string | undefined,
): string {
  const start = toDate(startValue);
  const end = toDate(endValue);
  if (!isValid(start) || !isValid(end)) return "";
  return `${formatCompactAppDateTime(start, lang)}\u2013${formatCompactAppDateTime(end, lang)}`;
}

export function formatDealTimingLabel(args: {
  startTime?: string | Date | null;
  endTime?: string | Date | null;
  lang?: string;
  now?: Date;
}): string {
  const now = args.now ?? new Date();
  const start = args.startTime ? toDate(args.startTime) : null;
  const end = args.endTime ? toDate(args.endTime) : null;
  if (start && isValid(start) && now.getTime() < start.getTime()) {
    return `Starts ${formatCompactAppDateTime(start, args.lang)}`;
  }
  if (end && isValid(end)) {
    return `Ends ${formatCompactAppDateTime(end, args.lang)}`;
  }
  return "";
}

/** Calendar date only for app language. */
export function formatAppDate(value: string | Date, lang: string | undefined): string {
  const d = toDate(value);
  if (!isValid(d)) return "";
  return format(d, "PP", { locale: dateFnsLocaleFor(lang) });
}

/** `YYYY-MM-DD` bucket keys (e.g. analytics) as a local calendar date, not UTC midnight. */
export function formatAppDateFromDayKey(dayKey: string, lang: string | undefined): string {
  const parts = dayKey.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dayKey;
  const [y, mo, d] = parts;
  const date = new Date(y, mo - 1, d, 12, 0, 0);
  return formatAppDate(date, lang);
}
