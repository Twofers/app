import { extractDealPhotoStoragePath } from "./deal-poster-url";
import {
  dealEligibilityFormFromDealRow,
  type DealEligibilityFormState,
} from "./deal-eligibility-form";
import { getDealDisplayTitle } from "./deal-display-copy";
import {
  createDefaultOneTimeDealSchedule,
  createOneTimeDealScheduleFromStart,
  MAX_DEAL_DURATION_MINUTES,
} from "./deal-schedule-defaults";

export type ReusableDeal = {
  title?: string | null;
  description?: string | null;
  source_locale?: string | null;
  price?: number | string | null;
  poster_url?: string | null;
  poster_storage_path?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  is_recurring?: boolean | null;
  days_of_week?: number[] | null;
  window_start_minutes?: number | null;
  window_end_minutes?: number | null;
  timezone?: string | null;
  max_claims?: number | null;
  claim_cutoff_buffer_minutes?: number | null;
  deal_type?: string | null;
  discount_percent?: number | string | null;
  item_description?: string | null;
  item_retail_value_cents?: number | string | null;
  required_item_description?: string | null;
  required_item_retail_value_cents?: number | string | null;
  free_item_description?: string | null;
  free_item_retail_value_cents?: number | string | null;
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

function isPositivePrice(value: string): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function hasCompleteEligibility(form: DealEligibilityFormState): boolean {
  if (form.dealType === "PERCENT_OFF_SINGLE_ITEM") {
    return Boolean(form.discountPercent.trim() && form.itemDescription.trim() && form.itemRetailValue.trim());
  }

  return Boolean(
    form.requiredItemDescription.trim() &&
      form.requiredItemRetailValue.trim() &&
      form.freeItemRetailValue.trim() &&
      (form.dealType === "BUY_ONE_GET_ONE_FREE" || form.freeItemDescription.trim()),
  );
}

function inferReusableEligibility(title: string, description: string, price: string): DealEligibilityFormState | null {
  if (!isPositivePrice(price)) return null;
  const text = `${title}\n${description}`.toLowerCase();
  const itemDescription = title || description.split(/\n+/)[0]?.trim() || "Offer item";

  if (/\bbogo\b|buy\s+one[\s\S]{0,40}get\s+one|second[\s\S]{0,20}free|get\s+(?:a\s+)?second[\s\S]{0,20}free/.test(text)) {
    return {
      dealType: "BUY_ONE_GET_ONE_FREE",
      discountPercent: "40",
      itemDescription: "",
      itemRetailValue: "",
      requiredItemDescription: itemDescription,
      requiredItemRetailValue: price,
      freeItemDescription: itemDescription,
      freeItemRetailValue: price,
    };
  }

  const percentMatch = text.match(/\b([4-9]\d|100)\s*%/);
  if (percentMatch?.[1]) {
    return {
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      discountPercent: percentMatch[1],
      itemDescription,
      itemRetailValue: price,
      requiredItemDescription: "",
      requiredItemRetailValue: "",
      freeItemDescription: "",
      freeItemRetailValue: "",
    };
  }

  return null;
}

function buildEligibilityParam(deal: ReusableDeal, title: string, description: string, price: string): string {
  const fromStoredColumns = dealEligibilityFormFromDealRow(deal as Record<string, unknown>);
  const form = hasCompleteEligibility(fromStoredColumns)
    ? fromStoredColumns
    : inferReusableEligibility(title, description, price);
  return form ? JSON.stringify(form) : "";
}

function splitStoredDescription(description: string): { promoLine: string; details: string } {
  const parts = description.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { promoLine: "", details: description };
  return {
    promoLine: parts[0] ?? "",
    details: parts.slice(1).join("\n\n"),
  };
}

function originalOneTimeDurationMinutes(deal: ReusableDeal): number | null {
  if (!deal.start_time || !deal.end_time) return null;
  const startMs = new Date(deal.start_time).getTime();
  const endMs = new Date(deal.end_time).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const durationMinutes = Math.round((endMs - startMs) / (60 * 1000));
  if (durationMinutes <= 0 || durationMinutes > MAX_DEAL_DURATION_MINUTES) return null;
  return durationMinutes;
}

function applyRecurringScheduleParams(params: Record<string, string>, deal: ReusableDeal) {
  if (deal.is_recurring != null) params.prefillIsRecurring = deal.is_recurring ? "1" : "0";
  if (deal.days_of_week?.length) params.prefillDaysOfWeek = deal.days_of_week.join(",");
  if (deal.window_start_minutes != null) params.prefillWindowStartMin = String(deal.window_start_minutes);
  if (deal.window_end_minutes != null) params.prefillWindowEndMin = String(deal.window_end_minutes);
  if (clean(deal.timezone)) params.prefillTimezone = clean(deal.timezone);
}

function isReusableOperationalDisclosure(sentence: string): boolean {
  return /^(?:Redeem (?:only )?at\b|Limited to \d+\b|Offer window:|Claims close\b|Limit (?:one|\d+) claims? per customer\b)/i.test(
    sentence.trim(),
  );
}

function stripReusableOperationalDisclosures(description: string): string {
  return description
    .split(/\n{2,}/)
    .map((paragraph) => {
      const normalizedParagraph = paragraph.replace(/\s+/g, " ").trim();
      const sentences = normalizedParagraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
      return sentences
        .map((sentence) => sentence.trim())
        .filter(Boolean)
        .filter((sentence) => !isReusableOperationalDisclosure(sentence))
        .join(" ");
    })
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join("\n\n");
}

export type ReuseDealPrefillOptions = {
  resetSchedule?: boolean;
  now?: Date;
};

export function buildReuseDealPrefillParams(
  deal: ReusableDeal,
  options: ReuseDealPrefillOptions = {},
): Record<string, string> {
  const params: Record<string, string> = { fromReuse: "1" };
  const title = clean(getDealDisplayTitle(deal, deal.title));
  const storedDescription = clean(deal.description);
  const description = options.resetSchedule
    ? stripReusableOperationalDisclosures(storedDescription)
    : storedDescription;
  const { promoLine, details } = splitStoredDescription(description);
  const price = finiteString(deal.price);
  const sourceLocale = clean(deal.source_locale);
  const posterPath = cleanStoragePath(deal);
  const posterUrl = cleanPosterUrl(deal);
  const eligibilityParam = buildEligibilityParam(deal, title, description, price);

  if (title) params.prefillTitle = title;
  if (promoLine) params.prefillPromoLine = promoLine;
  params.prefillCta = "Claim deal";
  if (description) {
    params.prefillHint = description;
    params.prefillDescription = details;
  } else if (title) {
    params.prefillHint = title;
  }
  if (price) params.prefillPrice = price;
  if (sourceLocale) params.prefillSourceLocale = sourceLocale;
  if (eligibilityParam) params.prefillDealEligibility = eligibilityParam;
  if (posterPath) {
    params.prefillPosterPath = posterPath;
  } else if (posterUrl) {
    params.prefillPosterUrl = posterUrl;
  }

  if (options.resetSchedule && deal.is_recurring) {
    applyRecurringScheduleParams(params, deal);
  } else if (options.resetSchedule) {
    const freshSchedule = createDefaultOneTimeDealSchedule(options.now);
    const durationMinutes = originalOneTimeDurationMinutes(deal);
    const schedule = durationMinutes
      ? createOneTimeDealScheduleFromStart(freshSchedule.startTime, durationMinutes)
      : freshSchedule;
    params.prefillIsRecurring = "0";
    params.prefillStartTime = schedule.startTime.toISOString();
    params.prefillEndTime = schedule.endTime.toISOString();
  } else {
    applyRecurringScheduleParams(params, deal);
  }
  if (deal.max_claims != null) params.prefillMaxClaims = String(deal.max_claims);
  if (deal.claim_cutoff_buffer_minutes != null) params.prefillCutoffMins = String(deal.claim_cutoff_buffer_minutes);

  return params;
}
