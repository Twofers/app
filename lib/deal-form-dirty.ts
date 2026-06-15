export type DealValidityMode = "one-time" | "recurring";

export type DealFormDirtySource = {
  photoUri?: string | null;
  photoPath?: string | null;
  posterUrl?: string | null;
  generatedPosterPath?: string | null;
  hintText?: string | null;
  price?: string | number | null;
  title?: string | null;
  promoLine?: string | null;
  ctaText?: string | null;
  description?: string | null;
  dealEligibility?: string | null;
  maxClaims?: string | number | null;
  cutoffMins?: string | number | null;
  validityMode: DealValidityMode;
  startTime?: Date | string | number | null;
  endTime?: Date | string | number | null;
  daysOfWeek?: number[] | null;
  windowStart?: Date | string | number | null;
  windowStartMinutes?: string | number | null;
  windowEnd?: Date | string | number | null;
  windowEndMinutes?: string | number | null;
  timezone?: string | null;
  publishLocationIds?: string[] | null;
  hasGeneratedAd?: boolean;
  adAccepted?: boolean;
};

export type DealFormDirtySnapshot = {
  photoUri: string;
  photoPath: string;
  posterUrl: string;
  generatedPosterPath: string;
  hintText: string;
  price: string;
  title: string;
  promoLine: string;
  ctaText: string;
  description: string;
  dealEligibility: string;
  maxClaims: string;
  cutoffMins: string;
  validityMode: DealValidityMode;
  startTime: string;
  endTime: string;
  daysOfWeek: string;
  windowStartMinutes: string;
  windowEndMinutes: string;
  timezone: string;
  publishLocationIds: string;
  hasGeneratedAd: boolean;
  adAccepted: boolean;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function normalizeNumber(value: string | number | null | undefined): string {
  if (value == null) return "";
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!raw) return "";
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? String(parsed) : raw;
}

function normalizeDate(value: Date | string | number | null | undefined): string {
  if (value == null || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? date.toISOString() : "";
}

function minutesFromTemporal(value: Date | string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
}

function normalizeMinutes(
  minutes: string | number | null | undefined,
  temporal: Date | string | number | null | undefined,
): string {
  if (minutes != null && minutes !== "") {
    const parsed = Number(minutes);
    return Number.isFinite(parsed) ? String(parsed) : String(minutes).trim();
  }
  const fromDate = minutesFromTemporal(temporal);
  return fromDate == null ? "" : String(fromDate);
}

function normalizeDays(days: number[] | null | undefined): string {
  return [...new Set((days ?? []).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))]
    .sort((a, b) => a - b)
    .join(",");
}

function normalizeLocationIds(ids: string[] | null | undefined): string {
  return [...new Set((ids ?? []).map((id) => id.trim()).filter(Boolean))].sort().join(",");
}

export function buildDealFormDirtySnapshot(source: DealFormDirtySource): DealFormDirtySnapshot {
  const recurring = source.validityMode === "recurring";
  return {
    photoUri: normalizeText(source.photoUri),
    photoPath: normalizeText(source.photoPath),
    posterUrl: normalizeText(source.posterUrl),
    generatedPosterPath: normalizeText(source.generatedPosterPath),
    hintText: normalizeText(source.hintText),
    price: normalizeNumber(source.price),
    title: normalizeText(source.title),
    promoLine: normalizeText(source.promoLine),
    ctaText: normalizeText(source.ctaText),
    description: normalizeText(source.description),
    dealEligibility: normalizeText(source.dealEligibility),
    maxClaims: normalizeNumber(source.maxClaims),
    cutoffMins: normalizeNumber(source.cutoffMins),
    validityMode: source.validityMode,
    startTime: recurring ? "" : normalizeDate(source.startTime),
    endTime: recurring ? "" : normalizeDate(source.endTime),
    daysOfWeek: recurring ? normalizeDays(source.daysOfWeek) : "",
    windowStartMinutes: recurring ? normalizeMinutes(source.windowStartMinutes, source.windowStart) : "",
    windowEndMinutes: recurring ? normalizeMinutes(source.windowEndMinutes, source.windowEnd) : "",
    timezone: recurring ? normalizeText(source.timezone) : "",
    publishLocationIds: normalizeLocationIds(source.publishLocationIds),
    hasGeneratedAd: source.hasGeneratedAd === true,
    adAccepted: source.adAccepted === true,
  };
}

export function isDealFormDirty(
  initial: DealFormDirtySnapshot | null | undefined,
  current: DealFormDirtySnapshot,
): boolean {
  if (!initial) return false;
  return (Object.keys(current) as (keyof DealFormDirtySnapshot)[]).some(
    (key) => current[key] !== initial[key],
  );
}
