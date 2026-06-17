import { normalizeGeneratedAdDisplayCopy, type GeneratedAd, type PhotoTreatment } from "./ad-variants";
import { createDefaultDealEligibilityFormState, type DealEligibilityFormState } from "./deal-eligibility-form";
import { getDealDisplayTitle } from "./deal-display-copy";

export const AI_DEAL_DRAFT_VERSION = 1;

export type AiDealRecoveryDraft = {
  version: typeof AI_DEAL_DRAFT_VERSION;
  businessId: string;
  updatedAt: string;
  photoPath: string | null;
  posterUrl: string | null;
  photoTreatment: PhotoTreatment;
  usePhotoAsFinal: boolean;
  hintText: string;
  price: string;
  title: string;
  promoLine: string;
  ctaText: string;
  description: string;
  eligibilityForm: DealEligibilityFormState;
  maxClaims: string;
  cutoffMins: string;
  validityMode: "one-time" | "recurring";
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
  windowStartMinutes: number;
  windowEndMinutes: number;
  timezone: string;
  publishLocationIds: string[];
  generatedAd: GeneratedAd | null;
  adAccepted: boolean;
  manualDraftUnlocked: boolean;
};

type DraftCandidate = Omit<AiDealRecoveryDraft, "version" | "businessId" | "updatedAt" | "startTime" | "endTime"> & {
  businessId: string | null | undefined;
  startTime: Date | string | number;
  endTime: Date | string | number;
};

const KEY_PREFIX = "twofer.aiDealDraft.v1.";
const VALID_PHOTO_TREATMENTS: PhotoTreatment[] = ["touchup", "cleanbg", "studiopolish"];

export function aiDealDraftStorageKey(businessId: string): string {
  return `${KEY_PREFIX}${businessId.trim()}`;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cleanDisplayTitle(value: unknown): string {
  const title = cleanString(value);
  return title ? getDealDisplayTitle({ title }, title) : "";
}

function cleanGeneratedAd(value: GeneratedAd | null | undefined): GeneratedAd | null {
  return value ? normalizeGeneratedAdDisplayCopy(value) : null;
}

function cleanNullableString(value: unknown): string | null {
  const text = cleanString(value).trim();
  return text ? text : null;
}

function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function cleanDays(value: unknown): number[] {
  const days = Array.isArray(value) ? value : [];
  return [...new Set(days.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))]
    .sort((a, b) => a - b);
}

function cleanPhotoTreatment(value: unknown): PhotoTreatment {
  return VALID_PHOTO_TREATMENTS.includes(value as PhotoTreatment) ? (value as PhotoTreatment) : "studiopolish";
}

function cleanIsoDate(value: unknown, fallback: Date): string {
  const date = typeof value === "string" || typeof value === "number" ? new Date(value) : value instanceof Date ? value : fallback;
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback.toISOString();
}

function cleanMinute(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(24 * 60 - 1, Math.floor(numeric)));
}

export function hasRecoverableAiDealDraft(draft: AiDealRecoveryDraft): boolean {
  return Boolean(
    draft.photoPath ||
      draft.posterUrl ||
      draft.hintText.trim() ||
      draft.price.trim() ||
      draft.title.trim() ||
      draft.promoLine.trim() ||
      draft.ctaText.trim() ||
      draft.description.trim() ||
      draft.generatedAd ||
      draft.adAccepted ||
      draft.manualDraftUnlocked,
  );
}

export function buildAiDealRecoveryDraft(input: DraftCandidate): AiDealRecoveryDraft | null {
  const businessId = cleanString(input.businessId).trim();
  if (!businessId) return null;
  const now = new Date();
  const fallbackEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const draft: AiDealRecoveryDraft = {
    version: AI_DEAL_DRAFT_VERSION,
    businessId,
    updatedAt: now.toISOString(),
    photoPath: cleanNullableString(input.photoPath),
    posterUrl: cleanNullableString(input.posterUrl),
    photoTreatment: cleanPhotoTreatment(input.photoTreatment),
    usePhotoAsFinal: input.usePhotoAsFinal === true,
    hintText: cleanString(input.hintText),
    price: cleanString(input.price),
    title: cleanDisplayTitle(input.title),
    promoLine: cleanString(input.promoLine),
    ctaText: cleanString(input.ctaText),
    description: cleanString(input.description),
    eligibilityForm: input.eligibilityForm ?? createDefaultDealEligibilityFormState(),
    maxClaims: cleanString(input.maxClaims) || "50",
    cutoffMins: cleanString(input.cutoffMins) || "15",
    validityMode: input.validityMode === "recurring" ? "recurring" : "one-time",
    startTime: cleanIsoDate(input.startTime, now),
    endTime: cleanIsoDate(input.endTime, fallbackEnd),
    daysOfWeek: cleanDays(input.daysOfWeek),
    windowStartMinutes: cleanMinute(input.windowStartMinutes, 540),
    windowEndMinutes: cleanMinute(input.windowEndMinutes, 1020),
    timezone: cleanString(input.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    publishLocationIds: cleanStringArray(input.publishLocationIds),
    generatedAd: cleanGeneratedAd(input.generatedAd),
    adAccepted: input.adAccepted === true,
    manualDraftUnlocked: input.manualDraftUnlocked === true,
  };
  return hasRecoverableAiDealDraft(draft) ? draft : null;
}

export function parseAiDealRecoveryDraft(raw: string | null | undefined, businessId: string): AiDealRecoveryDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AiDealRecoveryDraft>;
    if (parsed.version !== AI_DEAL_DRAFT_VERSION) return null;
    if (parsed.businessId !== businessId) return null;
    const draft = buildAiDealRecoveryDraft({
      businessId: parsed.businessId,
      photoPath: parsed.photoPath ?? null,
      posterUrl: parsed.posterUrl ?? null,
      photoTreatment: parsed.photoTreatment ?? "studiopolish",
      usePhotoAsFinal: parsed.usePhotoAsFinal === true,
      hintText: parsed.hintText ?? "",
      price: parsed.price ?? "",
      title: parsed.title ?? "",
      promoLine: parsed.promoLine ?? "",
      ctaText: parsed.ctaText ?? "",
      description: parsed.description ?? "",
      eligibilityForm: parsed.eligibilityForm as DealEligibilityFormState,
      maxClaims: parsed.maxClaims ?? "50",
      cutoffMins: parsed.cutoffMins ?? "15",
      validityMode: parsed.validityMode === "recurring" ? "recurring" : "one-time",
      startTime: parsed.startTime ?? new Date().toISOString(),
      endTime: parsed.endTime ?? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      daysOfWeek: parsed.daysOfWeek ?? [1, 2, 3, 4, 5],
      windowStartMinutes: parsed.windowStartMinutes ?? 540,
      windowEndMinutes: parsed.windowEndMinutes ?? 1020,
      timezone: parsed.timezone ?? "America/Chicago",
      publishLocationIds: parsed.publishLocationIds ?? [],
      generatedAd: parsed.generatedAd ?? null,
      adAccepted: parsed.adAccepted === true,
      manualDraftUnlocked: parsed.manualDraftUnlocked === true,
    });
    if (!draft) return null;
    return { ...draft, updatedAt: cleanIsoDate(parsed.updatedAt, new Date()) };
  } catch {
    return null;
  }
}
