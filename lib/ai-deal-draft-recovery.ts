import { normalizeGeneratedAdDisplayCopy, type GeneratedAd, type PhotoTreatment } from "./ad-variants";
import { createDefaultDealEligibilityFormState, type DealEligibilityFormState } from "./deal-eligibility-form";
import { getDealDisplayTitle } from "./deal-display-copy";
import {
  createDefaultOneTimeDealSchedule,
  createOneTimeDealScheduleFromStart,
} from "./deal-schedule-defaults";

export const AI_DEAL_DRAFT_VERSION = 1;

export type AiDealDraftCreativeFormat = "standard_card" | "poster_v1";

export type AiDealRecoveryDraft = {
  version: typeof AI_DEAL_DRAFT_VERSION;
  businessId: string;
  updatedAt: string;
  photoPath: string | null;
  posterUrl: string | null;
  photoTreatment: PhotoTreatment;
  customImageEditInstruction: string;
  usePhotoAsFinal: boolean;
  merchantOriginalWarningAcknowledged: boolean;
  creativeFormat: AiDealDraftCreativeFormat;
  previewFormat: AiDealDraftCreativeFormat;
  hintText: string;
  price: string;
  title: string;
  promoLine: string;
  posterHeadlineText: string;
  posterSublineText: string;
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

type DraftCandidate = Omit<
  AiDealRecoveryDraft,
  | "version"
  | "businessId"
  | "updatedAt"
  | "startTime"
  | "endTime"
  | "creativeFormat"
  | "previewFormat"
  | "posterHeadlineText"
  | "posterSublineText"
> & {
  businessId: string | null | undefined;
  startTime: Date | string | number;
  endTime: Date | string | number;
  creativeFormat?: AiDealDraftCreativeFormat | null;
  previewFormat?: AiDealDraftCreativeFormat | null;
  // Optional so drafts saved before poster text editing existed still parse.
  posterHeadlineText?: string | null;
  posterSublineText?: string | null;
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

function cleanCreativeFormat(value: unknown): AiDealDraftCreativeFormat {
  if (value === "standard_card" || value === "poster_v1") return value;
  return "poster_v1";
}

function cleanDate(value: unknown, fallback: Date): Date {
  const date = typeof value === "string" || typeof value === "number" ? new Date(value) : value instanceof Date ? value : fallback;
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function cleanIsoDate(value: unknown, fallback: Date): string {
  return cleanDate(value, fallback).toISOString();
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
      draft.customImageEditInstruction.trim() ||
      draft.hintText.trim() ||
      draft.price.trim() ||
      draft.title.trim() ||
      draft.promoLine.trim() ||
      draft.posterHeadlineText.trim() ||
      draft.posterSublineText.trim() ||
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
  const generatedAd = cleanGeneratedAd(input.generatedAd);
  const creativeFormat = cleanCreativeFormat(input.creativeFormat);
  const previewFormat = cleanCreativeFormat(input.previewFormat);
  const now = new Date();
  const defaultSchedule = createDefaultOneTimeDealSchedule(now);
  const startTime = cleanDate(input.startTime, defaultSchedule.startTime);
  // cleanDate only proves a date parses, not that the window is coherent. A
  // recovered draft can pair a refreshed start with a stale end — observed on an
  // S10 on 2026-07-22, where a recovered draft opened with start Jul 21 11:33 PM
  // and end Jul 21 10:56 PM, 37 minutes earlier. That renders a "REDEEM BY" time
  // already in the past and cannot publish, with nothing in the UI flagging it.
  // An end that does not follow its start is not recoverable state, so rebuild it
  // from the start rather than restoring it.
  const restoredEndTime = cleanDate(input.endTime, createOneTimeDealScheduleFromStart(startTime).endTime);
  const endTime =
    restoredEndTime.getTime() > startTime.getTime()
      ? restoredEndTime
      : createOneTimeDealScheduleFromStart(startTime).endTime;
  const draft: AiDealRecoveryDraft = {
    version: AI_DEAL_DRAFT_VERSION,
    businessId,
    updatedAt: now.toISOString(),
    photoPath: cleanNullableString(input.photoPath),
    posterUrl: cleanNullableString(input.posterUrl),
    photoTreatment: cleanPhotoTreatment(input.photoTreatment),
    customImageEditInstruction: cleanString(input.customImageEditInstruction)
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 400),
    usePhotoAsFinal: input.usePhotoAsFinal === true,
    merchantOriginalWarningAcknowledged: input.merchantOriginalWarningAcknowledged === true,
    creativeFormat,
    previewFormat,
    hintText: cleanString(input.hintText),
    price: cleanString(input.price),
    title: cleanDisplayTitle(input.title),
    promoLine: cleanString(input.promoLine),
    posterHeadlineText: cleanString(input.posterHeadlineText),
    posterSublineText: cleanString(input.posterSublineText),
    ctaText: cleanString(input.ctaText),
    description: cleanString(input.description),
    eligibilityForm: input.eligibilityForm ?? createDefaultDealEligibilityFormState(),
    maxClaims: cleanString(input.maxClaims) || "50",
    cutoffMins: cleanString(input.cutoffMins) || "15",
    validityMode: input.validityMode === "recurring" ? "recurring" : "one-time",
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    daysOfWeek: cleanDays(input.daysOfWeek),
    windowStartMinutes: cleanMinute(input.windowStartMinutes, 540),
    windowEndMinutes: cleanMinute(input.windowEndMinutes, 1020),
    timezone: cleanString(input.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    publishLocationIds: cleanStringArray(input.publishLocationIds),
    generatedAd,
    adAccepted: input.adAccepted === true,
    // Approval hashes are intentionally session-only. Any recovered generated
    // or formerly accepted ad must reopen in the editor so the owner can review
    // and approve the exact live snapshot again.
    manualDraftUnlocked:
      input.manualDraftUnlocked === true || input.adAccepted === true || generatedAd != null,
  };
  return hasRecoverableAiDealDraft(draft) ? draft : null;
}

export function parseAiDealRecoveryDraft(raw: string | null | undefined, businessId: string): AiDealRecoveryDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AiDealRecoveryDraft>;
    if (parsed.version !== AI_DEAL_DRAFT_VERSION) return null;
    if (parsed.businessId !== businessId) return null;
    const defaultSchedule = createDefaultOneTimeDealSchedule();
    const draft = buildAiDealRecoveryDraft({
      businessId: parsed.businessId,
      photoPath: parsed.photoPath ?? null,
      posterUrl: parsed.posterUrl ?? null,
      photoTreatment: parsed.photoTreatment ?? "studiopolish",
      customImageEditInstruction: parsed.customImageEditInstruction ?? "",
      usePhotoAsFinal: parsed.usePhotoAsFinal === true,
      merchantOriginalWarningAcknowledged: parsed.merchantOriginalWarningAcknowledged === true,
      creativeFormat: parsed.creativeFormat,
      previewFormat: parsed.previewFormat,
      hintText: parsed.hintText ?? "",
      price: parsed.price ?? "",
      title: parsed.title ?? "",
      promoLine: parsed.promoLine ?? "",
      posterHeadlineText: parsed.posterHeadlineText ?? "",
      posterSublineText: parsed.posterSublineText ?? "",
      ctaText: parsed.ctaText ?? "",
      description: parsed.description ?? "",
      eligibilityForm: parsed.eligibilityForm as DealEligibilityFormState,
      maxClaims: parsed.maxClaims ?? "50",
      cutoffMins: parsed.cutoffMins ?? "15",
      validityMode: parsed.validityMode === "recurring" ? "recurring" : "one-time",
      startTime: parsed.startTime ?? defaultSchedule.startTime,
      endTime: parsed.endTime ?? defaultSchedule.endTime,
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
