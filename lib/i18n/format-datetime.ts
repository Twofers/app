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
