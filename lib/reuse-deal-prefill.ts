import { extractDealPhotoStoragePath } from "./deal-poster-url";

type ReusableDeal = {
  title?: string | null;
  description?: string | null;
  source_locale?: string | null;
  price?: number | string | null;
  poster_url?: string | null;
  poster_storage_path?: string | null;
  is_recurring?: boolean | null;
  days_of_week?: number[] | null;
  window_start_minutes?: number | null;
  window_end_minutes?: number | null;
  timezone?: string | null;
  max_claims?: number | null;
  claim_cutoff_buffer_minutes?: number | null;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function finiteString(value: number | string | null | undefined): string {
  if (value == null) return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(value).trim() : "";
}

function cleanStoragePath(deal: ReusableDeal): string {
  return clean(deal.poster_storage_path) || clean(extractDealPhotoStoragePath(deal.poster_url));
}

function cleanPosterUrl(deal: ReusableDeal): string {
  const raw = clean(deal.poster_url);
  return raw && /^https?:\/\//i.test(raw) ? raw : "";
}

export function buildReuseDealPrefillParams(deal: ReusableDeal): Record<string, string> {
  const params: Record<string, string> = { fromReuse: "1" };
  const title = clean(deal.title);
  const description = clean(deal.description);
  const price = finiteString(deal.price);
  const sourceLocale = clean(deal.source_locale);
  const posterPath = cleanStoragePath(deal);
  const posterUrl = cleanPosterUrl(deal);

  if (title) params.prefillTitle = title;
  if (description) {
    params.prefillHint = description;
    params.prefillDescription = description;
  } else if (title) {
    params.prefillHint = title;
  }
  if (price) params.prefillPrice = price;
  if (sourceLocale) params.prefillSourceLocale = sourceLocale;
  if (posterPath) {
    params.prefillPosterPath = posterPath;
  } else if (posterUrl) {
    params.prefillPosterUrl = posterUrl;
  }

  if (deal.is_recurring != null) params.prefillIsRecurring = deal.is_recurring ? "1" : "0";
  if (deal.days_of_week?.length) params.prefillDaysOfWeek = deal.days_of_week.join(",");
  if (deal.window_start_minutes != null) params.prefillWindowStartMin = String(deal.window_start_minutes);
  if (deal.window_end_minutes != null) params.prefillWindowEndMin = String(deal.window_end_minutes);
  if (clean(deal.timezone)) params.prefillTimezone = clean(deal.timezone);
  if (deal.max_claims != null) params.prefillMaxClaims = String(deal.max_claims);
  if (deal.claim_cutoff_buffer_minutes != null) params.prefillCutoffMins = String(deal.claim_cutoff_buffer_minutes);

  return params;
}
