import { formatAppDateTime } from "@/lib/i18n/format-datetime";

/** Show claim/deal expiry in the business deal timezone when available. */
export function formatDealExpiryLocal(iso: string, timeZone: string | null | undefined, lang: string | undefined): string {
  const tz = timeZone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return new Intl.DateTimeFormat(lang || "en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return formatAppDateTime(iso, lang);
  }
}
