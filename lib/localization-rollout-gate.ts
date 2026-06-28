import { KOREAN_COUNTER_REGISTRY } from "./korean-counter-registry.ts";
import { allOfferLocaleTemplates } from "./offer-locale-templates.ts";
import { SUPPORTED_LOCALES, type SupportedLocale } from "./supported-locales.ts";

export const LOCALIZATION_ROLLOUT_GATE_VERSION = "localization-rollout-gate-v1";
export const LOCALIZATION_NATIVE_REVIEW_LOG_PATH = "docs/localization/native-review-log.md";

export type NativeReviewStatus =
  | "internal_owner_recorded"
  | "native_reviewer_signed_off"
  | "native_reviewer_tbd";

export type NativeScreenshotQaStatus = "not_required" | "pending" | "passed";

export type LocalizationRolloutBlockerCode =
  | "NATIVE_REVIEWER_TBD"
  | "OFFER_TEMPLATE_NATIVE_REVIEW_PENDING"
  | "KOREAN_COUNTER_NATIVE_REVIEW_PENDING"
  | "REAL_DEVICE_SCREENSHOT_QA_PENDING";

export type LocalizationRolloutBlocker = {
  code: LocalizationRolloutBlockerCode;
  message: string;
  artifacts: string[];
};

export type LocaleReviewRecord = {
  locale: SupportedLocale;
  reviewerName: string;
  nativeReviewStatus: NativeReviewStatus;
  nativeScreenshotQaStatus: NativeScreenshotQaStatus;
  artifacts: string[];
};

export type LocaleRolloutGate = LocaleReviewRecord & {
  version: typeof LOCALIZATION_ROLLOUT_GATE_VERSION;
  broadProductionAllowed: boolean;
  blockers: LocalizationRolloutBlocker[];
};

export type LocalizationRolloutGateReport = {
  version: typeof LOCALIZATION_ROLLOUT_GATE_VERSION;
  nativeReviewLogPath: typeof LOCALIZATION_NATIVE_REVIEW_LOG_PATH;
  gates: LocaleRolloutGate[];
  broadProductionAllowed: boolean;
  blockedLocales: SupportedLocale[];
};

export const LOCALE_REVIEW_RECORDS: Record<SupportedLocale, LocaleReviewRecord> = {
  "en-US": {
    locale: "en-US",
    reviewerName: "Dan / Twofer admin",
    nativeReviewStatus: "internal_owner_recorded",
    nativeScreenshotQaStatus: "not_required",
    artifacts: ["localized-offer-template-v1"],
  },
  "es-US": {
    locale: "es-US",
    reviewerName: "TBD",
    nativeReviewStatus: "native_reviewer_tbd",
    nativeScreenshotQaStatus: "pending",
    artifacts: [
      "localized-offer-template-v1",
      "owner/customer locale UI strings",
      "AI_AD_LOCALIZATION_PROMPT_V1",
      "AI_AD_LOCALIZATION_REPAIR_PROMPT_V1",
      "AI_AD_LOCALIZATION_SEMANTIC_QA_PROMPT_V1",
      "locale presentation overrides",
    ],
  },
  "ko-KR": {
    locale: "ko-KR",
    reviewerName: "TBD",
    nativeReviewStatus: "native_reviewer_tbd",
    nativeScreenshotQaStatus: "pending",
    artifacts: [
      "localized-offer-template-v1",
      "korean-counter-registry-v0-pending-native-review",
      "owner/customer locale UI strings",
      "AI_AD_LOCALIZATION_PROMPT_V1",
      "AI_AD_LOCALIZATION_REPAIR_PROMPT_V1",
      "AI_AD_LOCALIZATION_SEMANTIC_QA_PROMPT_V1",
      "locale presentation overrides",
    ],
  },
};

function pendingTemplateArtifacts(locale: SupportedLocale): string[] {
  return allOfferLocaleTemplates()
    .filter((template) => template.locale === locale && template.reviewStatus !== "internal_owner_recorded")
    .map((template) => `${template.templateId}@${template.templateVersion}`);
}

function pendingKoreanCounterArtifacts(locale: SupportedLocale): string[] {
  if (locale !== "ko-KR") return [];
  return KOREAN_COUNTER_REGISTRY.filter((counter) => !counter.reviewerApproved).map(
    (counter) => `${counter.counterId}@${counter.version}`,
  );
}

export function getLocaleRolloutGate(locale: SupportedLocale): LocaleRolloutGate {
  const record = LOCALE_REVIEW_RECORDS[locale];
  const blockers: LocalizationRolloutBlocker[] = [];

  if (record.nativeReviewStatus === "native_reviewer_tbd") {
    blockers.push({
      code: "NATIVE_REVIEWER_TBD",
      message: "A named native reviewer must sign off before broad production use.",
      artifacts: record.artifacts,
    });
  }

  const templates = pendingTemplateArtifacts(locale);
  if (templates.length > 0) {
    blockers.push({
      code: "OFFER_TEMPLATE_NATIVE_REVIEW_PENDING",
      message: "Localized offer templates still carry needs_native_review status.",
      artifacts: templates,
    });
  }

  const counters = pendingKoreanCounterArtifacts(locale);
  if (counters.length > 0) {
    blockers.push({
      code: "KOREAN_COUNTER_NATIVE_REVIEW_PENDING",
      message: "Korean counters must be approved before broad Korean production use.",
      artifacts: counters,
    });
  }

  if (record.nativeScreenshotQaStatus === "pending") {
    blockers.push({
      code: "REAL_DEVICE_SCREENSHOT_QA_PENDING",
      message: "Native-language real-device screenshot QA is required before broad production use.",
      artifacts: ["native screenshot QA"],
    });
  }

  return {
    ...record,
    version: LOCALIZATION_ROLLOUT_GATE_VERSION,
    broadProductionAllowed: blockers.length === 0,
    blockers,
  };
}

export function getLocalizationRolloutGateReport(): LocalizationRolloutGateReport {
  const gates = SUPPORTED_LOCALES.map((locale) => getLocaleRolloutGate(locale));
  return {
    version: LOCALIZATION_ROLLOUT_GATE_VERSION,
    nativeReviewLogPath: LOCALIZATION_NATIVE_REVIEW_LOG_PATH,
    gates,
    broadProductionAllowed: gates.every((gate) => gate.broadProductionAllowed),
    blockedLocales: gates.filter((gate) => !gate.broadProductionAllowed).map((gate) => gate.locale),
  };
}

export function assertLocalizationBroadProductionReady(): void {
  const report = getLocalizationRolloutGateReport();
  if (report.broadProductionAllowed) return;

  const summary = report.gates
    .filter((gate) => !gate.broadProductionAllowed)
    .map((gate) => `${gate.locale}: ${gate.blockers.map((blocker) => blocker.code).join(", ")}`)
    .join("; ");

  throw new Error(`Localization broad production rollout is blocked (${summary}).`);
}
