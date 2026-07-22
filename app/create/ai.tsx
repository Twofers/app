import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { File as ExpoFsFile } from "expo-file-system";
import DateTimePicker from "@react-native-community/datetimepicker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { useBusiness } from "../../hooks/use-business";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Banner } from "../../components/ui/banner";
import {
  FORM_SCROLL_KEYBOARD_PROPS,
  IOS_DONE_INPUT_ACCESSORY_ID,
  IosDoneInputAccessory,
  KeyboardScreen,
} from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { DealEligibilityForm } from "@/components/deal-eligibility-form";
import {
  DancingPenguinProgressOverlay,
} from "@/components/dancing-penguin-progress-card";
import { AdPosterCanvas } from "@/components/poster/AdPosterCanvas";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useBrandedConfirm } from "@/hooks/use-branded-confirm";
import { Colors, Gray, PrimaryTint } from "@/constants/theme";
import {
  aiGenerateAd,
  aiReviseAd,
  notifyDealPublished,
  translateDeal,
  translateDealCopy,
  getErrorCode,
  getFunctionErrorBody,
  getErrorWaitSeconds,
  fetchAdGenerationQuota,
} from "../../lib/functions";
import {
  adToDealDraft,
  buildOfferDefinitionFallbackAd,
  buildFallbackTemplateAd,
  composeListingDescription,
  normalizeGeneratedAdDisplayCopy,
  type GeneratedAd,
  type PhotoTreatment,
} from "../../lib/ad-variants";
import { AiAdsEvents, trackEvent } from "../../lib/analytics";
import {
  copyOnlyRevisionTargetForFeedback,
  type AiRevisionTarget,
} from "../../lib/ai-revision-target";
import { summarizeAiRevisionChange } from "../../lib/ai-revision-change";
import { assessDealQuality } from "../../lib/deal-quality";
import {
  resolveDealFlowLanguage,
  translateDealQualityBlock,
} from "../../lib/translate-deal-quality";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { format } from "date-fns";
import { dateFnsLocaleFor } from "../../lib/i18n/date-locale";
import type { AppLocale } from "../../lib/i18n/config";
import { formatAppDateTime } from "../../lib/i18n/format-datetime";
import {
  buildDealFormDirtySnapshot,
  isDealFormDirty,
  type DealFormDirtySnapshot,
} from "../../lib/deal-form-dirty";
import { getDealDisplayTitle } from "@/lib/deal-display-copy";
import {
  buildPublicDealPhotoUrl,
  extractDealPhotoStoragePath,
  resolveCurrentDealPosterStoragePath,
} from "../../lib/deal-poster-url";
import { markRecentPublish } from "../../lib/recent-publish";
import {
  aiDealDraftStorageKey,
  buildAiDealRecoveryDraft,
  parseAiDealRecoveryDraft,
  resolveRecoveredDealSchedule,
  type AiDealRecoveryDraft,
} from "../../lib/ai-deal-draft-recovery";
import { buildAiDealReviewDraft } from "../../lib/ai-deal-review-draft";
import { uploadDealPhoto } from "../../lib/upload-deal-photo";
import { validateStrongDealOnly } from "../../lib/strong-deal-guard";
import { validateDealEligibility } from "../../lib/deal-eligibility";
import {
  buildDealOfferContract,
  validateAiCopyAgainstOffer,
} from "../../lib/deal-offer-contract";
import { buildOfferDefinitionV1FromContract, type OfferDefinitionV1 } from "../../lib/offer-definition";
import {
  buildPosterSpecFromOfferDefinition,
  checkMerchantPosterHeadline,
  checkMerchantPosterSubline,
} from "@/lib/poster/posterCopy";
import { POSTER_TEXT_LIMITS } from "@/lib/poster/posterPolicy";
import { buildDeterministicAdLocalizationBundle } from "@/lib/ad-localization";
import type {
  AdCreativeFormat,
  PosterDraftV1,
  PosterTemplateId,
} from "@/lib/poster/posterTypes";
import { buildDefaultAdPresentationSpec, type AdImageSourceType, type AdPresentationSpec } from "@/lib/ad-presentation-spec";
import {
  createAdPresentationHash,
  type AdPresentationReviewContext,
} from "@/lib/ad-presentation-hash";
import { buildVerifiedAdLocalizationApproval } from "@/lib/ad-localization-approval";
import {
  buildMerchantIdentity,
  imageSourceTypeFromGeneratedAd,
} from "@/lib/ad-render-content";
import { buildOwnerLanguagePreview } from "@/lib/ad-owner-language-preview";
import { resolveLocalePresentationOverrides } from "@/lib/ad-locale-presentation-resolver";
import { buildImageSafeZoneResult } from "@/lib/image-safe-zone";
import { resolveAdPresentation } from "@/lib/ad-template-resolver";
import {
  runDeterministicAdCompositeQa,
  type AdCompositeQaResult,
} from "@/lib/ad-composite-qa";
import type { SourceAwareImageQaResult } from "@/lib/quick-deal-image-qa";
import {
  isAiV4AuthoritativeOfferCardEnabled,
  isAiV4ComposedAdCardEnabled,
  isAiV4CompositeQaEnabled,
  isAiV4CompositeScreenshotQaEnabled,
  isAiV4ExactPresentationApprovalEnabled,
  isAiV4InstantStyleAlternatesEnabled,
  isAiV4MinimalInputFlowEnabled,
  isAiV4PresentationResolverEnabled,
  isAiV4SharedRendererEnabled,
  isAiV5AutomaticVerifiedBundleApprovalEnabled,
  isAiV5LocalizedOwnerUiEnabled,
  isAiV5LocalePresentationOverridesEnabled,
  isAiV5LocaleScreenshotQaEnabled,
} from "@/lib/runtime-env";
import {
  supportedLocaleOrDefault,
  supportedLocaleToAppLanguage,
  type SupportedLocale,
} from "@/lib/supported-locales";
import {
  DEAL_ELIGIBILITY_DEAL_COLUMN_KEYS,
  createDefaultDealEligibilityFormState,
  dealEligibilityFormFromDealRow,
  dealEligibilityFormToDealColumns,
  dealEligibilityFormToInput,
  omitDealEligibilityColumns,
  type DealEligibilityFormState,
} from "../../lib/deal-eligibility-form";
import {
  canUseFallbackTemplateForOutcome,
  classifyGenerationFailure,
  type GenerationOutcomeKind,
} from "@/lib/create-ai-generation-outcome";
import {
  inferDealEligibilityFormFromText,
  mergeInferredEligibilityForm,
} from "@/lib/deal-eligibility-inference";
import {
  createDefaultOneTimeDealSchedule,
  createOneTimeDealScheduleFromStart,
  dealDurationExceedsMax,
  MAX_DEAL_DURATION_MINUTES,
} from "@/lib/deal-schedule-defaults";
import { buildSlowHoursSchedulePreset, type SlowHoursSchedulePreset } from "@/lib/slow-hours-preset";
import {
  aiComposeOfferTranscribe,
  fetchAiComposeQuota,
  type AiComposeQuota,
} from "../../lib/ai-compose-offer";
import {
  buildAuthoritativeDealDisplayCopy,
  buildComposedScreenshotQaSnapshot,
  buildOfferVersionPublishAdSpec,
  buildPublishMechanicsValidationCopy,
  checkMerchantDealTitleAgainstOffer,
  createPublishIdempotencyKey,
  isEdgeRuntimeFailureMessage,
  publishOfferVersionedDeal,
  PUBLISH_SERVICE_UNAVAILABLE_CODE,
  type PublishOfferVersionedDealResult,
} from "../../lib/offer-version-publish";
import {
  buildAdImageSelection,
  type AdImageSelectionQa,
  type MerchantImageEditMode,
  type MerchantImageSourceMode,
} from "../../lib/merchant-image-selection";
import {
  buildDealTranslationFallback,
  type DealTranslationResult,
} from "@/lib/deal-translation-fallback";

type TemplateRow = {
  id: string;
  title: string | null;
  description: string | null;
  price: number | null;
  poster_url: string | null;
  poster_storage_path?: string | null;
  max_claims: number;
  claim_cutoff_buffer_minutes: number;
  is_recurring: boolean;
  days_of_week: number[] | null;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
  timezone?: string | null;
};

type PublishStatus = "idle" | "missing" | "ready" | "publishing" | "success" | "error";
type CreativeFormat = AdCreativeFormat;
type PreviewFormat = CreativeFormat;
type CreateAiTheme = typeof Colors.light;

const FIXED_POSTER_TEMPLATE_ID: PosterTemplateId = "premium";
const DEFAULT_CREATIVE_FORMAT: CreativeFormat = "poster_v1";

const CUTOFF_DURATION_MESSAGE = "Redemption cutoff must be shorter than the deal duration.";

const SCHEDULE_DAY_BY_VALUE: Record<number, string> = {
  1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun",
};

// Preset windows must stay within MAX_DEAL_DURATION_MINUTES (4h guardrail).
const SCHEDULE_PRESETS = [
  { key: "weekdays", days: [1, 2, 3, 4, 5], startMin: 660, endMin: 840 },
  { key: "daily", days: [1, 2, 3, 4, 5, 6, 7], startMin: 840, endMin: 1020 },
  { key: "weekends", days: [6, 7], startMin: 600, endMin: 840 },
] as const;

/** Eligibility fields arrive as numbers or numeric strings; the strong-deal guard wants numbers. */
function toGuardNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

function dateFromMinutes(minutes: number): Date {
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

function minutesFromDate(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hour12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function isMissingDealLocationColumn(error: { code?: string; message?: string } | null | undefined) {
  return (
    (error?.code === "PGRST204" || error?.code === "42703") &&
    error.message?.includes("location_id")
  );
}

function isMissingDealEligibilityColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return (
    (error?.code === "PGRST204" || error?.code === "42703") &&
    DEAL_ELIGIBILITY_DEAL_COLUMN_KEYS.some((key) => message.includes(key))
  );
}

function omitDealLocationId<T extends Record<string, unknown>>(row: T) {
  const { location_id: _locationId, ...rest } = row;
  return rest;
}

function ComposedPreviewTelemetryBeacon(props: {
  generatedAdPresent: boolean;
  presentation: AdPresentationSpec;
  presentationHash: string;
  presentationOptionsCount: number;
  imageSafeZoneConfidence: number;
  compositeQa: AdCompositeQaResult;
  screenshotQaRequired: boolean;
  generationStartedAtRef: MutableRefObject<number | null>;
  previewShownAtRef: MutableRefObject<number | null>;
  lastHashRef: MutableRefObject<string | null>;
}) {
  useEffect(() => {
    if (!props.generatedAdPresent) return;
    if (props.lastHashRef.current === props.presentationHash) return;
    const shownAt = Date.now();
    props.previewShownAtRef.current = shownAt;
    props.lastHashRef.current = props.presentationHash;
    trackEvent(AiAdsEvents.COMPOSED_PREVIEW_SHOWN, {
      screen: "create_ai",
      selected_template_id: props.presentation.templateId,
      alternate_template_count: Math.max(0, props.presentationOptionsCount - 1),
      template_resolution_reason_codes: props.presentation.resolutionReasonCodes.join(","),
      image_source_type: props.presentation.imageSourceType,
      image_asset_id_present: Boolean(props.presentation.imageAssetId),
      safe_zone_confidence: props.imageSafeZoneConfidence,
      supporting_copy_removed: !props.presentation.showSupportingCopy,
      presentation_spec_version: props.presentation.specVersion,
      renderer_version: props.presentation.rendererVersion,
      presentation_hash: props.presentationHash,
      composite_qa_decision: props.compositeQa.decision,
      composite_qa_repair_count: props.compositeQa.repairCodes.length,
      composite_qa_reason_codes: props.compositeQa.hardFailReasons.join(","),
      screenshot_qa_required: props.screenshotQaRequired,
      time_to_first_preview_ms: props.generationStartedAtRef.current
        ? shownAt - props.generationStartedAtRef.current
        : null,
    });
  }, [
    props.generatedAdPresent,
    props.presentation,
    props.presentationHash,
    props.presentationOptionsCount,
    props.imageSafeZoneConfidence,
    props.compositeQa,
    props.screenshotQaRequired,
    props.generationStartedAtRef,
    props.previewShownAtRef,
    props.lastHashRef,
  ]);

  return null;
}

/**
 * English-only schedule summary sent to the AI so its copy can ground in the deal window.
 * Stable English keeps the model's behavior predictable across user locales.
 */
function buildOfferScheduleSummary(
  validityMode: "one-time" | "recurring",
  startTime: Date,
  endTime: Date,
  daysOfWeek: number[],
  windowStart: Date,
  windowEnd: Date,
  timezone: string,
): string {
  if (validityMode === "one-time") {
    return `One-time: ${startTime.toLocaleString()} → ${endTime.toLocaleString()}`;
  }
  const dayLabels = [...daysOfWeek]
    .sort((a, b) => a - b)
    .map((v) => SCHEDULE_DAY_BY_VALUE[v] ?? String(v))
    .join(", ");
  return `Recurring: ${dayLabels} · ${formatMinutes(minutesFromDate(windowStart))}–${formatMinutes(
    minutesFromDate(windowEnd),
  )} (${timezone})`;
}

const DAY_I18N_KEYS = [
  "",
  "createAi.dayMon",
  "createAi.dayTue",
  "createAi.dayWed",
  "createAi.dayThu",
  "createAi.dayFri",
  "createAi.daySat",
  "createAi.daySun",
];

/** Localized schedule label rendered into the user's UI (separate from the AI input). */
function buildDisplayScheduleSummary(
  t: (key: string, opts?: Record<string, unknown>) => string,
  validityMode: "one-time" | "recurring",
  startTime: Date,
  endTime: Date,
  daysOfWeek: number[],
  windowStart: Date,
  windowEnd: Date,
  timezone: string,
  language: string,
): string {
  if (validityMode === "one-time") {
    const start = startTime.toLocaleString(language);
    const end = endTime.toLocaleString(language);
    return t("createAi.scheduleOneTimeFmt", {
      start,
      end,
      defaultValue: `One-time: ${start} → ${end}`,
    });
  }
  const dayLabels = [...daysOfWeek]
    .sort((a, b) => a - b)
    .map((v) => {
      const key = DAY_I18N_KEYS[v] ?? "createAi.dayMon";
      const fallback = SCHEDULE_DAY_BY_VALUE[v] ?? String(v);
      return t(key, { defaultValue: fallback });
    })
    .join(", ");
  const startLabel = formatMinutes(minutesFromDate(windowStart));
  const endLabel = formatMinutes(minutesFromDate(windowEnd));
  return t("createAi.scheduleRecurringFmt", {
    days: dayLabels,
    start: startLabel,
    end: endLabel,
    timezone,
    defaultValue: `Recurring: ${dayLabels} · ${startLabel}–${endLabel} (${timezone})`,
  });
}

function formatPosterLiveDateTime(value: Date, language: string): string {
  return format(value, "MMM d, p", { locale: dateFnsLocaleFor(language) });
}

function buildPosterLiveScheduleSummary(
  t: (key: string, opts?: Record<string, unknown>) => string,
  validityMode: "one-time" | "recurring",
  endTime: Date,
  daysOfWeek: number[],
  windowStart: Date,
  windowEnd: Date,
  language: string,
): string {
  if (validityMode === "one-time") {
    const datetime = formatPosterLiveDateTime(endTime, language);
    return t("consumerWallet.expiresAtLabel", {
      datetime,
      defaultValue: `Redeem by ${datetime}`,
    });
  }
  const sortedDays = [...daysOfWeek].sort((a, b) => a - b);
  const days =
    sortedDays.length === 7
      ? t("createAi.posterScheduleDaily", { defaultValue: "Daily" })
      : sortedDays
          .map((v) => t(DAY_I18N_KEYS[v] ?? "createAi.dayMon", { defaultValue: SCHEDULE_DAY_BY_VALUE[v] ?? String(v) }))
          .join(", ");
  return `${days} ${formatMinutes(minutesFromDate(windowStart))}-${formatMinutes(minutesFromDate(windowEnd))}`;
}

function buildRedemptionLimitSummary(cutoffMinutes: number): string {
  if (!Number.isFinite(cutoffMinutes) || cutoffMinutes <= 0) {
    return "Claims are available until the deal ends.";
  }
  return `Claims close ${cutoffMinutes} minutes before the deal ends.`;
}

async function fileUriToBase64(uri: string): Promise<string> {
  if (Platform.OS !== "web") {
    return new ExpoFsFile(uri).base64();
  }
  const res = await fetch(uri);
  const buf = await res.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

const QUOTA_FOCUS_MIN_MS = 30_000;
const SOFT_REVISION_CAP = 2;
// Fallback wait if the 429 body omits wait_seconds (older function build).
// Mirrors the server default in supabase/functions/_shared/ai-limits.ts.
const DEFAULT_GENERATION_COOLDOWN_SEC = 60;

function createAiRequestGroupId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  const part = () => Math.floor((1 + Math.random()) * 0x100000000).toString(16).slice(1);
  return `${part()}${part()}-${part()}-${part()}-${part()}-${part()}${part()}${part()}`;
}

function parseOptionalPriceInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? NaN : n;
}

function sanitizeDecimalInput(raw: string): string {
  const digitsAndDots = raw.replace(/[^\d.]/g, "");
  const firstDot = digitsAndDots.indexOf(".");
  if (firstDot === -1) return digitsAndDots;
  return `${digitsAndDots.slice(0, firstDot + 1)}${digitsAndDots
    .slice(firstDot + 1)
    .replace(/\./g, "")}`;
}

function sanitizeIntegerInput(raw: string): string {
  return raw.replace(/\D/g, "");
}

function cleanCustomImageEditInstruction(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 400);
}

function cleanPreviewText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function StandardDealPreviewCard({
  imageUri,
  businessName,
  addressLine,
  headline,
  body,
  statusLabel,
  noImageLabel,
  theme,
  darkMode,
}: {
  imageUri: string | null;
  businessName?: string | null;
  addressLine?: string | null;
  headline: string;
  body?: string | null;
  statusLabel: string;
  noImageLabel: string;
  theme: CreateAiTheme;
  darkMode: boolean;
}) {
  const cleanBusiness = cleanPreviewText(businessName);
  const cleanAddress = cleanPreviewText(addressLine);
  const cleanBody = cleanPreviewText(body);
  const displayHeadline = cleanPreviewText(headline) || cleanBusiness || statusLabel;
  const statusColors = darkMode
    ? { background: "rgba(255,159,28,0.18)", border: "rgba(255,180,84,0.36)", text: theme.accentText }
    : { background: PrimaryTint.surfaceStrong, border: PrimaryTint.border, text: theme.accentText };

  return (
    <View
      style={{
        borderRadius: 18,
        backgroundColor: theme.surface,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <View
        style={{
          width: "100%",
          aspectRatio: 1,
          backgroundColor: theme.surfaceMuted,
          borderBottomWidth: imageUri ? 0 : 1,
          borderBottomColor: theme.border,
        }}
      >
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            transition={220}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: Spacing.lg }}>
            <MaterialIcons name="image-not-supported" size={34} color={theme.mutedText} />
            <Text
              style={{ color: theme.mutedText, fontSize: 14, fontWeight: "700", textAlign: "center", lineHeight: 20 }}
              numberOfLines={3}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              {noImageLabel}
            </Text>
          </View>
        )}
      </View>

      <View style={{ padding: Spacing.lg, gap: Spacing.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: Spacing.sm }}>
          <Text
            style={{ fontSize: 26, lineHeight: 32, fontWeight: "900", flex: 1, color: theme.text }}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
          >
            {cleanBusiness || businessName || ""}
          </Text>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: darkMode ? "rgba(240,70,122,0.18)" : "rgba(224,36,94,0.12)",
              borderWidth: 1,
              borderColor: theme.favorite,
            }}
          >
            <MaterialIcons name="favorite" size={25} color={theme.favorite} />
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm, flexWrap: "wrap" }}>
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: Spacing.md,
              paddingVertical: 5,
              backgroundColor: statusColors.background,
              borderWidth: 1,
              borderColor: statusColors.border,
              maxWidth: "100%",
            }}
          >
            <Text
              style={{ fontSize: 12, fontWeight: "800", color: statusColors.text }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.76}
            >
              {statusLabel}
            </Text>
          </View>
          {cleanAddress ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, minWidth: 0, maxWidth: "100%" }}>
              <MaterialIcons name="place" size={15} color={theme.mutedText} />
              <Text style={{ color: theme.mutedText, fontWeight: "700", fontSize: 13, flexShrink: 1 }} numberOfLines={1}>
                {cleanAddress}
              </Text>
            </View>
          ) : null}
        </View>

        <Text
          style={{ fontSize: 23, lineHeight: 31, fontWeight: "900", color: theme.text }}
          numberOfLines={3}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
        >
          {displayHeadline}
        </Text>
        {cleanBody ? (
          <Text numberOfLines={3} style={{ fontSize: 15, color: theme.mutedText, lineHeight: 22, fontWeight: "600" }}>
            {cleanBody}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

type PhotoTreatmentOption = { key: PhotoTreatment; labelKey: string; helperKey: string };

const PHOTO_TREATMENT_OPTIONS: readonly PhotoTreatmentOption[] = [
  { key: "touchup", labelKey: "createAi.treatmentTouchupLabel", helperKey: "createAi.treatmentTouchupHelper" },
  { key: "cleanbg", labelKey: "createAi.treatmentCleanbgLabel", helperKey: "createAi.treatmentCleanbgHelper" },
  { key: "studiopolish", labelKey: "createAi.treatmentStudiopolishLabel", helperKey: "createAi.treatmentStudiopolishHelper" },
];

function imageEditModeForTreatment(treatment: PhotoTreatment | null): MerchantImageEditMode {
  if (treatment === "cleanbg") return "clean_background";
  if (treatment === "studiopolish") return "studio_polish";
  if (treatment === "touchup") return "touchup";
  return "none";
}

function imageSourceModeForPhotoChoice(
  photoPath: string | null,
  usePhotoAsFinal: boolean,
): MerchantImageSourceMode {
  // No-photo drafts still need a real visual on the first pass. The server can
  // fall back to native rendering if every provider/storage image path fails.
  if (!photoPath) return "ai_generated";
  return usePhotoAsFinal ? "merchant_original" : "merchant_ai_edit";
}

function originalPhotoSelectionQa(acknowledged: boolean): AdImageSelectionQa {
  return {
    checked: false,
    sourceType: "merchant_original",
    decision: "unavailable",
    hardFailReasons: [],
    warningCodes: ["MERCHANT_SELECTED_ORIGINAL"],
    missingItems: [],
    unavailable: true,
    merchantOverrideAllowed: true,
    merchantOverrideAcknowledged: acknowledged,
  };
}

function sourceModeForGeneratedPhotoSource(
  photoSource: GeneratedAd["photo_source"],
): MerchantImageSourceMode {
  if (photoSource === "uploaded_original") return "merchant_original";
  if (photoSource === "uploaded_enhanced") return "merchant_ai_edit";
  if (photoSource === "stock") return "approved_stock";
  if (photoSource === "copy_only" || photoSource === "fallback_template") return "deterministic_fallback";
  return "ai_generated";
}

function defaultSelectionQaForSource(sourceType: MerchantImageSourceMode): AdImageSelectionQa {
  if (sourceType === "merchant_original") return originalPhotoSelectionQa(false);
  return {
    checked: false,
    sourceType,
    decision: sourceType === "deterministic_fallback" ? "not_checked" : "pass",
    hardFailReasons: [],
    warningCodes: [],
    missingItems: [],
    unavailable: false,
    merchantOverrideAllowed: false,
    merchantOverrideAcknowledged: false,
  };
}

function generatedAdForPublishSpec(params: {
  ad: GeneratedAd | null;
  finalStoragePath: string | null;
  uploadedPhotoStoragePath: string | null;
  usePhotoAsFinal: boolean;
  merchantOriginalWarningAcknowledged: boolean;
  // Fields the merchant actually changed in the draft editor (null = untouched).
  // They override the AI copy so what the owner sees in the edit boxes is what
  // publishes — the locked offer/terms lines still come from offer facts.
  merchantEditedCopy?: {
    title: string | null;
    promoLine: string | null;
    ctaText: string | null;
  };
}): GeneratedAd | null {
  if (!params.ad) return null;
  const editedTitle = params.merchantEditedCopy?.title?.trim() || null;
  const editedPromoLine = params.merchantEditedCopy?.promoLine?.trim() || null;
  const editedCta = params.merchantEditedCopy?.ctaText?.trim() || null;
  const selectedStoragePath = params.finalStoragePath ?? params.ad.poster_storage_path ?? null;
  const usingUploadedPhoto =
    params.usePhotoAsFinal &&
    selectedStoragePath != null &&
    selectedStoragePath === params.uploadedPhotoStoragePath;
  const photoSource = usingUploadedPhoto
    ? ("uploaded_original" as const)
    : params.ad.photo_source ?? "generated";
  const photoTreatment = usingUploadedPhoto ? null : params.ad.photo_treatment ?? null;
  const editMode = usingUploadedPhoto
    ? "none"
    : params.ad.image_selection?.editMode ?? imageEditModeForTreatment(photoTreatment);
  const qa = usingUploadedPhoto
    ? originalPhotoSelectionQa(params.merchantOriginalWarningAcknowledged)
    : params.ad.image_selection?.qa ?? defaultSelectionQaForSource(sourceModeForGeneratedPhotoSource(photoSource));

  return {
    ...params.ad,
    ...(editedTitle ? { headline: editedTitle } : {}),
    ...(editedPromoLine ? { short_description: editedPromoLine, subheadline: editedPromoLine } : {}),
    ...(editedCta ? { cta: editedCta } : {}),
    poster_storage_path: selectedStoragePath,
    photo_source: photoSource,
    photo_treatment: photoTreatment,
    image_selection: buildAdImageSelection({
      photoSource,
      editMode,
      sourcePhotoPath: usingUploadedPhoto
        ? params.uploadedPhotoStoragePath
        : params.ad.image_selection?.sourcePhotoPath ?? params.uploadedPhotoStoragePath,
      selectedStoragePath,
      provider: params.ad.image_selection?.provider ?? null,
      model: params.ad.image_selection?.model ?? null,
      promptVersion: params.ad.image_selection?.promptVersion ?? null,
      qa,
    }),
  };
}

function buildLiveAdPresentationReviewContext(params: {
  creativeFormat: AdCreativeFormat;
  sourceLocale: SupportedLocale;
  title: string;
  promoLine: string;
  ctaText: string;
  description: string;
  poster: PosterDraftV1 | null;
}): AdPresentationReviewContext {
  const posterCopy = params.poster
    ? params.poster.copy_by_language[params.sourceLocale] ?? params.poster.copy
    : null;
  return {
    creativeFormat: params.creativeFormat,
    sourceLocale: params.sourceLocale,
    headline: params.title.trim(),
    supportingCopy: params.promoLine.trim(),
    ctaLabel: params.ctaText.trim(),
    details: params.description.trim(),
    poster: params.poster && posterCopy
      ? {
          templateId: params.poster.template_id,
          headline: posterCopy.headline.trim(),
          subline: posterCopy.subline?.trim() || null,
          offerLine1: posterCopy.offer_line_1.trim(),
          offerLine2: posterCopy.offer_line_2.trim(),
        }
      : null,
  };
}

function manualDraftGeneratedAdForPublishSpec(params: {
  offerDefinition: OfferDefinitionV1;
  finalStoragePath: string | null;
  uploadedPhotoStoragePath: string | null;
  usePhotoAsFinal: boolean;
  merchantOriginalWarningAcknowledged: boolean;
  title: string;
  promoLine: string;
  ctaText: string;
  description: string;
  ownerOfferHint: string;
  scheduleSummary: string;
  quantityLimit: number | null;
}): GeneratedAd | null {
  if (!params.finalStoragePath) return null;
  const fallback = buildFallbackTemplateAd({
    businessName: params.offerDefinition.merchantName,
    title: params.title,
    promoLine: params.promoLine,
    ctaText: params.ctaText,
    description: params.description,
    ownerOfferHint: params.ownerOfferHint,
    lockedOfferLine: params.offerDefinition.canonicalOfferLine,
    lockedTermsLine: params.offerDefinition.disclosureLine,
    scheduleSummary: params.scheduleSummary,
    quantityLimit: params.quantityLimit,
  });
  const photoSource = params.usePhotoAsFinal ? "uploaded_original" : "fallback_template";
  const sourceMode = sourceModeForGeneratedPhotoSource(photoSource);
  return normalizeGeneratedAdDisplayCopy({
    ...fallback,
    headline: params.title.trim() || fallback.headline,
    subheadline: params.promoLine.trim() || fallback.subheadline,
    short_description: params.promoLine.trim() || fallback.short_description,
    cta: params.ctaText.trim() || fallback.cta,
    terms_summary: params.description.trim() || fallback.terms_summary,
    poster_storage_path: params.finalStoragePath,
    photo_source: photoSource,
    photo_treatment: null,
    image_selection: buildAdImageSelection({
      photoSource,
      editMode: "none",
      sourcePhotoPath: params.uploadedPhotoStoragePath ?? params.finalStoragePath,
      selectedStoragePath: params.finalStoragePath,
      qa: params.usePhotoAsFinal
        ? originalPhotoSelectionQa(params.merchantOriginalWarningAcknowledged)
        : defaultSelectionQaForSource(sourceMode),
    }),
  });
}

type RevisionTarget = AiRevisionTarget;
type RevisionSuggestion = {
  key: string;
  target: RevisionTarget;
  label: string;
  feedback: string;
};
type ComposedEditIntent = "words" | null;
type IosSchedulePickerTarget = "start" | "end" | "windowStart" | "windowEnd";
type ImageVersionKind = "generated" | "revision" | "fallback" | "original";

type ImageVersionEntry = {
  id: string;
  kind: ImageVersionKind;
  ad: GeneratedAd;
  createdAt: string;
};

function imageVersionStoragePath(ad: GeneratedAd | null): string | null {
  return ad?.poster_storage_path ?? ad?.image_selection?.selectedStoragePath ?? null;
}

function imageVersionId(ad: GeneratedAd): string | null {
  const storagePath = imageVersionStoragePath(ad);
  if (!storagePath) return null;
  const source = ad.photo_source ?? "generated";
  const treatment = ad.photo_treatment ?? "none";
  const editMode = ad.image_selection?.editMode ?? "none";
  return [storagePath, source, treatment, editMode].join("|");
}

function buildImageVersionEntry(ad: GeneratedAd, kind: ImageVersionKind): ImageVersionEntry | null {
  const id = imageVersionId(ad);
  if (!id) return null;
  return {
    id,
    kind,
    ad: normalizeGeneratedAdDisplayCopy(ad),
    createdAt: new Date().toISOString(),
  };
}

function buildOriginalPhotoVersionAd(ad: GeneratedAd, originalStoragePath: string | null): GeneratedAd | null {
  if (!originalStoragePath) return null;
  return normalizeGeneratedAdDisplayCopy({
    ...ad,
    poster_storage_path: originalStoragePath,
    photo_source: "uploaded_original",
    photo_treatment: null,
    image_selection: buildAdImageSelection({
      photoSource: "uploaded_original",
      editMode: "none",
      sourcePhotoPath: originalStoragePath,
      selectedStoragePath: originalStoragePath,
      qa: originalPhotoSelectionQa(false),
    }),
  });
}

function sourceAwareQaFromSelectionQa(
  qa: AdImageSelectionQa | null | undefined,
  sourceType: AdImageSourceType,
  hasImage: boolean,
): SourceAwareImageQaResult {
  if (!qa) {
    return {
      checked: false,
      available: hasImage || sourceType === "deterministic_fallback",
      sourceType,
      decision: sourceType === "deterministic_fallback" ? "pass" : "not_checked",
      hardFailReasons: [],
      warningCodes: hasImage && sourceType !== "deterministic_fallback" ? ["IMAGE_QA_NOT_CHECKED"] : [],
      missingItems: [],
      forbiddenElements: [],
      merchantOverrideAllowed: false,
      merchantOverrideAcknowledged: false,
      notes: "",
    };
  }

  return {
    checked: qa.checked,
    available: hasImage && !qa.unavailable,
    sourceType,
    decision: qa.decision,
    hardFailReasons: Array.isArray(qa.hardFailReasons) ? qa.hardFailReasons : [],
    warningCodes: Array.isArray(qa.warningCodes) ? qa.warningCodes : [],
    missingItems: Array.isArray(qa.missingItems) ? qa.missingItems : [],
    forbiddenElements: [],
    merchantOverrideAllowed: qa.merchantOverrideAllowed,
    merchantOverrideAcknowledged: qa.merchantOverrideAcknowledged,
    notes: "",
  };
}

function cropSuitabilityScoreForQa(qa: SourceAwareImageQaResult): number {
  if (qa.sourceType === "deterministic_fallback") return 1;
  if (qa.decision === "pass") return 0.84;
  if (qa.decision === "warn") return 0.62;
  if (qa.decision === "not_checked") return 0.72;
  return 0.34;
}

export default function AiDealScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { confirm, confirmModal } = useBrandedConfirm();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const params = useLocalSearchParams<{
    templateId?: string;
    dealId?: string;
    prefillTitle?: string;
    prefillPromoLine?: string;
    prefillCta?: string;
    prefillDescription?: string;
    prefillHint?: string;
    prefillPrice?: string;
    prefillPosterPath?: string;
    prefillPosterUrl?: string;
    fromAiCompose?: string;
    fromMenuOffer?: string;
    fromReuse?: string;
    fromCreateHub?: string;
    prefillLocationId?: string;
    prefillExtraLocationIds?: string;
    prefillIsRecurring?: string;
    prefillDaysOfWeek?: string;
    prefillWindowStartMin?: string;
    prefillWindowEndMin?: string;
    prefillTimezone?: string;
    prefillStartTime?: string;
    prefillEndTime?: string;
    prefillMaxClaims?: string;
    prefillCutoffMins?: string;
    prefillSourceLocale?: string;
    prefillDealEligibility?: string;
  }>();
  const { templateId, dealId: dealIdParam } = params;
  const { t, i18n } = useTranslation();
  const {
    isLoggedIn,
    businessId,
    businessContextForAi,
    businessPreferredLocale,
    businessName,
    businessProfile,
    loading: businessLoading,
  } = useBusiness();
  const localizedOwnerUiEnabled = isAiV5LocalizedOwnerUiEnabled();
  const automaticLocalizationApprovalEnabled = isAiV5AutomaticVerifiedBundleApprovalEnabled();
  const defaultAuthoringLocale = supportedLocaleOrDefault(i18n.language);
  const [draftSourceLocale, setDraftSourceLocale] = useState<SupportedLocale | null>(null);
  const draftSourceBusinessRef = useRef<string | null>(null);
  useEffect(() => {
    if (!localizedOwnerUiEnabled) return;
    setDraftSourceLocale((current) => {
      const nextBusinessId = businessId ?? null;
      if (draftSourceBusinessRef.current !== nextBusinessId) {
        draftSourceBusinessRef.current = nextBusinessId;
        return defaultAuthoringLocale;
      }
      return current ?? defaultAuthoringLocale;
    });
  }, [businessId, defaultAuthoringLocale, localizedOwnerUiEnabled]);
  const effectiveDraftSourceLocale = draftSourceLocale ?? defaultAuthoringLocale;
  const dealOutputLang = localizedOwnerUiEnabled
    ? supportedLocaleToAppLanguage(effectiveDraftSourceLocale)
    : resolveDealFlowLanguage(businessPreferredLocale, i18n.language);

  // Voice input
  const recorder = useAudioRecorder(
    RecordingPresets.HIGH_QUALITY,
  );
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // AI quota
  const [quota, setQuota] = useState<AiComposeQuota | null>(null);
  const lastQuotaFetchRef = useRef(0);
  const reloadQuota = useCallback(async () => {
    if (!businessId) return;
    const q = await fetchAdGenerationQuota(businessId) ?? await fetchAiComposeQuota(businessId);
    setQuota(q);
  }, [businessId]);
  useFocusEffect(
    useCallback(() => {
      if (!businessId) return;
      const now = Date.now();
      if (quota !== null && now - lastQuotaFetchRef.current < QUOTA_FOCUS_MIN_MS) return;
      void reloadQuota().then(() => { lastQuotaFetchRef.current = Date.now(); });
    }, [businessId, reloadQuota, quota]),
  );

  // Slow-hours schedule suggestion. RLS limits business_slow_hours to business
  // members, so this quietly stays empty for accounts without that data.
  useEffect(() => {
    if (!businessId) {
      setSlowHoursPreset(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("business_slow_hours")
        .select("day_of_week,starts_at,ends_at")
        .eq("business_id", businessId)
        .limit(50);
      if (cancelled || error) return;
      setSlowHoursPreset(buildSlowHoursSchedulePreset(data ?? []));
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  function formatPickerTime(date: Date) {
    return format(date, "p", { locale: dateFnsLocaleFor(i18n.language) });
  }

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [photoStepCollapsed, setPhotoStepCollapsed] = useState(false);
  const pendingDescriptionScrollAfterCollapseRef = useRef(false);
  const [photoTreatment, setPhotoTreatment] = useState<PhotoTreatment>("studiopolish");
  const [useCustomImageEdit, setUseCustomImageEdit] = useState(false);
  const [customImageEditInstruction, setCustomImageEditInstruction] = useState("");
  const [usePhotoAsFinal, setUsePhotoAsFinal] = useState(false);
  const [merchantOriginalWarningAcknowledged, setMerchantOriginalWarningAcknowledged] = useState(false);
  const [creativeFormat, setCreativeFormat] = useState<CreativeFormat>(DEFAULT_CREATIVE_FORMAT);
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>(DEFAULT_CREATIVE_FORMAT);

  const [hintText, setHintText] = useState("");
  const [price, setPrice] = useState("");
  const [eligibilityForm, setEligibilityForm] = useState<DealEligibilityFormState>(
    () => createDefaultDealEligibilityFormState(),
  );
  const lastAutoEligibilityInferenceRef = useRef<DealEligibilityFormState | null>(null);
  // Fields the merchant edited by hand in the offer form; free-text auto-inference
  // must never overwrite them, nor flip a manually chosen offer rule (Phase 2.4).
  const eligibilityTouchedRef = useRef<Set<keyof DealEligibilityFormState>>(new Set());
  const [title, setTitle] = useState("");
  const [promoLine, setPromoLine] = useState("");
  // The text actually rendered on the poster (large headline + small top
  // subheadline/kicker). Seeded from the generated poster copy and editable
  // until publish; title/promoLine stay the card-format copy.
  const [posterHeadlineText, setPosterHeadlineText] = useState("");
  const [posterSublineText, setPosterSublineText] = useState("");
  const [ctaText, setCtaText] = useState("");
  const [description, setDescription] = useState("");
  const [maxClaims, setMaxClaims] = useState("10");
  const [cutoffMins, setCutoffMins] = useState("15");
  const [validityMode, setValidityMode] = useState<"one-time" | "recurring">("one-time");
  const [initialOneTimeSchedule] = useState(() => createDefaultOneTimeDealSchedule());
  const [startTime, setStartTime] = useState(() => initialOneTimeSchedule.startTime);
  const [endTime, setEndTime] = useState(() => initialOneTimeSchedule.endTime);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [androidStartPickerMode, setAndroidStartPickerMode] = useState<"date" | "time">("date");
  const androidStartDateRef = useRef<Date | null>(null);
  const [androidEndPickerMode, setAndroidEndPickerMode] = useState<"date" | "time">("date");
  const androidEndDateRef = useRef<Date | null>(null);
  const [showWindowStartPicker, setShowWindowStartPicker] = useState(false);
  const [showWindowEndPicker, setShowWindowEndPicker] = useState(false);
  const [windowStart, setWindowStart] = useState(new Date());
  const [windowEnd, setWindowEnd] = useState(new Date(Date.now() + 60 * 60 * 1000));
  const [iosSchedulePicker, setIosSchedulePicker] = useState<IosSchedulePickerTarget | null>(null);
  const [iosScheduleDraft, setIosScheduleDraft] = useState(new Date());
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [schedulePreset, setSchedulePreset] = useState<string | null>(null);
  // Slow-hours preset built from business_slow_hours (website signup data).
  // null = no structured slow-hours data visible to this account.
  const [slowHoursPreset, setSlowHoursPreset] = useState<SlowHoursSchedulePreset | null>(null);
  const [claimSettingsOpen, setClaimSettingsOpen] = useState(false);
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
  );
  const [banner, setBanner] = useState<{
    message: string;
    tone?: "error" | "success" | "info" | "warning";
  } | null>(null);

  // Generation state — single ad, with revise loop
  const [generating, setGenerating] = useState(false);
  const [generatedAd, setGeneratedAd] = useState<GeneratedAd | null>(null);
  const [imageVersions, setImageVersions] = useState<ImageVersionEntry[]>([]);
  const [adAccepted, setAdAccepted] = useState(false);
  /**
   * Tracks the treatment that produced the *current* generatedAd.poster_storage_path.
   * The user can change `photoTreatment` between generate and revise; the server needs to
   * know what treatment produced the previous_ad's image, not the current UI selection.
   */
  const lastSentPhotoTreatmentRef = useRef<PhotoTreatment | null>(null);

  // Revision state
  const [revising, setRevising] = useState(false);
  const [revisionsUsed, setRevisionsUsed] = useState(0);
  const [revisionTarget, setRevisionTarget] = useState<RevisionTarget>("both");
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [composedStyleIndex, setComposedStyleIndex] = useState(0);
  // Single-variant flow: the edit-intent no longer gates the (now always-visible)
  // refine panel; the setter still runs as a harmless reset across the flow.
  const [, setComposedEditIntent] = useState<ComposedEditIntent>(null);
  const [approvedComposedPresentationHash, setApprovedComposedPresentationHash] = useState<string | null>(null);
  const [approvedLocalizationApprovalHash, setApprovedLocalizationApprovalHash] = useState<string | null>(null);
  /**
   * Monotonic ID for in-flight generate/revise calls. If user replaces the photo or hits
   * generate again before a revise resolves, we bump this counter and discard stale results.
   */
  const generationRequestIdRef = useRef(0);
  const aiRequestGroupIdRef = useRef(createAiRequestGroupId());
  const adGenerationStartedAtRef = useRef<number | null>(null);
  const composedPreviewShownAtRef = useRef<number | null>(null);
  const lastComposedPreviewTelemetryHashRef = useRef<string | null>(null);

  const aiDraftBaselineRef = useRef<{
    title: string;
    promo_line: string;
    cta_text: string;
    description: string;
  } | null>(null);
  const photoPersistRequestIdRef = useRef(0);
  const photoPersistUploadRef = useRef<{
    uri: string;
    requestId: number;
    promise: Promise<string>;
  } | null>(null);
  const [manualDraftUnlocked, setManualDraftUnlocked] = useState(false);
  const [lastGenerationError, setLastGenerationError] = useState<string | null>(null);
  const [lastGenerationOutcomeKind, setLastGenerationOutcomeKind] = useState<GenerationOutcomeKind | null>(null);
  /**
   * Epoch-ms deadline for the AI generate cooldown (server rate limit). Stored as
   * an absolute time, not a decrementing count, so the countdown stays correct if
   * the app backgrounds and resumes mid-wait. null = no cooldown.
   */
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownNowTick, setCooldownNowTick] = useState(() => Date.now());
  const [publishLocationIds, setPublishLocationIds] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("idle");
  const [publishStatusMessage, setPublishStatusMessage] = useState<string | null>(null);
  const publishInFlightRef = useRef(false);
  const publishIdempotencyKeyRef = useRef<string | null>(null);
  const [allowPostPublishNavigation, setAllowPostPublishNavigation] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const hintInputRef = useRef<TextInput | null>(null);
  const customImageEditInputRef = useRef<TextInput | null>(null);
  const descriptionSectionYRef = useRef<number | null>(null);
  const [scheduleSectionY, setScheduleSectionY] = useState<number | null>(null);
  const scheduleSectionYRef = useRef<number | null>(null);
  const generationSectionYRef = useRef<number | null>(null);
  const adReviewSectionYRef = useRef<number | null>(null);
  const draftEditorSectionYRef = useRef<number | null>(null);
  const previousEligibleRef = useRef(false);
  const menuOfferScrollDoneRef = useRef(false);
  const reuseScrollDoneRef = useRef(false);
  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [editingSourceLocale, setEditingSourceLocale] = useState<AppLocale | null>(null);
  const [prefillSourceLocale, setPrefillSourceLocale] = useState<AppLocale | null>(null);
  // The one source locale the deal publishes with. Preview/approve and publish must
  // build their presentation from the SAME locale, or the approved presentation hash
  // can never equal the one publish rebuilds and publishing is blocked outright.
  // With the localized owner UI on this is exactly `effectiveDraftSourceLocale` (the
  // appLanguage round-trip is identity for every supported locale); with it off the
  // deal still publishes in the deal-flow language, so the preview follows publish
  // rather than the raw UI language.
  const publishSourceLocale = supportedLocaleOrDefault(
    localizedOwnerUiEnabled ? dealOutputLang : editingSourceLocale ?? prefillSourceLocale ?? dealOutputLang,
  );
  const [dealLoadError, setDealLoadError] = useState<string | null>(null);
  const [dealLoadNonce, setDealLoadNonce] = useState(0);
  const [dealEditLoading, setDealEditLoading] = useState(false);
  const [editDirtyBaseline, setEditDirtyBaseline] = useState<DealFormDirtySnapshot | null>(null);
  const [composeDirtyBaseline, setComposeDirtyBaseline] = useState<DealFormDirtySnapshot | null>(null);
  const [prefillBaselineReady, setPrefillBaselineReady] = useState(false);
  const [pendingRecoveredDraft, setPendingRecoveredDraft] = useState<AiDealRecoveryDraft | null>(null);
  const draftHydratedRef = useRef(false);

  const dealIdFromRoute = useMemo(() => {
    const raw = dealIdParam;
    const s = Array.isArray(raw) ? raw[0] : raw;
    return typeof s === "string" ? s.trim() : "";
  }, [dealIdParam]);

  const hasCreatePrefillParams = useMemo(() => {
    const g = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
    return Boolean(
      g(params.prefillTitle).trim() ||
        g(params.prefillPromoLine).trim() ||
        g(params.prefillCta).trim() ||
        g(params.prefillDescription).trim() ||
        g(params.prefillHint).trim() ||
        g(params.prefillPrice).trim() ||
        g(params.prefillPosterPath).trim() ||
        g(params.prefillPosterUrl).trim() ||
        g(params.prefillDealEligibility).trim() ||
        g(params.prefillLocationId).trim() ||
        g(params.prefillExtraLocationIds).trim() ||
        g(params.prefillIsRecurring).trim() ||
        g(params.prefillDaysOfWeek).trim() ||
        g(params.prefillWindowStartMin).trim() ||
        g(params.prefillWindowEndMin).trim() ||
        g(params.prefillTimezone).trim() ||
        g(params.prefillStartTime).trim() ||
        g(params.prefillEndTime).trim() ||
        g(params.prefillMaxClaims).trim() ||
        g(params.prefillCutoffMins).trim(),
    );
  }, [
    params.prefillTitle,
    params.prefillPromoLine,
    params.prefillCta,
    params.prefillDescription,
    params.prefillHint,
    params.prefillPrice,
    params.prefillPosterPath,
    params.prefillPosterUrl,
    params.prefillDealEligibility,
    params.prefillLocationId,
    params.prefillExtraLocationIds,
    params.prefillIsRecurring,
    params.prefillDaysOfWeek,
    params.prefillWindowStartMin,
    params.prefillWindowEndMin,
    params.prefillTimezone,
    params.prefillStartTime,
    params.prefillEndTime,
    params.prefillMaxClaims,
    params.prefillCutoffMins,
  ]);

  const shouldUseDraftRecovery = !dealIdFromRoute && !templateId && !hasCreatePrefillParams;

  /** Stable English — shipped to the AI. Do not localize. */
  const offerScheduleSummary = useMemo(
    () =>
      buildOfferScheduleSummary(
        validityMode,
        startTime,
        endTime,
        daysOfWeek,
        windowStart,
        windowEnd,
        timezone,
      ),
    [validityMode, startTime, endTime, daysOfWeek, windowStart, windowEnd, timezone],
  );

  /** Localized — shown in the user's UI. */
  const displayScheduleSummary = useMemo(
    () =>
      buildDisplayScheduleSummary(
        t,
        validityMode,
        startTime,
        endTime,
        daysOfWeek,
        windowStart,
        windowEnd,
        timezone,
        i18n.language,
      ),
    [t, validityMode, startTime, endTime, daysOfWeek, windowStart, windowEnd, timezone, i18n.language],
  );
  const posterLiveScheduleLabel = useMemo(
    () =>
      buildPosterLiveScheduleSummary(
        t,
        validityMode,
        endTime,
        daysOfWeek,
        windowStart,
        windowEnd,
        i18n.language,
      ),
    [t, validityMode, endTime, daysOfWeek, windowStart, windowEnd, i18n.language],
  );
  // F-024: an empty AI poster kicker (copy.subline) must NOT fall back to a
  // generic "Try our" eyebrow — stacked above a headline that begins with a
  // quantifier ("Any muffin…") it reads as the ungrammatical "Try our any
  // muffin". The AI leaves the kicker empty on purpose (prompt.ts forbids generic
  // "Try our" kickers), so render no eyebrow instead of generic filler.
  const posterEyebrowLabel = null;
  const eligibilityInput = useMemo(
    () => dealEligibilityFormToInput(eligibilityForm),
    [eligibilityForm],
  );
  const eligibilityResult = useMemo(
    () => validateDealEligibility(eligibilityInput),
    [eligibilityInput],
  );
  const redemptionLimitSummary = useMemo(
    () => buildRedemptionLimitSummary(Number(cutoffMins)),
    [cutoffMins],
  );
  const offerContract = useMemo(() => {
    if (!businessId) return null;
    const maxClaimsNum = Number(maxClaims);
    return buildDealOfferContract({
      businessId,
      businessName: businessName || "",
      locationId: publishLocationIds[0] ?? businessId,
      locationName: businessContextForAi.address || businessContextForAi.location || businessName || "",
      dealEligibility: eligibilityInput,
      eligibilityResult,
      activeWindowHumanReadable: offerScheduleSummary,
      quantityLimit: Number.isFinite(maxClaimsNum) && maxClaimsNum > 0 ? maxClaimsNum : null,
    });
  }, [
    businessContextForAi.address,
    businessContextForAi.location,
    businessId,
    businessName,
    eligibilityInput,
    eligibilityResult,
    maxClaims,
    offerScheduleSummary,
    publishLocationIds,
  ]);
  const offerDefinition = useMemo(() => {
    if (!offerContract) return null;
    return buildOfferDefinitionV1FromContract(offerContract, {
      dealEligibility: eligibilityInput,
      redemptionLimit: redemptionLimitSummary,
      schedule: {
        mode: validityMode === "one-time" ? "one_time" : "recurring",
        summary: offerScheduleSummary,
        startsAt: validityMode === "one-time" ? startTime.toISOString() : null,
        endsAt: validityMode === "one-time" ? endTime.toISOString() : null,
        timeZone: timezone,
        daysOfWeek: validityMode === "recurring" ? daysOfWeek : null,
        windowStartMinutes: validityMode === "recurring" ? minutesFromDate(windowStart) : null,
        windowEndMinutes: validityMode === "recurring" ? minutesFromDate(windowEnd) : null,
      },
    });
  }, [
    daysOfWeek,
    eligibilityInput,
    endTime,
    offerContract,
    offerScheduleSummary,
    redemptionLimitSummary,
    startTime,
    timezone,
    validityMode,
    windowEnd,
    windowStart,
  ]);

  const publishReadiness = useMemo(() => {
    const missingFields: ("headline" | "details")[] = [];
    if (!title.trim()) missingFields.push("headline");
    if (!description.trim()) missingFields.push("details");
    const canPublish = missingFields.length === 0;
    let reasonMessage = "";
    if (!canPublish) {
      if (missingFields.length === 2) {
        reasonMessage = t("createAi.publishMissingBody");
      } else if (missingFields[0] === "headline") {
        reasonMessage = t("createAi.publishMissingHeadlineBody", {
          defaultValue: "Add a headline before publishing.",
        });
      } else {
        reasonMessage = t("createAi.publishMissingDetailsBody", {
          defaultValue: "Add offer details before publishing.",
        });
      }
    }
    return {
      canPublish,
      missingFields,
      reasonMessage,
      buttonLabel: canPublish
        ? editingDealId
          ? t("createAi.saveDealChanges")
          : t("createAi.publishDeal")
        : editingDealId
          ? t("createAi.completeDetailsToSave", { defaultValue: "Complete details to save" })
          : t("createAi.completeDetailsToPublish", { defaultValue: "Complete details to publish" }),
    };
  }, [description, editingDealId, t, title]);
  const canPublish = publishReadiness.canPublish;

  const displayedPublishStatus = useMemo<PublishStatus>(() => {
    if (publishing) return "publishing";
    if (publishStatus === "success" || publishStatus === "error") return publishStatus;
    if (!canPublish) return "missing";
    return "ready";
  }, [canPublish, publishing, publishStatus]);

  const publishStatusCard = useMemo(() => {
    switch (displayedPublishStatus) {
      case "publishing":
        return {
          icon: "hourglass-empty" as const,
          title: t("createAi.publishBusyTitle"),
          body: t("createAi.publishBusyBody"),
          backgroundColor: theme.surfaceMuted,
          borderColor: theme.border,
          titleColor: theme.text,
        };
      case "success":
        return {
          icon: "check-circle" as const,
          title: editingDealId ? t("createAi.publishUpdateSuccessTitle") : t("createAi.publishSuccessTitle"),
          body: publishStatusMessage ?? t("createAi.publishSuccessBody"),
          backgroundColor: PrimaryTint.surface,
          borderColor: PrimaryTint.border,
          titleColor: theme.accentText,
        };
      case "error":
        return {
          icon: "error-outline" as const,
          title: t("createAi.publishFailedTitle"),
          body: publishStatusMessage ?? t("createAi.errPublishFailed"),
          backgroundColor: theme.surfaceMuted,
          borderColor: theme.danger,
          titleColor: theme.danger,
        };
      case "missing":
        return {
          icon: "edit" as const,
          title: t("createAi.publishMissingTitle"),
          body: publishReadiness.reasonMessage || t("createAi.publishMissingBody"),
          backgroundColor: theme.surfaceMuted,
          borderColor: theme.border,
          titleColor: theme.mutedText,
        };
      case "ready":
      default:
        return {
          icon: "assignment-turned-in" as const,
          title: editingDealId ? t("createAi.publishUpdateReadyTitle") : t("createAi.publishReadyTitle"),
          body: editingDealId ? t("createAi.publishUpdateReadyBody") : t("createAi.publishReadyBody"),
          backgroundColor: colorScheme === "dark" ? "rgba(255,159,28,0.14)" : "#FFF7ED",
          borderColor: theme.primary,
          titleColor: theme.accentText,
        };
    }
  }, [colorScheme, displayedPublishStatus, editingDealId, publishReadiness.reasonMessage, publishStatusMessage, t, theme]);

  const generationRecovery = useMemo(() => {
    if (!lastGenerationError || !lastGenerationOutcomeKind) return null;
    const fallbackAllowed = canUseFallbackTemplateForOutcome(lastGenerationOutcomeKind);
    const body =
      lastGenerationOutcomeKind === "ownership_blocked"
        ? t("createAi.generationOwnershipBody", {
            defaultValue: "This account cannot create or publish ads for this business. Log in with the owner account to continue.",
          })
        : lastGenerationOutcomeKind === "quota_or_cooldown_blocked"
          ? t("createAi.generationQuotaBody", {
              defaultValue: "AI generation is paused for this account right now. You can write the ad yourself, or try AI again when it resets.",
            })
          : lastGenerationOutcomeKind === "input_or_offer_blocked"
            ? t("createAi.generationInputBody", {
                defaultValue: "Fix the account, photo, or deal details above, then try again.",
              })
            : fallbackAllowed
              ? t("createAi.fallbackTemplateBody", {
                  defaultValue: "AI had trouble, but your confirmed photo and deal details can still make a clean fallback ad.",
                })
              : t("createAi.generationNoFallbackBody", {
                  defaultValue: "AI had trouble and there is no saved image to use for a fallback. Add a photo, try again, or write the ad yourself.",
                });

    return {
      title: lastGenerationError,
      body,
      showFallbackAction: fallbackAllowed,
      showManualAction: lastGenerationOutcomeKind !== "ownership_blocked",
    };
  }, [lastGenerationError, lastGenerationOutcomeKind, t]);

  // Drive the generate-cooldown countdown once a second while a deadline is set.
  // Re-arming on cooldownNowTick keeps a single pending timeout alive until the
  // deadline passes, then clears the cooldown so the button reverts on its own.
  useEffect(() => {
    if (cooldownUntil == null) return;
    if (Date.now() >= cooldownUntil) {
      setCooldownUntil(null);
      return;
    }
    const id = setTimeout(() => setCooldownNowTick(Date.now()), 1000);
    return () => clearTimeout(id);
  }, [cooldownUntil, cooldownNowTick]);

  const cooldownSecondsLeft =
    cooldownUntil == null ? 0 : Math.max(0, Math.ceil((cooldownUntil - cooldownNowTick) / 1000));
  const cooldownActive = cooldownSecondsLeft > 0;

  const hasDraftCopy =
    title.trim().length > 0 ||
    promoLine.trim().length > 0 ||
    ctaText.trim().length > 0 ||
    description.trim().length > 0;
  const showDraftEditor =
    templateLoaded ||
    editingDealId != null ||
    adAccepted ||
    manualDraftUnlocked ||
    (!generatedAd && hasDraftCopy);

  const scrollToFormY = useCallback((y: number | null, fallback: "none" | "end" = "none", topOffset: number = Spacing.md) => {
    setTimeout(() => {
      if (y != null) {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - topOffset), animated: true });
      } else if (fallback === "end") {
        scrollRef.current?.scrollToEnd({ animated: true });
      }
    }, 220);
  }, []);

  const scrollToDescriptionStep = useCallback(() => {
    scrollToFormY(descriptionSectionYRef.current, "none", top + Spacing.lg);
  }, [scrollToFormY, top]);

  useEffect(() => {
    if (!photoStepCollapsed || !pendingDescriptionScrollAfterCollapseRef.current) return;
    const tid = setTimeout(() => {
      pendingDescriptionScrollAfterCollapseRef.current = false;
      scrollToDescriptionStep();
    }, 360);
    return () => clearTimeout(tid);
  }, [photoStepCollapsed, scrollToDescriptionStep]);

  function scrollToAdReview() {
    scrollToFormY(adReviewSectionYRef.current, "end");
  }

  function scrollToGenerationRecovery() {
    scrollToFormY(generationSectionYRef.current, "end");
  }

  function scrollToDraftEditor() {
    scrollToFormY(draftEditorSectionYRef.current, "end");
  }

  function hasFallbackTemplateSource() {
    return Boolean(imageVersionStoragePath(generatedAd) || photoPath || photoUri || posterUrl);
  }

  function clearGenerationErrorState() {
    setLastGenerationError(null);
    setLastGenerationOutcomeKind(null);
  }

  function setGenerationFailureState(message: string, kind: GenerationOutcomeKind) {
    setLastGenerationError(message);
    setLastGenerationOutcomeKind(kind);
    setTimeout(() => scrollToGenerationRecovery(), 120);
  }

  /**
   * A too-soon retry hit the server rate limit. Start (or extend) the live
   * countdown on the Generate button instead of showing an error card/banner —
   * the button label and caption reset automatically when the deadline passes.
   */
  function beginGenerationCooldown(err: unknown) {
    const seconds = getErrorWaitSeconds(err) ?? DEFAULT_GENERATION_COOLDOWN_SEC;
    setCooldownUntil(Date.now() + seconds * 1000);
    setCooldownNowTick(Date.now());
    clearGenerationErrorState();
  }

  function applyInferredEligibilityFromHint(text: string) {
    const inferred = inferDealEligibilityFormFromText(text);
    if (!inferred) {
      lastAutoEligibilityInferenceRef.current = null;
      return;
    }
    setEligibilityForm((current) =>
      mergeInferredEligibilityForm(current, inferred, {
        allowDealTypeChange: true,
        previousInferred: lastAutoEligibilityInferenceRef.current,
        touchedFields: eligibilityTouchedRef.current,
      }),
    );
    lastAutoEligibilityInferenceRef.current = inferred;
  }

  function handleHintTextChange(text: string) {
    setHintText(text);
    applyInferredEligibilityFromHint(text);
  }

  function handleEligibilityFormChange(next: DealEligibilityFormState) {
    // The offer form changes exactly one field per interaction; record every
    // field the merchant edits so later hint auto-inference leaves it alone.
    for (const key of Object.keys(next) as (keyof DealEligibilityFormState)[]) {
      if (next[key] !== eligibilityForm[key]) eligibilityTouchedRef.current.add(key);
    }
    setEligibilityForm(next);
  }

  function skipPhotoToDescription() {
    pendingDescriptionScrollAfterCollapseRef.current = true;
    setPhotoStepCollapsed(true);
    setBanner({
      message: t("createAi.photoSkippedBanner", {
        defaultValue: "No photo selected. Describe the deal and Twofer will use those details.",
      }),
      tone: "info",
    });
  }

  useEffect(() => {
    if (eligibilityResult.eligible && !previousEligibleRef.current) {
      const targetY = scheduleSectionY ?? scheduleSectionYRef.current;
      setTimeout(() => {
        if (targetY != null) {
          scrollRef.current?.scrollTo({ y: Math.max(0, targetY - Spacing.md), animated: true });
        }
      }, 220);
    }
    previousEligibleRef.current = eligibilityResult.eligible;
  }, [eligibilityResult.eligible, scheduleSectionY]);

  const rememberImageVersion = useCallback((ad: GeneratedAd, kind: ImageVersionKind) => {
    const entry = buildImageVersionEntry(ad, kind);
    if (!entry) return;
    setImageVersions((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== entry.id);
      return [...withoutDuplicate, entry].slice(-6);
    });
  }, []);

  function restoreImageVersion(entry: ImageVersionEntry) {
    const restored = normalizeGeneratedAdDisplayCopy(entry.ad);
    const restoredPath = imageVersionStoragePath(restored);
    setGeneratedAd(restored);
    setUsePhotoAsFinal(restored.photo_source === "uploaded_original");
    setMerchantOriginalWarningAcknowledged(false);
    if (restored.photo_treatment) setPhotoTreatment(restored.photo_treatment);
    if (restored.photo_source === "uploaded_original" && restoredPath) {
      setPhotoPath((current) => current ?? restoredPath);
      setPosterUrl((current) => current ?? buildPublicDealPhotoUrl(restoredPath));
    }
    lastSentPhotoTreatmentRef.current = restored.photo_treatment ?? null;
    if (restored.poster?.copy) {
      setPosterHeadlineText(restored.poster.copy.headline ?? "");
      setPosterSublineText(restored.poster.copy.subline ?? "");
    }
    setAdAccepted(false);
    setManualDraftUnlocked(true);
    setPublishStatus("idle");
    setPublishStatusMessage(null);
    setComposedStyleIndex(0);
    setComposedEditIntent(null);
    setApprovedComposedPresentationHash(null);
    setApprovedLocalizationApprovalHash(null);
    aiDraftBaselineRef.current = null;
    setBanner({
      message: t("createAi.imageRestoredBanner", {
        defaultValue: "Image restored. Review and approve the ad before publishing.",
      }),
      tone: "info",
    });
  }

  const currentDealFormSnapshot = useMemo(
    () =>
      buildDealFormDirtySnapshot({
        photoUri,
        photoPath,
        posterUrl,
        generatedPosterPath: imageVersionStoragePath(generatedAd),
        hintText,
        price,
        title,
        promoLine,
        posterHeadlineText,
        posterSublineText,
        ctaText,
        description,
        dealEligibility: JSON.stringify(eligibilityForm),
        maxClaims,
        cutoffMins,
        validityMode,
        startTime,
        endTime,
        daysOfWeek,
        windowStart,
        windowEnd,
        timezone,
        publishLocationIds,
        hasGeneratedAd: generatedAd != null,
        adAccepted,
      }),
    [
      photoUri,
      photoPath,
      posterUrl,
      generatedAd,
      hintText,
      price,
      title,
      promoLine,
      posterHeadlineText,
      posterSublineText,
      ctaText,
      description,
      eligibilityForm,
      maxClaims,
      cutoffMins,
      validityMode,
      startTime,
      endTime,
      daysOfWeek,
      windowStart,
      windowEnd,
      timezone,
      publishLocationIds,
      adAccepted,
    ],
  );

  useEffect(() => {
    if (dealIdFromRoute) return;
    setComposeDirtyBaseline(null);
    setPrefillBaselineReady(false);
  }, [dealIdFromRoute, templateId, hasCreatePrefillParams]);

  useEffect(() => {
    if (dealIdFromRoute || composeDirtyBaseline) return;
    if (templateId && !templateLoaded) return;
    if (hasCreatePrefillParams && !prefillBaselineReady) return;
    setComposeDirtyBaseline(currentDealFormSnapshot);
  }, [
    composeDirtyBaseline,
    currentDealFormSnapshot,
    dealIdFromRoute,
    hasCreatePrefillParams,
    prefillBaselineReady,
    templateId,
    templateLoaded,
  ]);

  useEffect(() => {
    setPublishStatus((current) => {
      if (current === "success" || current === "error") return "idle";
      return current;
    });
    setPublishStatusMessage(null);
  }, [
    title,
    promoLine,
    posterHeadlineText,
    posterSublineText,
    ctaText,
    description,
    price,
    maxClaims,
    cutoffMins,
    validityMode,
    startTime,
    endTime,
    daysOfWeek,
    windowStart,
    windowEnd,
    publishLocationIds,
    eligibilityForm,
  ]);

  const composeDirty = useMemo(
    () => isDealFormDirty(composeDirtyBaseline, currentDealFormSnapshot),
    [composeDirtyBaseline, currentDealFormSnapshot],
  );

  const editFormDirty = useMemo(
    () => isDealFormDirty(editDirtyBaseline, currentDealFormSnapshot),
    [editDirtyBaseline, currentDealFormSnapshot],
  );
  const dealDraftDirty = dealIdFromRoute ? editFormDirty : composeDirty;

  // Android hardware back bypasses usePreventRemove on this screen, so it could
  // silently drop a dirty draft. Mirror the same discard guard for the hardware
  // button; the ref lets a confirmed leave pass through usePreventRemove without
  // showing the dialog a second time.
  const hardwareBackConfirmedRef = useRef(false);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!dealDraftDirty || allowPostPublishNavigation || hardwareBackConfirmedRef.current) {
        return false;
      }
      confirm({
        iconName: "edit-off",
        title: t("dealDraft.unsavedTitle"),
        message: t("dealDraft.unsavedBody"),
        confirmLabel: t("dealDraft.discard"),
        onConfirm: () => {
          hardwareBackConfirmedRef.current = true;
          navigation.goBack();
        },
        cancelLabel: t("dealDraft.keepEditing"),
      });
      return true;
    });
    return () => subscription.remove();
  }, [dealDraftDirty, allowPostPublishNavigation, confirm, navigation, t]);

  usePreventRemove(
    dealDraftDirty && !allowPostPublishNavigation,
    useCallback(
      ({ data }) => {
        if (hardwareBackConfirmedRef.current) {
          hardwareBackConfirmedRef.current = false;
          navigation.dispatch(data.action);
          return;
        }
        confirm({
          iconName: "edit-off",
          title: t("dealDraft.unsavedTitle"),
          message: t("dealDraft.unsavedBody"),
          confirmLabel: t("dealDraft.discard"),
          onConfirm: () => navigation.dispatch(data.action),
          cancelLabel: t("dealDraft.keepEditing"),
        });
      },
      [navigation, t, confirm],
    ),
  );

  const clearAiRecoveryDraft = useCallback(async () => {
    if (!businessId) return;
    try {
      await AsyncStorage.removeItem(aiDealDraftStorageKey(businessId));
    } catch {
      /* non-fatal */
    }
  }, [businessId]);

  const persistSelectedPhotoForRecovery = useCallback(
    async (uri: string) => {
      if (!businessId) return;
      const requestId = ++photoPersistRequestIdRef.current;
      const promise = uploadDealPhoto(businessId, uri);
      photoPersistUploadRef.current = { uri, requestId, promise };
      try {
        const path = await promise;
        if (requestId !== photoPersistRequestIdRef.current) return;
        setPhotoPath(path);
        setPosterUrl((current) => current ?? buildPublicDealPhotoUrl(path));
      } catch {
        if (requestId !== photoPersistRequestIdRef.current) return;
        setBanner({ message: t("createAi.errPublishPhoto"), tone: "error" });
      }
    },
    [businessId, t],
  );

  const applyRecoveredDraft = useCallback((draft: AiDealRecoveryDraft) => {
    setPhotoUri(null);
    setPhotoPath(draft.photoPath);
    setPosterUrl(draft.posterUrl ?? (draft.photoPath ? buildPublicDealPhotoUrl(draft.photoPath) : null));
    setPhotoStepCollapsed(false);
    setPhotoTreatment(draft.photoTreatment);
    setCustomImageEditInstruction(draft.customImageEditInstruction);
    setUseCustomImageEdit(Boolean(draft.customImageEditInstruction.trim()));
    setUsePhotoAsFinal(draft.usePhotoAsFinal);
    setMerchantOriginalWarningAcknowledged(draft.merchantOriginalWarningAcknowledged);
    setCreativeFormat(draft.creativeFormat);
    setPreviewFormat(draft.previewFormat);
    setHintText(draft.hintText);
    setPrice(draft.price);
    setTitle(draft.title);
    setPromoLine(draft.promoLine);
    setPosterHeadlineText(draft.posterHeadlineText);
    setPosterSublineText(draft.posterSublineText);
    setCtaText(draft.ctaText);
    setDescription(draft.description);
    setEligibilityForm(draft.eligibilityForm);
    setMaxClaims(draft.maxClaims);
    setCutoffMins(draft.cutoffMins);
    setValidityMode(draft.validityMode);
    // F-006: a recovered one-time draft can carry a start time that has since
    // passed; clamp it up to "now" so the schedule the merchant sees is valid,
    // matching the edit-existing-deal path (publish already clamps as a net).
    // The end is resolved against that clamped start rather than restored raw:
    // the clamp alone can invert a window that was coherent at save time, and
    // the draft-level repair has already run by then. Recurring deals derive
    // their window at publish, so they pass through untouched.
    const recoveredSchedule = resolveRecoveredDealSchedule(draft);
    setStartTime(recoveredSchedule.startTime);
    setEndTime(recoveredSchedule.endTime);
    setDaysOfWeek(draft.daysOfWeek.length ? draft.daysOfWeek : [1, 2, 3, 4, 5]);
    setWindowStart(dateFromMinutes(draft.windowStartMinutes));
    setWindowEnd(dateFromMinutes(draft.windowEndMinutes));
    setTimezone(draft.timezone);
    setPublishLocationIds(draft.publishLocationIds);
    setGeneratedAd(draft.generatedAd);
    setImageVersions(() => {
      if (!draft.generatedAd) return [];
      const entry = buildImageVersionEntry(draft.generatedAd, "generated");
      return entry ? [entry] : [];
    });
    setAdAccepted(draft.adAccepted);
    setComposedStyleIndex(0);
    setComposedEditIntent(null);
    setApprovedComposedPresentationHash(null);
    setApprovedLocalizationApprovalHash(null);
    setManualDraftUnlocked(draft.manualDraftUnlocked || draft.adAccepted || Boolean(draft.generatedAd));
    clearGenerationErrorState();
    setTemplateLoaded(false);
    setEditingSourceLocale(null);
    setPrefillSourceLocale(null);
    aiDraftBaselineRef.current = null;
    lastSentPhotoTreatmentRef.current = draft.photoPath ? draft.photoTreatment : null;
    setPendingRecoveredDraft(null);
    setBanner({
      message: t("createAi.draftRecoveredBanner", { defaultValue: "Draft recovered. Review it before publishing." }),
      tone: "success",
    });
    trackEvent("owner_draft_recovered", { businessId: draft.businessId, hasGeneratedAd: draft.generatedAd != null });
  }, [t]);

  useEffect(() => {
    draftHydratedRef.current = false;
    setPendingRecoveredDraft(null);
    if (!businessId || !shouldUseDraftRecovery) {
      draftHydratedRef.current = true;
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(aiDealDraftStorageKey(businessId));
        if (cancelled) return;
        const draft = parseAiDealRecoveryDraft(raw, businessId);
        if (draft) setPendingRecoveredDraft(draft);
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) draftHydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, shouldUseDraftRecovery]);

  useEffect(() => {
    if (!businessId || !shouldUseDraftRecovery || !draftHydratedRef.current || pendingRecoveredDraft || allowPostPublishNavigation) {
      return;
    }
    const draft = buildAiDealRecoveryDraft({
      businessId,
      photoPath,
      posterUrl,
      photoTreatment,
      customImageEditInstruction,
      usePhotoAsFinal,
      merchantOriginalWarningAcknowledged,
      creativeFormat,
      previewFormat,
      hintText,
      price,
      title,
      promoLine,
      posterHeadlineText,
      posterSublineText,
      ctaText,
      description,
      eligibilityForm,
      maxClaims,
      cutoffMins,
      validityMode,
      startTime,
      endTime,
      daysOfWeek,
      windowStartMinutes: minutesFromDate(windowStart),
      windowEndMinutes: minutesFromDate(windowEnd),
      timezone,
      publishLocationIds,
      generatedAd,
      adAccepted,
      manualDraftUnlocked,
    });
    const key = aiDealDraftStorageKey(businessId);
    const timeout = setTimeout(() => {
      void (async () => {
        try {
          if (draft) {
            await AsyncStorage.setItem(key, JSON.stringify(draft));
          } else {
            await AsyncStorage.removeItem(key);
          }
        } catch {
          /* non-fatal */
        }
      })();
    }, 500);
    return () => clearTimeout(timeout);
  }, [
    businessId,
    shouldUseDraftRecovery,
    pendingRecoveredDraft,
    allowPostPublishNavigation,
    photoPath,
    posterUrl,
    photoTreatment,
    customImageEditInstruction,
    usePhotoAsFinal,
    merchantOriginalWarningAcknowledged,
    creativeFormat,
    previewFormat,
    hintText,
    price,
    title,
    promoLine,
    posterHeadlineText,
    posterSublineText,
    ctaText,
    description,
    eligibilityForm,
    maxClaims,
    cutoffMins,
    validityMode,
    startTime,
    endTime,
    daysOfWeek,
    windowStart,
    windowEnd,
    timezone,
    publishLocationIds,
    generatedAd,
    adAccepted,
    manualDraftUnlocked,
  ]);

  useEffect(() => {
    if (!dealIdFromRoute || !businessId) return;
    let cancelled = false;
    setEditDirtyBaseline(null);
    setDealLoadError(null);
    setDealEditLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("deals")
          .select("*")
          .eq("id", dealIdFromRoute)
          .eq("business_id", businessId)
          .maybeSingle();
        if (cancelled) return;
        if (error || !data) {
          setDealLoadError(t("createAi.errLoadDeal"));
          setEditingDealId(null);
          setEditingSourceLocale(null);
          return;
        }
        const row = data as Record<string, unknown>;
        const loadedSourceLocale = String(row.source_locale ?? "");
        const loadedDraftSourceLocale = supportedLocaleOrDefault(loadedSourceLocale);
        const rawLoadedTitle = typeof row.title === "string" ? row.title : "";
        const loadedTitle = getDealDisplayTitle(
          {
            title: rawLoadedTitle,
            deal_type: typeof row.deal_type === "string" ? row.deal_type : null,
            item_name: typeof row.item_description === "string" ? row.item_description : null,
            required_item_description:
              typeof row.required_item_description === "string" ? row.required_item_description : null,
            free_item_description: typeof row.free_item_description === "string" ? row.free_item_description : null,
          },
          rawLoadedTitle,
        );
        const loadedDescription = String(row.description ?? "");
        const loadedPrice = row.price != null ? String(row.price) : "";
        const rawPosterUrl = (row.poster_url as string | null) ?? null;
        const pPath = row.poster_storage_path as string | null | undefined;
        const loadedPhotoPath = pPath ? pPath : null;
        const loadedPosterUrl = loadedPhotoPath
          ? rawPosterUrl ?? buildPublicDealPhotoUrl(loadedPhotoPath)
          : rawPosterUrl;
        const loadedMaxClaims = String(row.max_claims ?? 50);
        const loadedCutoffMins = String(row.claim_cutoff_buffer_minutes ?? 15);
        const loadedValidityMode = row.is_recurring ? "recurring" : "one-time";
        const now = new Date();
        const rawLoadedStartTime = row.start_time ? new Date(String(row.start_time)) : now;
        // A resumed one-time draft can carry a start time that has since passed;
        // show "now" so the schedule the merchant sees (and publishes) is valid,
        // not stuck in the past. Recurring deals derive their start at publish.
        const loadedStartTime =
          !row.is_recurring && rawLoadedStartTime.getTime() < now.getTime() ? now : rawLoadedStartTime;
        const loadedEndTime = row.end_time ? new Date(String(row.end_time)) : new Date(now.getTime() + 2 * 60 * 60 * 1000);
        const loadedDaysOfWeek =
          Array.isArray(row.days_of_week) && row.days_of_week.length
            ? (row.days_of_week as number[])
            : [1, 2, 3, 4, 5];
        const loadedWindowStartMinutes = row.window_start_minutes != null ? Number(row.window_start_minutes) : 540;
        const loadedWindowEndMinutes = row.window_end_minutes != null ? Number(row.window_end_minutes) : 1020;
        const loadedWindowStart = dateFromMinutes(loadedWindowStartMinutes);
        const loadedWindowEnd = dateFromMinutes(loadedWindowEndMinutes);
        const tz = row.timezone;
        const loadedTimezone =
          typeof tz === "string" && tz.trim()
            ? tz.trim()
            : Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
        const lid = row.location_id;
        const loadedLocationIds = lid ? [String(lid)] : [];
        const loadedEligibilityForm = dealEligibilityFormFromDealRow(row);
        setEditingDealId(String(row.id));
        setEditingSourceLocale(supportedLocaleToAppLanguage(loadedDraftSourceLocale));
        setPrefillSourceLocale(null);
        if (localizedOwnerUiEnabled) {
          setDraftSourceLocale(loadedDraftSourceLocale);
        }
        setTitle(loadedTitle);
        setDescription(loadedDescription);
        setPromoLine("");
        setPosterHeadlineText("");
        setPosterSublineText("");
        setCtaText("");
        setPrice(loadedPrice);
        setPhotoUri(null);
        // Restore both the storage path AND a usable preview URL — without this the photo
        // selector renders empty when editing an existing deal that has a poster.
        setPhotoPath(loadedPhotoPath);
        setPosterUrl(loadedPosterUrl);
        setPhotoStepCollapsed(false);
        setUsePhotoAsFinal(Boolean(loadedPhotoPath || loadedPosterUrl));
        setMerchantOriginalWarningAcknowledged(false);
        setMaxClaims(loadedMaxClaims);
        setCutoffMins(loadedCutoffMins);
        setValidityMode(loadedValidityMode);
        setStartTime(loadedStartTime);
        setEndTime(loadedEndTime);
        setDaysOfWeek(loadedDaysOfWeek);
        setWindowStart(loadedWindowStart);
        setWindowEnd(loadedWindowEnd);
        setTimezone(loadedTimezone);
        setPublishLocationIds(loadedLocationIds);
        setEligibilityForm(loadedEligibilityForm);
        setManualDraftUnlocked(true);
        setGeneratedAd(null);
        setImageVersions([]);
        setAdAccepted(false);
        setApprovedComposedPresentationHash(null);
        setApprovedLocalizationApprovalHash(null);
        aiDraftBaselineRef.current = null;
        clearGenerationErrorState();
        setTemplateLoaded(false);
        setEditDirtyBaseline(
          buildDealFormDirtySnapshot({
            photoUri: null,
            photoPath: loadedPhotoPath,
            posterUrl: loadedPosterUrl,
            generatedPosterPath: null,
            hintText: "",
            price: loadedPrice,
            title: loadedTitle,
            promoLine: "",
            posterHeadlineText: "",
            posterSublineText: "",
            ctaText: "",
            description: loadedDescription,
            dealEligibility: JSON.stringify(loadedEligibilityForm),
            maxClaims: loadedMaxClaims,
            cutoffMins: loadedCutoffMins,
            validityMode: loadedValidityMode,
            startTime: loadedStartTime,
            endTime: loadedEndTime,
            daysOfWeek: loadedDaysOfWeek,
            windowStartMinutes: loadedWindowStartMinutes,
            windowEndMinutes: loadedWindowEndMinutes,
            timezone: loadedTimezone,
            publishLocationIds: loadedLocationIds,
            hasGeneratedAd: false,
            adAccepted: false,
          }),
        );
      } finally {
        if (!cancelled) setDealEditLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dealIdFromRoute, businessId, dealLoadNonce, localizedOwnerUiEnabled, t]);

  useEffect(() => {
    if (!dealIdFromRoute) setEditDirtyBaseline(null);
  }, [dealIdFromRoute]);

  useEffect(() => {
    if (dealIdFromRoute || !templateId || !businessId) return;
    let cancelled = false;
    setTemplateLoaded(false);
    (async () => {
      const { data, error } = await supabase
        .from("deal_templates")
        .select("*")
        .eq("id", templateId)
        .eq("business_id", businessId)
        .single();
      if (cancelled) return;
      if (!error && data) {
        const row = data as TemplateRow;
        setEditingSourceLocale(null);
        setPrefillSourceLocale(null);
        setTitle(getDealDisplayTitle({ title: row.title }, row.title));
        setDescription(row.description ?? "");
        setPromoLine("");
        setPosterHeadlineText("");
        setPosterSublineText("");
        setCtaText("");
        setPrice(row.price != null ? String(row.price) : "");
        setEligibilityForm(createDefaultDealEligibilityFormState());
        const templatePhotoPath = row.poster_storage_path ?? extractDealPhotoStoragePath(row.poster_url);
        const templatePosterUrl = templatePhotoPath
          ? row.poster_url ?? buildPublicDealPhotoUrl(templatePhotoPath)
          : row.poster_url ?? null;
        setPhotoUri(null);
        setPhotoPath(templatePhotoPath ?? null);
        setPosterUrl(templatePosterUrl);
        setPhotoStepCollapsed(false);
        setUsePhotoAsFinal(Boolean(templatePhotoPath || templatePosterUrl));
        setMerchantOriginalWarningAcknowledged(false);
        setMaxClaims(String(row.max_claims ?? 10));
        setCutoffMins(String(row.claim_cutoff_buffer_minutes ?? 15));
        setValidityMode(row.is_recurring ? "recurring" : "one-time");
        setDaysOfWeek(row.days_of_week ?? [1, 2, 3, 4, 5]);
        if (row.window_start_minutes != null) {
          const d = new Date();
          d.setHours(Math.floor(row.window_start_minutes / 60), row.window_start_minutes % 60, 0, 0);
          setWindowStart(d);
        }
        if (row.window_end_minutes != null) {
          const d = new Date();
          d.setHours(Math.floor(row.window_end_minutes / 60), row.window_end_minutes % 60, 0, 0);
          setWindowEnd(d);
        }
        if (typeof row.timezone === "string" && row.timezone.trim()) {
          setTimezone(row.timezone.trim());
        }
        setTemplateLoaded(true);
        setGeneratedAd(null);
        setImageVersions([]);
        setAdAccepted(false);
        setApprovedComposedPresentationHash(null);
        setApprovedLocalizationApprovalHash(null);
        aiDraftBaselineRef.current = null;
        setManualDraftUnlocked(false);
        clearGenerationErrorState();
      }
    })();
    return () => { cancelled = true; };
  }, [dealIdFromRoute, templateId, businessId]);

  useEffect(() => {
    if (templateId || dealIdFromRoute) return;
    const g = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
    const pt = g(params.prefillTitle).trim();
    const pp = g(params.prefillPromoLine).trim();
    const pc = g(params.prefillCta).trim();
    const pd = g(params.prefillDescription).trim();
    const ph = g(params.prefillHint).trim();
    const price0 = g(params.prefillPrice).trim();
    const posterPath = g(params.prefillPosterPath).trim();
    const posterUrlParam = g(params.prefillPosterUrl).trim();
    const prefillDealEligibility = g(params.prefillDealEligibility).trim();
    const fromAi = g(params.fromAiCompose);
    const fromMenu = g(params.fromMenuOffer);
    const fromReuse = g(params.fromReuse);
    const fromHub = g(params.fromCreateHub);
    const sourceFromRoute = g(params.prefillSourceLocale);
    const prefillDraftSourceLocale = sourceFromRoute ? supportedLocaleOrDefault(sourceFromRoute) : null;
    setEditingSourceLocale(null);
    setPrefillSourceLocale(prefillDraftSourceLocale ? supportedLocaleToAppLanguage(prefillDraftSourceLocale) : null);
    if (localizedOwnerUiEnabled && prefillDraftSourceLocale) {
      setDraftSourceLocale(prefillDraftSourceLocale);
    }
    const pl = g(params.prefillLocationId).trim();
    const pe = g(params.prefillExtraLocationIds).trim();
    const locIds = [pl, ...pe.split(",").map((s) => s.trim()).filter(Boolean)].filter(Boolean);
    if (locIds.length) setPublishLocationIds(locIds);
    const hasSchedulePrefill =
      g(params.prefillIsRecurring) ||
      g(params.prefillDaysOfWeek) ||
      g(params.prefillStartTime) ||
      g(params.prefillEndTime) ||
      g(params.prefillMaxClaims);
    if (!pt && !pp && !pc && !pd && !ph && !price0 && !posterPath && !posterUrlParam && !prefillDealEligibility && locIds.length === 0 && !hasSchedulePrefill) {
      setPrefillBaselineReady(true);
      return;
    }

    if (pt) setTitle((prev) => prev || pt);
    if (pp) setPromoLine((prev) => prev || pp);
    if (pc) setCtaText((prev) => prev || pc);
    if (pd) setDescription((prev) => prev || pd);
    if (ph) {
      setHintText((prev) => prev || ph);
      applyInferredEligibilityFromHint(ph);
    }
    if (price0) setPrice((prev) => prev || price0);
    if (posterPath) {
      setPhotoPath((prev) => prev || posterPath);
      setPosterUrl((prev) => prev || buildPublicDealPhotoUrl(posterPath));
      setUsePhotoAsFinal(true);
      setMerchantOriginalWarningAcknowledged(false);
    } else if (posterUrlParam) {
      setPosterUrl((prev) => prev || posterUrlParam);
      setUsePhotoAsFinal(true);
      setMerchantOriginalWarningAcknowledged(false);
    }
    if (prefillDealEligibility) {
      try {
        const parsed = JSON.parse(prefillDealEligibility) as Partial<DealEligibilityFormState>;
        const parsedDealType = parsed?.dealType;
        if (
          parsedDealType === "BUY_ONE_GET_ONE_FREE" ||
          parsedDealType === "BUY_ONE_GET_SOMETHING_FREE" ||
          parsedDealType === "PERCENT_OFF_SINGLE_ITEM"
        ) {
          setEligibilityForm((prev) => ({
            dealType: parsedDealType,
            discountPercent: typeof parsed.discountPercent === "string" ? parsed.discountPercent : prev.discountPercent,
            itemDescription: typeof parsed.itemDescription === "string" ? parsed.itemDescription : prev.itemDescription,
            itemRetailValue: typeof parsed.itemRetailValue === "string" ? parsed.itemRetailValue : prev.itemRetailValue,
            requiredItemDescription:
              typeof parsed.requiredItemDescription === "string"
                ? parsed.requiredItemDescription
                : prev.requiredItemDescription,
            requiredItemRetailValue:
              typeof parsed.requiredItemRetailValue === "string"
                ? parsed.requiredItemRetailValue
                : prev.requiredItemRetailValue,
            freeItemDescription:
              typeof parsed.freeItemDescription === "string" ? parsed.freeItemDescription : prev.freeItemDescription,
            freeItemRetailValue:
              typeof parsed.freeItemRetailValue === "string" ? parsed.freeItemRetailValue : prev.freeItemRetailValue,
          }));
        }
      } catch {
        /* ignore malformed route state */
      }
    }

    // Schedule prefill (from "Run again" / duplicate)
    if (g(params.prefillIsRecurring) === "1") setValidityMode("recurring");
    const daysStr = g(params.prefillDaysOfWeek).trim();
    if (daysStr) setDaysOfWeek(daysStr.split(",").map(Number).filter((n) => n >= 1 && n <= 7));
    const wsm = g(params.prefillWindowStartMin).trim();
    if (wsm) { const m = Number(wsm); if (Number.isFinite(m)) { const d = new Date(); d.setHours(Math.floor(m / 60), m % 60, 0, 0); setWindowStart(d); } }
    const wem = g(params.prefillWindowEndMin).trim();
    if (wem) { const m = Number(wem); if (Number.isFinite(m)) { const d = new Date(); d.setHours(Math.floor(m / 60), m % 60, 0, 0); setWindowEnd(d); } }
    const tz = g(params.prefillTimezone).trim();
    if (tz) setTimezone(tz);
    const pst = g(params.prefillStartTime).trim();
    if (pst) {
      const parsed = new Date(pst);
      if (Number.isFinite(parsed.getTime())) setStartTime(parsed);
    }
    const pet = g(params.prefillEndTime).trim();
    if (pet) {
      const parsed = new Date(pet);
      if (Number.isFinite(parsed.getTime())) setEndTime(parsed);
    }
    const mc = g(params.prefillMaxClaims).trim();
    if (mc) setMaxClaims(mc);
    const cf = g(params.prefillCutoffMins).trim();
    if (cf) setCutoffMins(cf);

    if (fromAi === "1" && (pt || pp || pc || pd || ph || posterPath)) {
      setBanner({ message: t("createQuick.prefillFromAiCompose"), tone: "success" });
    } else if (fromMenu === "1" && (pt || pp || pc || pd || ph)) {
      setBanner({ message: t("createQuick.prefillFromMenuOffer"), tone: "success" });
    } else if (fromReuse === "1" && (pt || pd || ph || price0 || posterPath || posterUrlParam)) {
      setBanner({ message: t("createAi.prefillFromReuse"), tone: "success" });
      setManualDraftUnlocked(true);
    } else if (fromHub === "1" && (pt || ph)) {
      setBanner({ message: t("createAi.prefillFromHub"), tone: "success" });
      setManualDraftUnlocked(true);
    }
    setPrefillBaselineReady(true);
  }, [
    templateId, params.prefillTitle, params.prefillPromoLine, params.prefillCta,
    params.prefillDescription, params.prefillHint, params.prefillPrice, params.prefillPosterPath, params.prefillPosterUrl,
    params.prefillDealEligibility,
    params.fromAiCompose, params.fromMenuOffer, params.fromReuse, params.fromCreateHub,
    params.prefillLocationId, params.prefillExtraLocationIds, params.prefillSourceLocale, dealIdFromRoute, localizedOwnerUiEnabled, t,
    params.prefillIsRecurring, params.prefillDaysOfWeek, params.prefillWindowStartMin,
    params.prefillWindowEndMin, params.prefillTimezone, params.prefillStartTime, params.prefillEndTime,
    params.prefillMaxClaims, params.prefillCutoffMins,
  ]);

  useEffect(() => {
    const fromMenu = String(params.fromMenuOffer ?? "") === "1";
    if (!fromMenu || menuOfferScrollDoneRef.current || scheduleSectionY == null) return;
    menuOfferScrollDoneRef.current = true;
    const tid = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, scheduleSectionY - 16), animated: true });
    }, 400);
    return () => clearTimeout(tid);
  }, [params.fromMenuOffer, scheduleSectionY]);

  useEffect(() => {
    const fromReuse = String(params.fromReuse ?? "") === "1";
    if (!fromReuse || reuseScrollDoneRef.current || scheduleSectionY == null || !showDraftEditor) return;
    reuseScrollDoneRef.current = true;
    const tid = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, scheduleSectionY - 16), animated: true });
    }, 400);
    return () => clearTimeout(tid);
  }, [params.fromReuse, scheduleSectionY, showDraftEditor]);

  /**
   * Reset everything generated from the previous photo/offer combination. Called whenever
   * the user changes the source inputs (new photo, new treatment) so we never publish a stale
   * AI-generated poster paired with a different photo.
   */
  function resetGenerationState() {
    setGeneratedAd(null);
    setImageVersions([]);
    setPosterHeadlineText("");
    setPosterSublineText("");
    setAdAccepted(false);
    setRevisionsUsed(0);
    setRevisionFeedback("");
    setComposedStyleIndex(0);
    setComposedEditIntent(null);
    setApprovedComposedPresentationHash(null);
    setApprovedLocalizationApprovalHash(null);
    aiDraftBaselineRef.current = null;
    lastSentPhotoTreatmentRef.current = null;
    adGenerationStartedAtRef.current = null;
    composedPreviewShownAtRef.current = null;
    lastComposedPreviewTelemetryHashRef.current = null;
    aiRequestGroupIdRef.current = createAiRequestGroupId();
    generationRequestIdRef.current += 1;
    clearGenerationErrorState();
  }

  function buildCreativeRequestPayload() {
    return {
      requested_format: creativeFormat,
      poster: {
        enabled: creativeFormat === "poster_v1",
        style: FIXED_POSTER_TEMPLATE_ID,
        aspect_ratio: "4:5" as const,
        text_policy: {
          no_app_brand_token: true,
          no_cta: true,
          no_scarcity: true,
          no_mutable_live_facts: true,
          image_text_free: true,
          center_text: true,
        },
      },
    };
  }

  function selectCreativeFormat(nextFormat: CreativeFormat) {
    if (nextFormat === creativeFormat) return;
    setCreativeFormat(nextFormat);
    setPreviewFormat(nextFormat);
    setPublishStatus("idle");
    setPublishStatusMessage(null);
    setApprovedComposedPresentationHash(null);
    setApprovedLocalizationApprovalHash(null);
    if (generatedAd || adAccepted) {
      setAdAccepted(false);
      setComposedStyleIndex(0);
      setComposedEditIntent(null);
      aiDraftBaselineRef.current = null;
    }
  }

  useEffect(() => {
    if (!approvedComposedPresentationHash && approvedLocalizationApprovalHash) {
      setApprovedLocalizationApprovalHash(null);
    }
  }, [approvedComposedPresentationHash, approvedLocalizationApprovalHash]);

  async function pickPhotoFromLibrary() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      setPosterUrl(null);
      setPhotoPath(null);
      setPhotoStepCollapsed(false);
      setUsePhotoAsFinal(false);
      setMerchantOriginalWarningAcknowledged(false);
      resetGenerationState();
      setBanner(null);
      void persistSelectedPhotoForRecovery(uri);
    } catch (err) {
      // Log the underlying reason so a still-failing picker (e.g. a missing
      // media-read permission on Android <=12) is diagnosable from device logs;
      // the owner-facing banner stays friendly.
      console.warn("[create-ai] photo picker failed:", err instanceof Error ? err.message : err);
      setBanner({ message: t("createAi.errPhotoPicker"), tone: "error" });
    }
  }

  async function takePhoto() {
    const perm = permission?.status === "granted" ? permission : await requestPermission();
    if (!perm?.granted) {
      setBanner({ message: t("createAi.errCameraRequired"), tone: "error" });
      return;
    }
    setShowCamera(true);
  }

  async function capturePhoto() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
    if (photo?.uri) {
      setPhotoUri(photo.uri);
      setPosterUrl(null);
      setPhotoPath(null);
      setPhotoStepCollapsed(false);
      setUsePhotoAsFinal(false);
      setMerchantOriginalWarningAcknowledged(false);
      resetGenerationState();
      setShowCamera(false);
      void persistSelectedPhotoForRecovery(photo.uri);
    }
  }

  async function startRecording() {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        setBanner({ message: t("createAi.errMicPermission"), tone: "error" });
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
      setBanner(null);
    } catch {
      setBanner({ message: t("createAi.errRecordingStart"), tone: "error" });
    }
  }

  async function stopRecordingAndTranscribe() {
    if (!businessId || !isRecording) return;
    setIsRecording(false);
    setTranscribing(true);
    setBanner(null);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("no_uri");
      const b64 = await fileUriToBase64(uri);
      const { transcript } = await aiComposeOfferTranscribe({
        business_id: businessId,
        audio_base64: b64,
      });
      if (transcript) {
        const nextHintText = hintText.trim() ? `${hintText.trim()} ${transcript}` : transcript;
        setHintText(nextHintText);
        applyInferredEligibilityFromHint(nextHintText);
        setBanner({ message: t("createAi.transcribeDone"), tone: "success" });
      } else {
        setBanner({ message: t("createAi.transcribeEmpty"), tone: "info" });
      }
    } catch (e: unknown) {
      const code = getErrorCode(e);
      if (code === "COOLDOWN_ACTIVE") {
        setBanner({ message: t("createAi.transcribeCooldown"), tone: "info" });
      } else {
        // Don't surface raw internal codes (e.g. "no_uri") or Supabase storage errors —
        // a non-technical owner can't act on those. Always show the translated fallback.
        setBanner({ message: t("createAi.transcribeFailed"), tone: "error" });
      }
    } finally {
      setTranscribing(false);
    }
  }

  function validateInputs(): boolean {
    const maxClaimsNum = Number(maxClaims);
    const cutoffNum = Number(cutoffMins);
    if (Number.isNaN(maxClaimsNum) || maxClaimsNum <= 0) {
      setBanner({ message: t("createAi.errMaxClaims"), tone: "error" });
      return false;
    }
    if (Number.isNaN(cutoffNum) || cutoffNum < 0) {
      setBanner({ message: t("createAi.errCutoff"), tone: "error" });
      return false;
    }
    if (validityMode === "one-time") {
      if (endTime <= startTime) {
        setBanner({ message: t("createAi.errEndAfterStart"), tone: "error" });
        return false;
      }
      const durationMinutes = Math.floor((endTime.getTime() - startTime.getTime()) / 60000);
      if (dealDurationExceedsMax(durationMinutes)) {
        setBanner({
          message: t("createAi.errMaxDuration", {
            hours: MAX_DEAL_DURATION_MINUTES / 60,
            defaultValue: "Deals can run for up to {{hours}} hours at a time. Shorten the end time.",
          }),
          tone: "error",
        });
        return false;
      }
      if (cutoffNum >= durationMinutes) {
        setBanner({ message: t("createQuick.errCutoffDuration", { defaultValue: CUTOFF_DURATION_MESSAGE }), tone: "error" });
        return false;
      }
    } else {
      if (daysOfWeek.length === 0) {
        setBanner({ message: t("createAi.errRecurringDay"), tone: "error" });
        return false;
      }
      const windowStartMinutes = minutesFromDate(windowStart);
      const windowEndMinutes = minutesFromDate(windowEnd);
      if (windowStartMinutes >= windowEndMinutes) {
        setBanner({ message: t("createAi.errRecurringWindow"), tone: "error" });
        return false;
      }
      const windowDurationMinutes = windowEndMinutes - windowStartMinutes;
      if (dealDurationExceedsMax(windowDurationMinutes)) {
        setBanner({
          message: t("createAi.errMaxDuration", {
            hours: MAX_DEAL_DURATION_MINUTES / 60,
            defaultValue: "Deals can run for up to {{hours}} hours at a time. Shorten the end time.",
          }),
          tone: "error",
        });
        return false;
      }
      if (cutoffNum >= windowDurationMinutes) {
        setBanner({ message: t("createQuick.errCutoffDuration", { defaultValue: CUTOFF_DURATION_MESSAGE }), tone: "error" });
        return false;
      }
    }
    return true;
  }

  async function ensureUploadedPhoto() {
    if (photoPath) return photoPath;
    if (!photoUri || !businessId) return null;
    const pendingUpload = photoPersistUploadRef.current;
    if (pendingUpload?.uri === photoUri) {
      const pendingPath = await pendingUpload.promise;
      if (pendingUpload.requestId !== photoPersistRequestIdRef.current) return null;
      setPhotoPath(pendingPath);
      setPosterUrl((current) => current ?? buildPublicDealPhotoUrl(pendingPath));
      return pendingPath;
    }
    const path = await uploadDealPhoto(businessId, photoUri);
    setPhotoPath(path);
    return path;
  }

  async function ensurePosterUrl(path: string | null) {
    if (posterUrl) return posterUrl;
    if (!path) return null;
    const { data, error } = await supabase.storage
      .from("deal-photos")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (error) throw error;
    setPosterUrl(data?.signedUrl ?? null);
    return data?.signedUrl ?? null;
  }

  function applyAdToDraft(ad: GeneratedAd) {
    const draft = adToDealDraft(ad, hintText);
    setTitle(draft.title);
    setPromoLine(draft.promo_line);
    setPosterHeadlineText(ad.poster?.copy?.headline ?? "");
    setPosterSublineText(ad.poster?.copy?.subline ?? "");
    setCtaText(draft.cta_text);
    setDescription(draft.offer_details);
    aiDraftBaselineRef.current = {
      title: draft.title,
      promo_line: draft.promo_line,
      cta_text: draft.cta_text,
      description: draft.offer_details,
    };
  }

  function imageFailureTelemetry(err: unknown) {
    const body = getFunctionErrorBody(err);
    const imageFailure = body?.image_failure;
    if (!imageFailure || typeof imageFailure !== "object" || Array.isArray(imageFailure)) return {};
    const failure = imageFailure as Record<string, unknown>;
    const attempts = Array.isArray(failure.attempts) ? failure.attempts : [];
    const attemptCodes = attempts
      .slice(-6)
      .map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return "";
        const attempt = value as Record<string, unknown>;
        const provider = typeof attempt.provider === "string" ? attempt.provider : "unknown";
        const endpoint = typeof attempt.endpoint === "string" ? attempt.endpoint : "unknown";
        const errorCode =
          typeof attempt.error_code === "string" && attempt.error_code.length > 0
            ? attempt.error_code
            : attempt.success === true
            ? "success"
            : "unknown";
        return `${provider}:${endpoint}:${errorCode}`;
      })
      .filter(Boolean)
      .join("|")
      .slice(0, 220);
    const qa = failure.qa && typeof failure.qa === "object" && !Array.isArray(failure.qa)
      ? (failure.qa as Record<string, unknown>)
      : {};
    return {
      image_failure_source: typeof failure.source === "string" ? failure.source : null,
      image_failure_provider: typeof failure.provider === "string" ? failure.provider : null,
      image_failure_model: typeof failure.model === "string" ? failure.model : null,
      image_failure_attempts: attemptCodes || null,
      image_failure_qa_decision: typeof qa.decision === "string" ? qa.decision : null,
      image_failure_qa_unavailable: typeof qa.unavailable === "boolean" ? qa.unavailable : null,
    };
  }

  function friendlyGenerationError(raw: string, code?: string): string {
    // Map each known failure to a DISTINCT, truthful message so the owner (and a
    // developer reading a screenshot) can tell cooldown from monthly cap from a
    // copy failure. Server codes arrive via getErrorCode; codeless cases (403
    // ownership, timeouts) are matched on the parsed message text.
    if (code === "OPENAI_KEY_MISSING") return t("createAi.friendlyOpenaiConfig");
    if (code === "MONTHLY_LIMIT") return t("createAi.friendlyMonthlyLimit");
    // Cooldown is handled by the live countdown on the Generate button, not this
    // text path; return a localized caption so no residual caller shows the raw
    // English server string ("Please wait 12s…").
    if (code === "COOLDOWN_ACTIVE") return t("createAi.cooldownCaption");
    if (code === "REVISION_LIMIT") return t("createAi.errRegenClientLimit");
    if (code === "COPY_FAILED") return t("createAi.friendlyCopyFailed");
    const lower = raw.toLowerCase();
    if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("abort")) {
      return t("createAi.friendlyTimeout");
    }
    if (lower.includes("do not own") || lower.includes("don’t own") || lower.includes("don't own")) {
      return t("createAi.friendlyOwnership");
    }
    if (lower.includes("unauthorized") || lower.includes("log in")) {
      return t("createAi.friendlySession");
    }
    if (lower.includes("photo") || lower.includes("image")) {
      // Only blame the merchant's photo when they actually attached one. With no
      // photo attached, a "photo"/"image" failure is our image backend, not their
      // upload — don't tell the owner to fix a photo that doesn't exist.
      return photoUri || photoPath
        ? t("createAi.friendlyPhoto")
        : t("createAi.errImageServiceDown");
    }
    return t("createAi.friendlyGenerationLongError");
  }

  function publishErrorDetail(err: unknown): string | null {
    const raw = err instanceof Error ? err.message : String(err);
    const lower = raw.toLowerCase();
    const code = getErrorCode(err);
    const reasonCodes = publishReasonCodes(err);

    if (code === "INVALID_OFFER_DEFINITION") return t("createAi.errPublishInvalidOfferDefinition");
    if (code === "INVALID_AD_SPEC") {
      if (reasonCodes.some((reason) => reason.startsWith("POSTER_") || reason === "INVALID_POSTER_SPEC")) {
        return t("createAi.errPublishInvalidPosterSpec", {
          defaultValue: "The poster ad preview did not match the locked deal terms. Switch to Standard card or generate the poster again.",
        });
      }
      if (reasonCodes.includes("MISSING_COMPOSED_CARD_APPROVAL")) {
        return t("createAi.errPublishMissingPreviewApproval", {
          defaultValue: "Approve the exact ad preview again before publishing.",
        });
      }
      if (reasonCodes.includes("MISSING_LOCALIZATION_APPROVAL")) {
        return t("createAi.errPublishMissingLocalizationApproval", {
          defaultValue: "Approve the exact multilingual preview again before publishing.",
        });
      }
      return t("createAi.errPublishInvalidAdSpec");
    }
    if (code === "INVALID_DEAL_WINDOW") return t("createAi.errEndTimePassed");
    if (code === "PUBLISH_OFFER_VERSION_UNAVAILABLE") return t("createAi.errPublishVersionUnavailable");
    // The publish endpoint never ran (Edge Runtime bundle/boot/worker failure).
    // Checked by code first, then by message for the publish steps that do not
    // route through publishOfferVersionedDeal.
    if (code === PUBLISH_SERVICE_UNAVAILABLE_CODE || isEdgeRuntimeFailureMessage(raw)) {
      return t("createAi.errPublishServiceUnavailable", {
        defaultValue: "Publishing is temporarily unavailable. Wait a moment and try again.",
      });
    }
    if (code === "LOCATION_BILLING_SUSPENDED") return t("createAi.errPublishBillingSuspended");
    if (code === "BUSINESS_LOCATION_VERIFICATION_REQUIRED") return t("createAi.errPublishVerificationRequired");
    // A profile-review hold is NOT an access/billing problem — a sensitive field
    // (address or phone) was changed and is pending review. Point the owner at the
    // fields instead of the generic "access does not allow publishing" copy. Other
    // capability reasons keep today's message (fall through).
    if (code === "BUSINESS_PUBLISH_CAPABILITY_REQUIRED" && publishCapabilityReasonCode(err) === "profile_review_required") {
      return t("createAi.errPublishProfileReviewRequired", {
        defaultValue:
          "Your business address or phone number was changed and needs a quick review before you can publish. Open Business Setup, confirm those details, and save.",
      });
    }

    if (
      lower.includes("must be at least 40") ||
      lower.includes("give something free") ||
      lower.includes("strong deal")
    ) {
      return t("dealQuality.strongDealMessage");
    }
    if (
      lower.includes("row-level security") ||
      lower.includes("rls") ||
      lower.includes("policy") ||
      lower.includes("permission denied") ||
      lower.includes("access denied") ||
      lower.includes("unauthorized") ||
      lower.includes("do not own") ||
      lower.includes("not found for owner")
    ) {
      return t("createAi.errPublishPermission");
    }
    if (lower.includes("duplicate") || lower.includes("unique") || lower.includes("already exists")) {
      return t("createAi.errPublishDuplicate");
    }
    if (lower.includes("storage") || lower.includes("upload") || lower.includes("photo")) {
      return t("createAi.errPublishPhoto");
    }
    if (lower.includes("network") || lower.includes("fetch") || lower.includes("timed out") || lower.includes("timeout")) {
      return t("createAi.errPublishNetwork");
    }
    if (lower.includes("translation") || lower.includes("translate")) {
      return t("createAi.errPublishTranslation");
    }
    if (lower.includes("invalid offer definition")) return t("createAi.errPublishInvalidOfferDefinition");
    if (lower.includes("invalid ad spec")) return t("createAi.errPublishInvalidAdSpec");
    if (lower.includes("offer version") || lower.includes("versioned publish")) {
      return t("createAi.errPublishVersionUnavailable");
    }
    if (lower.includes("billing") || lower.includes("suspended")) return t("createAi.errPublishBillingSuspended");
    if (lower.includes("verified") || lower.includes("verification")) return t("createAi.errPublishVerificationRequired");

    // Nothing above recognized this error. Only echo the server's own wording
    // when it carried a structured error_code, which means our edge function
    // body produced it deliberately. Anything else is platform/runtime detail
    // (bundle-load failures, stack traces, driver errors) that a merchant can
    // neither read nor act on, so it falls back to the generic banner.
    if (!code) return null;

    const cleaned = raw
      .replace(/^error:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return null;
    const generic = [
      "server error",
      "publish failed",
      "could not publish this offer.",
      "couldn't publish this deal.",
      "unexpected response from publish-offer-version.",
    ];
    if (generic.includes(cleaned.toLowerCase())) return null;
    return cleaned.length > 180 ? `${cleaned.slice(0, 177).trim()}...` : cleaned;
  }

  function publishReasonCodes(err: unknown): string[] {
    return Array.isArray((err as { reasonCodes?: unknown } | null)?.reasonCodes)
      ? ((err as { reasonCodes?: unknown[] }).reasonCodes ?? []).filter(
          (reason): reason is string => typeof reason === "string" && reason.trim().length > 0,
        )
      : [];
  }

  // Singular capability reason (e.g. "profile_review_required") threaded from the
  // publish edge function's response body via lib/offer-version-publish.ts.
  function publishCapabilityReasonCode(err: unknown): string | undefined {
    const reason = (err as { reasonCode?: unknown } | null)?.reasonCode;
    return typeof reason === "string" && reason.trim().length > 0 ? reason : undefined;
  }

  function isPosterPublishSpecError(err: unknown): boolean {
    if (getErrorCode(err) !== "INVALID_AD_SPEC") return false;
    return publishReasonCodes(err).some(
      (reason) => reason.startsWith("POSTER_") || reason === "INVALID_POSTER_SPEC",
    );
  }

  function cancelGeneration() {
    // Bumping the request id makes the in-flight result a no-op when it returns,
    // and we re-enable the UI immediately so the user is not stuck on a spinner.
    generationRequestIdRef.current += 1;
    setGenerating(false);
    setRevising(false);
    setBanner(null);
    clearGenerationErrorState();
  }

  function blockIneligibleOffer(attemptedAction: string): boolean {
    if (eligibilityResult.eligible) return false;
    const message =
      eligibilityResult.message ??
      t("dealEligibility.invalidBody", {
        defaultValue: "Twofer deals must be free-item offers or at least 40% off one single item.",
      });
    setBanner({ message, tone: "error" });
    trackEvent("deal_validation_failed", {
      businessId,
      attemptedDealType: eligibilityForm.dealType,
      discountPercent: Number(eligibilityForm.discountPercent) || null,
      customerValuePercent: eligibilityResult.customerValuePercent ?? null,
      reasonCode: eligibilityResult.reasonCode ?? null,
      attemptedAction,
      source: "create_ai",
    });
    return true;
  }

  async function generateAd() {
    if (cooldownActive) return;
    if (!validateInputs()) return;
    if (!businessId) {
      setBanner({ message: t("createAi.errCreateBusinessFirst"), tone: "error" });
      return;
    }
    const priceNumPreCheck = parseOptionalPriceInput(price);
    if (priceNumPreCheck !== null && Number.isNaN(priceNumPreCheck)) {
      setBanner({ message: t("createAi.errPriceNumber"), tone: "error" });
      return;
    }
    if (blockIneligibleOffer("generate_ad")) return;
    const customEditText = cleanCustomImageEditInstruction(customImageEditInstruction);
    if (selectedPhotoUri && !usePhotoAsFinal && useCustomImageEdit && !customEditText) {
      setBanner({ message: t("createAi.errCustomImageEditRequired"), tone: "info" });
      return;
    }

    trackEvent(AiAdsEvents.GENERATE_TAPPED, { screen: "create_ai" });
    setGenerating(true);
    setBanner(null);
    clearGenerationErrorState();
    resetGenerationState();
    adGenerationStartedAtRef.current = Date.now();
    composedPreviewShownAtRef.current = null;
    lastComposedPreviewTelemetryHashRef.current = null;
    const requestId = ++generationRequestIdRef.current;

    try {
      let path: string | null;
      try {
        path = await ensureUploadedPhoto();
        if (path) await ensurePosterUrl(path);
        if (requestId !== generationRequestIdRef.current) return;
      } catch {
        // Upload errors from Supabase storage have ugly messages ("JWT expired",
        // "duplicate key", etc.). A non-technical owner can't act on those — give
        // them the friendly "try a different photo" copy that already exists.
        if (requestId !== generationRequestIdRef.current) return;
        const friendly = t("createAi.errPublishPhoto");
        setGenerationFailureState(friendly, "input_or_offer_blocked");
        setBanner({ message: friendly, tone: "error" });
        return;
      }
      // Snapshot the image intent we're about to send so revisions reference the same one
      // even if the user changes the selector mid-flight.
      const sentSourceMode = imageSourceModeForPhotoChoice(path, usePhotoAsFinal);
      const sentEditMode = sentSourceMode === "merchant_ai_edit"
        ? useCustomImageEdit
          ? "custom"
          : imageEditModeForTreatment(photoTreatment)
        : "none";
      const sentTreatment = sentSourceMode === "merchant_ai_edit"
        ? useCustomImageEdit ? "studiopolish" : photoTreatment
        : null;
      const maxClaimsNum = Number(maxClaims);

      const { ad, quota: nextQuota } = await aiGenerateAd({
        business_id: businessId,
        hint_text: hintText.trim(),
        business_context: businessContextForAi,
        output_language: dealOutputLang,
        request_group_id: aiRequestGroupIdRef.current,
        deal_eligibility: eligibilityInput,
        image_source_mode: sentSourceMode,
        image_edit_mode: sentEditMode,
        ...(sentEditMode === "custom" ? { custom_image_edit_instruction: customEditText } : {}),
        ...(path ? { photo_path: path } : {}),
        ...(sentTreatment ? { photo_treatment: sentTreatment } : {}),
        ...(offerScheduleSummary ? { offer_schedule_summary: offerScheduleSummary } : {}),
        ...(Number.isFinite(maxClaimsNum) && maxClaimsNum > 0 ? { quantity_limit: maxClaimsNum } : {}),
        redemption_limit: redemptionLimitSummary,
        creative: buildCreativeRequestPayload(),
      });
      // Stale-result guard: discard if user kicked off another generation after this one.
      if (requestId !== generationRequestIdRef.current) return;
      lastSentPhotoTreatmentRef.current = sentTreatment;
      let normalizedAd = normalizeGeneratedAdDisplayCopy(ad);
      if (!imageVersionStoragePath(normalizedAd) && path) {
        const originalPhotoAd = buildOriginalPhotoVersionAd(normalizedAd, path);
        if (originalPhotoAd) {
          normalizedAd = originalPhotoAd;
          setUsePhotoAsFinal(true);
          setMerchantOriginalWarningAcknowledged(false);
        }
      }
      if (!imageVersionStoragePath(normalizedAd)) {
        const friendly = t("createAi.errImageGenerationNoImage", {
          defaultValue: "AI couldn't create an image for this ad. Add a photo or try again before using it.",
        });
        setGenerationFailureState(
          friendly,
          hasFallbackTemplateSource() ? "ai_failed_fallback_available" : "ai_failed_no_fallback",
        );
        setBanner({ message: friendly, tone: "error" });
        trackEvent(AiAdsEvents.GENERATION_FAILED, {
          screen: "create_ai",
          regeneration_attempt: 0,
          error_code: "NO_IMAGE_RETURNED",
        });
        return;
      }
      if (sentSourceMode === "merchant_original" && normalizedAd.photo_source !== "uploaded_original") {
        setUsePhotoAsFinal(false);
      }
      setGeneratedAd(normalizedAd);
      applyAdToDraft(normalizedAd);
      rememberImageVersion(normalizedAd, "generated");
      if (nextQuota) setQuota(nextQuota);
      setTimeout(() => scrollToAdReview(), 260);
      trackEvent(AiAdsEvents.GENERATION_SUCCEEDED, {
        screen: "create_ai",
        regeneration_attempt: 0,
        image_provider: normalizedAd.image_selection?.provider ?? null,
        image_model: normalizedAd.image_selection?.model ?? null,
        image_source_mode: normalizedAd.image_selection?.sourceMode ?? null,
        image_photo_source: normalizedAd.photo_source ?? null,
      });
    } catch (err: unknown) {
      if (requestId !== generationRequestIdRef.current) return;
      const raw = err instanceof Error ? err.message : String(err);
      const code = getErrorCode(err);
      if (code === "COOLDOWN_ACTIVE") {
        // Short pace limit — drive the button countdown, no error card/banner.
        beginGenerationCooldown(err);
        trackEvent(AiAdsEvents.GENERATION_FAILED, {
          screen: "create_ai",
          regeneration_attempt: 0,
          error_code: "COOLDOWN_ACTIVE",
        });
        return;
      }
      const friendly = friendlyGenerationError(raw, code);
      setGenerationFailureState(
        friendly,
        classifyGenerationFailure({
          raw,
          code,
          hasFallbackSource: hasFallbackTemplateSource(),
        }),
      );
      setBanner({ message: friendly, tone: "error" });
      const imageFailure = imageFailureTelemetry(err);
      trackEvent(AiAdsEvents.GENERATION_FAILED, {
        screen: "create_ai",
        regeneration_attempt: 0,
        error_code: code ?? null,
        message_snippet: raw.slice(0, 80),
        ...imageFailure,
      });
    } finally {
      // Only flip the spinner off if our request is still the active one. If the user
      // hit Cancel, that handler already cleared the flag — don't fight with it.
      if (requestId === generationRequestIdRef.current) {
        setGenerating(false);
      }
    }
  }

  async function reviseAd() {
    if (cooldownActive) return;
    if (!generatedAd || !businessId) return;
    if (blockIneligibleOffer("revise_ad")) return;
    if (revisionsUsed >= SOFT_REVISION_CAP) {
      trackEvent(AiAdsEvents.REVISION_LIMIT_HIT, {
        screen: "create_ai",
        revision_target: revisionTarget,
        revision_count: revisionsUsed,
      });
      setBanner({ message: t("createAi.errRegenClientLimit"), tone: "info" });
      return;
    }
    const revisionFeedbackText = revisionFeedback.trim();
    if (!revisionFeedbackText) {
      setBanner({ message: t("createAi.reviseErrPickSomething"), tone: "info" });
      return;
    }
    const effectiveRevisionTarget = copyOnlyRevisionTargetForFeedback(revisionTarget, revisionFeedbackText);
    /**
     * Send the treatment that produced the *previous* ad image, not the current UI selection.
     * This way the server's image-only revision applies enhancement consistent with what the
     * user is looking at, even if they fiddled with the selector after generating.
     */
    const revisesImage = effectiveRevisionTarget === "image" || effectiveRevisionTarget === "both";
    const previousSourceMode =
      generatedAd.image_selection?.sourceMode ??
      imageSourceModeForPhotoChoice(photoPath, usePhotoAsFinal);
    const sourceModeForRevision: MerchantImageSourceMode =
      revisesImage && previousSourceMode === "merchant_original"
        ? "merchant_ai_edit"
        : revisesImage && previousSourceMode === "deterministic_fallback"
          ? "ai_generated"
        : previousSourceMode;
    const editModeForRevision =
      sourceModeForRevision === "merchant_ai_edit"
        ? generatedAd.image_selection?.editMode && generatedAd.image_selection.editMode !== "none"
          ? generatedAd.image_selection.editMode
          : "studio_polish"
        : "none";
    const treatmentForRevision =
      sourceModeForRevision === "merchant_ai_edit"
        ? lastSentPhotoTreatmentRef.current ??
          photoTreatment ??
          (editModeForRevision === "clean_background"
            ? "cleanbg"
            : editModeForRevision === "touchup"
              ? "touchup"
              : "studiopolish")
        : null;
    const customEditText = sourceModeForRevision === "merchant_ai_edit" && editModeForRevision === "custom"
      ? cleanCustomImageEditInstruction(customImageEditInstruction || revisionFeedback)
      : "";
    if (sourceModeForRevision === "merchant_ai_edit" && editModeForRevision === "custom" && !customEditText) {
      setBanner({ message: t("createAi.errCustomImageEditRequired"), tone: "info" });
      return;
    }
    adGenerationStartedAtRef.current = Date.now();
    composedPreviewShownAtRef.current = null;
    lastComposedPreviewTelemetryHashRef.current = null;
    setRevising(true);
    setBanner(null);
    const requestId = ++generationRequestIdRef.current;
    const maxClaimsNum = Number(maxClaims);
    const revisionNumber = revisionsUsed + 1;
    trackEvent(AiAdsEvents.REVISION_TAPPED, {
      screen: "create_ai",
      revision_target: effectiveRevisionTarget,
      selected_revision_target: revisionTarget,
      revision_count: revisionNumber,
      feedback_length: revisionFeedbackText.length,
      image_source_mode: sourceModeForRevision,
    });
    try {
      const { ad, quota: nextQuota } = await aiReviseAd({
        business_id: businessId,
        hint_text: hintText.trim(),
        business_context: businessContextForAi,
        output_language: dealOutputLang,
        request_group_id: aiRequestGroupIdRef.current,
        deal_eligibility: eligibilityInput,
        previous_ad: generatedAd,
        revision_target: effectiveRevisionTarget,
        revision_count: revisionNumber,
        revision_feedback: revisionFeedbackText,
        image_source_mode: sourceModeForRevision,
        image_edit_mode: editModeForRevision,
        ...(editModeForRevision === "custom" ? { custom_image_edit_instruction: customEditText } : {}),
        ...(photoPath ? { photo_path: photoPath } : {}),
        ...(treatmentForRevision ? { photo_treatment: treatmentForRevision } : {}),
        ...(offerScheduleSummary ? { offer_schedule_summary: offerScheduleSummary } : {}),
        ...(Number.isFinite(maxClaimsNum) && maxClaimsNum > 0 ? { quantity_limit: maxClaimsNum } : {}),
        redemption_limit: redemptionLimitSummary,
        creative: buildCreativeRequestPayload(),
      });
      // Stale-result guard: discard if user replaced the photo or kicked off another generation.
      if (requestId !== generationRequestIdRef.current) return;
      let normalizedAd = normalizeGeneratedAdDisplayCopy(ad);
      if (!imageVersionStoragePath(normalizedAd) && photoPath) {
        const originalPhotoAd = buildOriginalPhotoVersionAd(normalizedAd, photoPath);
        if (originalPhotoAd) {
          normalizedAd = originalPhotoAd;
          setUsePhotoAsFinal(true);
          setMerchantOriginalWarningAcknowledged(false);
        }
      }
      if (!imageVersionStoragePath(normalizedAd)) {
        const friendly = t("createAi.errImageGenerationNoImage", {
          defaultValue: "AI couldn't create an image for this ad. Add a photo or try again before using it.",
        });
        setBanner({ message: friendly, tone: "error" });
        trackEvent(AiAdsEvents.REVISION_FAILED, {
          screen: "create_ai",
          revision_target: effectiveRevisionTarget,
          selected_revision_target: revisionTarget,
          revision_count: revisionNumber,
          error_code: "NO_IMAGE_RETURNED",
        });
        return;
      }
      const revisionChange = summarizeAiRevisionChange({
        previousAd: generatedAd,
        revisedAd: normalizedAd,
        target: effectiveRevisionTarget,
      });
      if (!revisionChange.hasExpectedChange) {
        setBanner({ message: t("createAi.reviseErrUnchanged"), tone: "info" });
        if (nextQuota) setQuota(nextQuota);
        trackEvent(AiAdsEvents.REVISION_FAILED, {
          screen: "create_ai",
          revision_target: effectiveRevisionTarget,
          selected_revision_target: revisionTarget,
          revision_count: revisionNumber,
          error_code: "REVISION_UNCHANGED",
          copy_changed: revisionChange.copyChanged,
          image_changed: revisionChange.imageChanged,
        });
        return;
      }
      trackEvent(AiAdsEvents.REVISION_SUCCEEDED, {
        screen: "create_ai",
        revision_target: effectiveRevisionTarget,
        selected_revision_target: revisionTarget,
        revision_count: revisionNumber,
        photo_source: normalizedAd.photo_source ?? "unknown",
        copy_source: normalizedAd.copy_source ?? "unknown",
        selected_variant_index: normalizedAd.selected_variant_index ?? null,
        alternative_count: normalizedAd.copy_alternatives?.length ?? 0,
      });
      const revisionSuccessKey = revisionChange.copyChanged && revisionChange.imageChanged
        ? "createAi.reviseSuccessBoth"
        : revisionChange.imageChanged
          ? "createAi.reviseSuccessImage"
          : "createAi.reviseSuccessCopy";
      setBanner({ message: t(revisionSuccessKey), tone: "success" });
      setGeneratedAd(normalizedAd);
      applyAdToDraft(normalizedAd);
      rememberImageVersion(normalizedAd, "revision");
      if (nextQuota) setQuota(nextQuota);
      setRevisionsUsed((u) => u + 1);
      setRevisionFeedback("");
      setComposedStyleIndex(0);
      setComposedEditIntent(null);
      setApprovedComposedPresentationHash(null);
      setApprovedLocalizationApprovalHash(null);
      setAdAccepted(false);
    } catch (err: unknown) {
      if (requestId !== generationRequestIdRef.current) return;
      const raw = err instanceof Error ? err.message : String(err);
      const code = getErrorCode(err);
      if (code === "COOLDOWN_ACTIVE") {
        // Same rate limit applies to revisions — start the button countdown
        // instead of showing an error banner.
        beginGenerationCooldown(err);
        trackEvent(AiAdsEvents.REVISION_FAILED, {
          screen: "create_ai",
          revision_target: effectiveRevisionTarget,
          selected_revision_target: revisionTarget,
          revision_count: revisionNumber,
          error_code: "COOLDOWN_ACTIVE",
        });
        return;
      }
      const friendly = friendlyGenerationError(raw, code);
      setBanner({ message: friendly, tone: "error" });
      trackEvent(AiAdsEvents.REVISION_FAILED, {
        screen: "create_ai",
        revision_target: effectiveRevisionTarget,
        selected_revision_target: revisionTarget,
        revision_count: revisionNumber,
        error_code: code ?? "unknown",
        message_snippet: raw.slice(0, 80),
      });
    } finally {
      if (requestId === generationRequestIdRef.current) {
        setRevising(false);
      }
    }
  }

  function invalidateAcceptedAdDraft() {
    // The merchant is editing the already-accepted final draft while looking at the
    // same live preview that publish uses. Keep the editor mounted, but invalidate
    // both approval bindings so publish cannot use an approval for stale copy.
    setManualDraftUnlocked(true);
    setApprovedComposedPresentationHash(null);
    setApprovedLocalizationApprovalHash(null);
    setPublishStatus("idle");
    setPublishStatusMessage(null);
  }

  function acceptAd() {
    if (!generatedAd) return;
    if (!imageVersionStoragePath(generatedAd)) {
      setBanner({
        message: t("createAi.errImageGenerationNoImage", {
          defaultValue: "AI couldn't create an image for this ad. Add a photo or try again before using it.",
        }),
        tone: "error",
      });
      return;
    }
    if (composedCompositeQaEnabled && selectedComposedCompositeQa.decision === "block") {
      trackEvent(AiAdsEvents.COMPOSED_APPROVAL_BLOCKED, {
        screen: "create_ai",
        reason: "composite_qa_block",
        selected_template_id: selectedComposedPresentation.templateId,
        presentation_hash: selectedComposedPresentationHash,
        composite_qa_decision: selectedComposedCompositeQa.decision,
        composite_qa_reason_codes: selectedComposedCompositeQa.hardFailReasons.join(","),
      });
      setBanner({
        message: t("createAi.compositeQaBlocked", {
          defaultValue: "This ad layout needs a safer preview before publishing. Try another style or change the photo.",
        }),
        tone: "warning",
      });
      return;
    }
    if (selectedComposedScreenshotQaRequired) {
      trackEvent(AiAdsEvents.COMPOSED_APPROVAL_BLOCKED, {
        screen: "create_ai",
        reason: "screenshot_qa_required",
        selected_template_id: selectedComposedPresentation.templateId,
        presentation_hash: selectedComposedPresentationHash,
        composite_qa_decision: selectedComposedCompositeQa.decision,
        composite_qa_trigger_codes: selectedComposedCompositeQa.screenshotQaTriggerCodes.join(","),
        locale_screenshot_qa_trigger_locales: selectedLocaleScreenshotQaTriggerLocales.join(","),
      });
      setBanner({
        message: t("createAi.compositeScreenshotQaRequired", {
          defaultValue: "This ad needs visual review before it can be approved. Try another style or use the split layout.",
        }),
        tone: "warning",
      });
      return;
    }
    if (automaticLocalizationApprovalEnabled && ownerLanguagePreviewAvailable) {
      if (!selectedLocalizationApproval?.approved) {
        trackEvent(AiAdsEvents.COMPOSED_APPROVAL_BLOCKED, {
          screen: "create_ai",
          reason: "localization_approval_blocked",
          selected_template_id: selectedComposedPresentation.templateId,
          presentation_hash: selectedComposedPresentationHash,
          localization_reason_codes: selectedLocalizationApproval?.reasonCodes.join(",") ?? "missing_result",
        });
        setBanner({
          message: t("createAi.localizationApprovalBlocked", {
            defaultValue:
              "The language versions need a safer verified preview before publishing. Try generating again or use the fallback ad.",
          }),
          tone: "warning",
        });
        return;
      }
    }
    setApprovedComposedPresentationHash(
      shouldBindComposedPresentationApproval ? selectedComposedPresentationHash : null,
    );
    setApprovedLocalizationApprovalHash(
      automaticLocalizationApprovalEnabled && ownerLanguagePreviewAvailable && selectedLocalizationApproval?.approved
        ? selectedLocalizationApproval.approval.approvalHash
        : null,
    );
    setAdAccepted(true);
    setManualDraftUnlocked(true);
    setPublishStatus("idle");
    setPublishStatusMessage(null);
    if (composedAdPreviewEnabled) {
      const approvedAt = Date.now();
      trackEvent(AiAdsEvents.COMPOSED_APPROVED, {
        screen: "create_ai",
        selected_template_id: selectedComposedPresentation.templateId,
        alternate_template_count: Math.max(0, composedPresentationOptions.length - 1),
        merchant_style_override_used: composedStyleIndex > 0,
        presentation_hash: selectedComposedPresentationHash,
        composite_qa_decision: selectedComposedCompositeQa.decision,
        composite_qa_repair_count: selectedComposedCompositeQa.repairCodes.length,
        screenshot_qa_required: selectedComposedScreenshotQaRequired,
        time_to_approval_ms: composedPreviewShownAtRef.current ? approvedAt - composedPreviewShownAtRef.current : null,
      });
    }
    trackEvent(AiAdsEvents.AD_SELECTED, {
      screen: "create_ai",
      creative_lane: "single",
      regeneration_attempt: revisionsUsed,
    });
    setTimeout(() => {
      scrollToDraftEditor();
    }, 220);
  }

  function useFallbackTemplateAd() {
    if (!canUseFallbackTemplateForOutcome(lastGenerationOutcomeKind)) {
      setBanner({
        message: t("createAi.fallbackTemplateUnavailable", {
          defaultValue: "A fallback template is not available for this issue. Fix the message above, then try again.",
        }),
        tone: "warning",
      });
      return;
    }
    const generatedPosterPath = imageVersionStoragePath(generatedAd);
    const fallbackPosterPath = generatedPosterPath ?? photoPath ?? null;
    const hasImageSource = Boolean(fallbackPosterPath || photoUri || posterUrl);
    if (!hasImageSource) {
      setBanner({
        message: t("createAi.errImageRequired", {
          defaultValue: "Every deal needs an image. Add a photo, or generate again so AI can create one.",
        }),
        tone: "error",
      });
      return;
    }
    const maxClaimsNum = Number(maxClaims);
    const fallbackBaseAd = offerDefinition
      ? buildOfferDefinitionFallbackAd(offerDefinition, { ctaText })
      : buildFallbackTemplateAd({
          businessName,
          title,
          promoLine,
          ctaText,
          description,
          ownerOfferHint: hintText,
          lockedOfferLine: offerContract?.canonicalOfferLine ?? null,
          lockedTermsLine: offerContract?.canonicalShortTerms ?? null,
          scheduleSummary: displayScheduleSummary,
          quantityLimit: Number.isFinite(maxClaimsNum) && maxClaimsNum > 0 ? maxClaimsNum : null,
        });
    const fallbackAd = fallbackPosterPath
      ? {
          ...fallbackBaseAd,
          poster_storage_path: fallbackPosterPath,
          photo_source: generatedPosterPath ? generatedAd?.photo_source ?? "generated" : ("uploaded_original" as const),
          photo_treatment: generatedPosterPath ? generatedAd?.photo_treatment ?? null : null,
        }
      : fallbackBaseAd;
    if (!fallbackPosterPath && (photoUri || posterUrl)) {
      // Only claim "use the merchant photo as final" when there actually is one;
      // a poster-only deal (no image at all) must leave usePhotoAsFinal false.
      setUsePhotoAsFinal(true);
      setMerchantOriginalWarningAcknowledged(false);
    }
    adGenerationStartedAtRef.current = Date.now();
    composedPreviewShownAtRef.current = null;
    lastComposedPreviewTelemetryHashRef.current = null;
    setGeneratedAd(fallbackAd);
    setComposedStyleIndex(0);
    setComposedEditIntent(null);
    setApprovedComposedPresentationHash(null);
    setApprovedLocalizationApprovalHash(null);
    rememberImageVersion(fallbackAd, "fallback");
    applyAdToDraft(fallbackAd);
    setAdAccepted(!composedExactPresentationApprovalEnabled);
    setManualDraftUnlocked(true);
    clearGenerationErrorState();
    setPublishStatus("idle");
    setPublishStatusMessage(null);
    setBanner({
      message: t("createAi.fallbackTemplateReady", {
        defaultValue: "Fallback ad ready. Review the details, then publish when it looks right.",
      }),
      tone: "info",
    });
    trackEvent("owner_fallback_template_used", { businessId, hasPhoto: Boolean(photoPath || photoUri || posterUrl) });
    setTimeout(() => {
      scrollToAdReview();
    }, 260);
  }

  function showPublishError(message: string, tone: "error" | "warning" = "error") {
    setPublishStatus("error");
    setPublishStatusMessage(message);
    setBanner({ message, tone });
  }

  async function updateDealWithCompatibility(row: Record<string, unknown>) {
    let payload: Record<string, unknown> = row;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await supabase
        .from("deals")
        .update(payload)
        .eq("id", editingDealId)
        .eq("business_id", businessId);
      if (!result.error) return result;
      if (isMissingDealLocationColumn(result.error) && "location_id" in payload) {
        payload = omitDealLocationId(payload);
        continue;
      }
      if (
        isMissingDealEligibilityColumn(result.error) &&
        DEAL_ELIGIBILITY_DEAL_COLUMN_KEYS.some((key) => key in payload)
      ) {
        payload = omitDealEligibilityColumns(payload);
        continue;
      }
      return result;
    }
    return supabase.from("deals").update(payload).eq("id", editingDealId).eq("business_id", businessId);
  }

  async function publishDeal() {
    if (publishInFlightRef.current) return;
    setPublishStatusMessage(null);
    if (!canPublish) {
      const message = publishReadiness.reasonMessage || t("createAi.publishMissingBody");
      setPublishStatus("missing");
      setBanner({ message, tone: "error" });
      return;
    }
    if (!validateInputs()) {
      setPublishStatus("error");
      setPublishStatusMessage(t("createAi.publishValidationBody"));
      return;
    }
    if (!businessId) {
      showPublishError(t("createAi.errCreateBusinessFirst"));
      return;
    }
    const priceNum = parseOptionalPriceInput(price);
    if (priceNum !== null && Number.isNaN(priceNum)) {
      showPublishError(t("createAi.errPriceNumber"));
      return;
    }
    if (blockIneligibleOffer("publish")) {
      setPublishStatus("error");
      setPublishStatusMessage(eligibilityResult.message ?? t("dealEligibility.invalidTitle", { defaultValue: "Not eligible yet" }));
      return;
    }

    // Validate the locked offer mechanics that will be published. Marketing fields can
    // repeat the same valid line in preview/draft state, which is a copy-quality issue
    // but not a terms-change failure.
    if (offerContract && offerDefinition) {
      const mechanicsValidation = validateAiCopyAgainstOffer(buildPublishMechanicsValidationCopy(offerDefinition), offerContract);
      if (!mechanicsValidation.valid) {
        const message = t("createAi.offerMechanicsInvalid", {
          defaultValue: "Your offer setup doesn't match this deal type. Check what the customer buys, the free item, and the offer rule above, then try again.",
        });
        showPublishError(message, "warning");
        trackEvent("deal_validation_failed", {
          businessId,
          attemptedDealType: eligibilityForm.dealType,
          reasonCode: mechanicsValidation.reasonCodes.join(","),
          attemptedAction: "publish_mechanics_validation",
          source: "create_ai",
        });
        return;
      }
    }

    const composedDescription = composeListingDescription(promoLine, ctaText, description);
    // listingDescription is what gets STORED and shown to consumers. The deal card already
    // renders its own Claim button, so the CTA is a button label, not body copy — leaving it
    // in the description repeats it (e.g. a "Claim deal" line above a Claim button). Drop it.
    const listingDescription = composeListingDescription(promoLine, "", description);
    const quality = assessDealQuality({
      title: title.trim(),
      description: composedDescription,
      price: priceNum,
    });
    if (quality.blocked) {
      showPublishError(translateDealQualityBlock(quality, dealOutputLang));
      return;
    }

    const strongGuard = validateStrongDealOnly({
      title: title.trim(),
      description: composedDescription,
      // R13: this is the publish path where a genuine 40%-off deal was blocked because the
      // AI wrote "for 40% less" instead of "40% off". The merchant's own structured offer
      // has been validated by this point — consult it rather than the model's word choice.
      structuredOffer: {
        dealType: eligibilityInput.dealType ?? null,
        discountPercent: toGuardNumber(eligibilityInput.discountPercent),
        freeItemQuantity: toGuardNumber(eligibilityInput.freeItemQuantity),
        freeItemDiscountPercent: toGuardNumber(eligibilityInput.freeItemDiscountPercent),
      },
    });
    if (!strongGuard.ok) {
      const key = `dealQuality.strongGuard.${strongGuard.reason}`;
      showPublishError(t(key, { defaultValue: t("dealQuality.strongDealMessage") }), "warning");
      return;
    }

    const isRecurring = validityMode === "recurring";
    if (!isRecurring && endTime.getTime() <= Date.now()) {
      showPublishError(t("createAi.errEndTimePassed"));
      return;
    }
    if (!editingDealId && !offerDefinition) {
      showPublishError(t("createAi.errPublishFailed"));
      return;
    }
    if (usePhotoAsFinal && !merchantOriginalWarningAcknowledged) {
      showPublishError(t("createAi.errOriginalPhotoAckRequired"), "warning");
      return;
    }
    if (!editingDealId && generatedAd && composedExactPresentationApprovalEnabled) {
      if (!adAccepted || !composedPresentationApprovalMatches) {
        trackEvent(AiAdsEvents.COMPOSED_PUBLISH_BLOCKED, {
          screen: "create_ai",
          reason: "approval_required",
          selected_template_id: selectedComposedPresentation.templateId,
          presentation_hash: selectedComposedPresentationHash,
          approved_presentation_hash: approvedComposedPresentationHash,
        });
        showPublishError(
          t("createAi.errPresentationApprovalRequired", {
            defaultValue: "Approve the exact ad preview again before publishing.",
          }),
          "warning",
        );
        return;
      }
    }
    if (!editingDealId && automaticLocalizationApprovalEnabled && ownerLanguagePreviewAvailable) {
      const localizationApprovalMatches =
        selectedLocalizationApproval?.approved === true &&
        approvedLocalizationApprovalHash === selectedLocalizationApproval.approval.approvalHash;
      if (!adAccepted || !localizationApprovalMatches) {
        trackEvent(AiAdsEvents.COMPOSED_PUBLISH_BLOCKED, {
          screen: "create_ai",
          reason: "localization_approval_required",
          selected_template_id: selectedComposedPresentation.templateId,
          presentation_hash: selectedComposedPresentationHash,
          approved_localization_hash: approvedLocalizationApprovalHash,
          localization_approval_hash: selectedLocalizationApproval?.approved
            ? selectedLocalizationApproval.approval.approvalHash
            : null,
          localization_reason_codes: selectedLocalizationApproval?.reasonCodes.join(",") ?? "missing_result",
        });
        showPublishError(
          t("createAi.errLocalizationApprovalRequired", {
            defaultValue: "Approve the exact multilingual preview again before publishing.",
          }),
          "warning",
        );
        return;
      }
    }
    if (!editingDealId && composedCompositeQaEnabled && selectedComposedCompositeQa.decision === "block") {
      trackEvent(AiAdsEvents.COMPOSED_PUBLISH_BLOCKED, {
        screen: "create_ai",
        reason: "composite_qa_block",
        selected_template_id: selectedComposedPresentation.templateId,
        presentation_hash: selectedComposedPresentationHash,
        composite_qa_decision: selectedComposedCompositeQa.decision,
        composite_qa_reason_codes: selectedComposedCompositeQa.hardFailReasons.join(","),
      });
      showPublishError(
        t("createAi.errCompositeQaBlocked", {
          defaultValue: "This ad preview failed layout checks. Try another style or change the photo.",
        }),
        "warning",
      );
      return;
    }
    if (!editingDealId && selectedComposedScreenshotQaRequired) {
      trackEvent(AiAdsEvents.COMPOSED_PUBLISH_BLOCKED, {
        screen: "create_ai",
        reason: "screenshot_qa_required",
        selected_template_id: selectedComposedPresentation.templateId,
        presentation_hash: selectedComposedPresentationHash,
        composite_qa_decision: selectedComposedCompositeQa.decision,
        composite_qa_trigger_codes: selectedComposedCompositeQa.screenshotQaTriggerCodes.join(","),
        locale_screenshot_qa_trigger_locales: selectedLocaleScreenshotQaTriggerLocales.join(","),
      });
      showPublishError(
        t("createAi.errCompositeScreenshotQaRequired", {
          defaultValue: "This ad preview needs visual QA before publishing. Try another style or use a safer layout.",
        }),
        "warning",
      );
      return;
    }

    publishInFlightRef.current = true;
    setPublishing(true);
    setPublishStatus("publishing");
    setBanner(null);
    try {
      const path = await ensureUploadedPhoto();
      const signedPoster = await ensurePosterUrl(path);
      const userPhotoStoragePath = path ?? extractDealPhotoStoragePath(posterUrl);
      const maxClaimsNum = Number(maxClaims);
      const cutoffNum = Number(cutoffMins);
      // Clamp a one-time start that has slipped into the past (e.g. a draft
      // resumed and left open) up to "now", so publish never records a start
      // time before the deal actually goes live.
      const start = isRecurring
        ? new Date()
        : startTime.getTime() < Date.now()
          ? new Date()
          : startTime;
      const end = isRecurring ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : endTime;
      // The "end has already passed" guard above ran before the photo upload and
      // poster signing awaits, while this clamp runs after them. A window that
      // passed that guard can be overtaken by its own publish, so re-check the
      // end against the start actually being written. Neither the edge function
      // nor the deals table rejects an inverted window, so stopping here is what
      // keeps a dead-on-arrival deal from being published.
      if (!isRecurring && end.getTime() <= start.getTime()) {
        showPublishError(t("createAi.errEndTimePassed"));
        return;
      }
      const sourceLocaleForPublish = localizedOwnerUiEnabled
        ? dealOutputLang
        : editingSourceLocale ?? prefillSourceLocale ?? dealOutputLang;
      // Same expression as `publishSourceLocale`; read the hoisted value so the
      // approve-time preview and this publish path can never drift apart.
      const supportedSourceLocaleForPublish = publishSourceLocale;

      const aiPosterPath = imageVersionStoragePath(generatedAd);
      const finalStoragePath = resolveCurrentDealPosterStoragePath({
        aiPosterStoragePath: aiPosterPath,
        uploadedPhotoStoragePath: userPhotoStoragePath,
        posterUrl,
        allowPhotoFallback: usePhotoAsFinal,
      });
      const finalPublicPoster = finalStoragePath ? buildPublicDealPhotoUrl(finalStoragePath) : null;
      const explicitPhotoPoster = usePhotoAsFinal ? signedPoster ?? posterUrl ?? null : null;
      const posterForPublish = finalPublicPoster ?? explicitPhotoPoster;
      // Fields the merchant changed in the draft editor (vs. the accepted AI
      // draft baseline). With no baseline (manual draft, deal edit, restored
      // recovery draft) the box content is wholly the merchant's, so it counts
      // as edited. Unedited fields stay null so the AI copy flows unchanged.
      const draftBaseline = aiDraftBaselineRef.current;
      const merchantEditedCopy = {
        title:
          title.trim() && (!draftBaseline || title.trim() !== draftBaseline.title.trim())
            ? title.trim()
            : null,
        promoLine:
          promoLine.trim() && (!draftBaseline || promoLine.trim() !== draftBaseline.promo_line.trim())
            ? promoLine.trim()
            : null,
        ctaText:
          ctaText.trim() && (!draftBaseline || ctaText.trim() !== draftBaseline.cta_text.trim())
            ? ctaText.trim()
            : null,
      };
      // Merchant-typed copy may omit offer facts (the locked offer line carries
      // them) but must never contradict them. Block with a clear message instead
      // of silently replacing the merchant's words.
      const merchantCopyCheck = checkMerchantDealTitleAgainstOffer(
        { title: merchantEditedCopy.title, supportingLine: merchantEditedCopy.promoLine },
        offerContract,
      );
      if (!merchantCopyCheck.ok) {
        showPublishError(
          t("createAi.errHeadlineContradictsOffer", {
            defaultValue:
              "Your headline or subheadline doesn't match this deal's locked offer facts. Update the wording so it fits the offer, then publish again.",
          }),
          "warning",
        );
        return;
      }
      const baseAdForPublishSpec = generatedAdForPublishSpec({
        ad: reviewGeneratedAd,
        finalStoragePath,
        uploadedPhotoStoragePath: userPhotoStoragePath,
        usePhotoAsFinal,
        merchantOriginalWarningAcknowledged,
        merchantEditedCopy,
      }) ?? (offerDefinition
        ? manualDraftGeneratedAdForPublishSpec({
            offerDefinition,
            finalStoragePath,
            uploadedPhotoStoragePath: userPhotoStoragePath,
            usePhotoAsFinal,
            merchantOriginalWarningAcknowledged,
            title,
            promoLine,
            ctaText,
            description,
            ownerOfferHint: hintText,
            scheduleSummary: displayScheduleSummary,
            quantityLimit: Number.isFinite(maxClaimsNum) ? maxClaimsNum : null,
          })
        : null);
      const deterministicLocalizationBundle =
        offerDefinition &&
        baseAdForPublishSpec &&
        !baseAdForPublishSpec.localization_bundle
          ? buildDeterministicAdLocalizationBundle({
              sourceLocale: supportedSourceLocaleForPublish,
              sourceCreative: {
                headline: baseAdForPublishSpec.headline,
                supportingCopy: baseAdForPublishSpec.short_description ?? baseAdForPublishSpec.subheadline,
                imageAltText: `${offerDefinition.merchantName} offer image. ${offerDefinition.canonicalOfferSentence}`,
              },
              offerDefinition,
            })
          : null;
      const adForPublishSpec = baseAdForPublishSpec
        ? {
            ...baseAdForPublishSpec,
            ...(deterministicLocalizationBundle
              ? {
                  localization_bundle: deterministicLocalizationBundle,
                  localization_status: {
                    source_locale: deterministicLocalizationBundle.sourceLocale,
                    localization_bundle_hash: deterministicLocalizationBundle.localizationBundleHash,
                    deterministic_fallback_locales: deterministicLocalizationBundle.deterministicFallbackLocales,
                    transcreation_provider: "deterministic",
                    transcreation_model: "none",
                    semantic_qa_provider: "deterministic",
                    semantic_qa_model: "none",
                    repair_target_locales: [],
                  },
                }
              : {}),
          }
        : null;
      const shouldPublishPosterSpec = creativeFormat === "poster_v1" || previewFormat === "poster_v1";
      if (shouldPublishPosterSpec) {
        // Merchant-typed poster text must publish exactly as previewed: block on
        // fit/policy problems instead of letting the sanitizer silently rewrite it.
        const posterHeadlineCheck = checkMerchantPosterHeadline(posterHeadlineText);
        const posterSublineCheck = checkMerchantPosterSubline(posterSublineText);
        if (!posterHeadlineCheck.ok || !posterSublineCheck.ok) {
          const overLimit =
            posterHeadlineCheck.reasonCodes.includes("POSTER_TEXT_OVER_LIMIT") ||
            posterSublineCheck.reasonCodes.includes("POSTER_TEXT_OVER_LIMIT");
          showPublishError(
            overLimit
              ? t("createAi.errPosterTextTooLong", {
                  defaultValue:
                    "The poster headline or subheadline is too long to fit the poster. Shorten it, then publish again.",
                  headlineMax: POSTER_TEXT_LIMITS.headline,
                  sublineMax: POSTER_TEXT_LIMITS.subline,
                })
              : t("createAi.errPosterTextNotAllowed", {
                  defaultValue:
                    "The poster headline or subheadline uses wording that can't go on the poster (like claim/scan instructions or restating the offer mechanics). Reword it, then publish again.",
                }),
            "warning",
          );
          return;
        }
        const posterFactsCheck = checkMerchantDealTitleAgainstOffer(
          {
            title: posterHeadlineText.trim() || null,
            supportingLine: posterSublineText.trim() || null,
          },
          offerContract,
        );
        if (!posterFactsCheck.ok) {
          showPublishError(
            t("createAi.errHeadlineContradictsOffer", {
              defaultValue:
                "Your headline or subheadline doesn't match this deal's locked offer facts. Update the wording so it fits the offer, then publish again.",
            }),
            "warning",
          );
          return;
        }
      }
      const posterForPublishSpec =
        shouldPublishPosterSpec && offerDefinition
          ? buildPosterSpecFromOfferDefinition({
              definition: offerDefinition,
              enabled: true,
              templateId: selectedPosterTemplateId,
              sourceAssetPath: finalStoragePath,
              renderedAssetPath: null,
              headline: posterHeadlineText.trim() || title.trim() || generatedAd?.headline || null,
              subline: posterSublineText.trim() || null,
              sourceLocale: supportedSourceLocaleForPublish,
              businessCategory: businessContextForAi.category,
              compositionPlan: generatedAd?.poster?.composition_plan ?? generatedAd?.item_research?.description ?? null,
            })
          : null;
      const adForPublishSpecWithPoster =
        adForPublishSpec && posterForPublishSpec
          ? {
              ...adForPublishSpec,
              poster: posterForPublishSpec,
            }
          : adForPublishSpec;
      const localizationBundleForPublish = adForPublishSpecWithPoster?.localization_bundle ?? null;
      const publishOwnerLanguagePreview = buildOwnerLanguagePreview({
        generatedAd: adForPublishSpecWithPoster,
        offerDefinition,
        sourceLocale: localizationBundleForPublish?.sourceLocale ?? supportedSourceLocaleForPublish,
        previewLocale: supportedSourceLocaleForPublish,
        // Must match the preview's gate (`ownerLanguagePreviewAvailable`). Gating on
        // the bundle alone localized the publish copy while the approved preview was
        // built unlocalized, so the two hashes could never match.
        localizedPreviewEnabled: localizedOwnerUiEnabled && Boolean(localizationBundleForPublish),
        fallbackOfferLine: adForPublishSpecWithPoster?.locked_offer_line || offerContract?.canonicalOfferLine || title || promoLine,
        fallbackTermsLine: adForPublishSpecWithPoster?.locked_terms_line || offerContract?.canonicalShortTerms || description,
        fallbackCtaLabel: ctaText,
      });
      const publishImageAssetId = finalStoragePath ?? imageVersionStoragePath(adForPublishSpecWithPoster);
      const publishImageSourceType = adForPublishSpecWithPoster
        ? imageSourceTypeFromGeneratedAd(adForPublishSpecWithPoster)
        : posterForPublish
          ? "merchant_original"
          : "deterministic_fallback";
      const publishImageQa = sourceAwareQaFromSelectionQa(
        adForPublishSpecWithPoster?.image_selection?.qa,
        publishImageSourceType,
        Boolean(posterForPublish),
      );
      const publishImageSafeZones = buildImageSafeZoneResult({
        hasImage: Boolean(posterForPublish),
        imageSourceType: publishImageSourceType,
        imageQa: publishImageQa,
        cropSuitabilityScore: cropSuitabilityScoreForQa(publishImageQa),
      });
      const publishBaseComposedPresentation: AdPresentationSpec = {
        ...selectedBaseComposedPresentation,
        imageAssetId: publishImageAssetId ?? "deterministic-fallback",
        imageSourceType: publishImageSourceType,
        resolutionReasonCodes: [
          ...new Set([
            ...selectedBaseComposedPresentation.resolutionReasonCodes.filter(
              (code) => code !== "MERCHANT_PREVIEW_IMAGE" && code !== "MERCHANT_PREVIEW_FALLBACK",
            ),
            publishImageAssetId ? "MERCHANT_PUBLISH_IMAGE" : "MERCHANT_PREVIEW_FALLBACK",
          ]),
        ],
      };
      const publishLocalePresentationResolution =
        // Same gate as the preview's `localePresentationOverridesEnabled`. Without the
        // owner-UI conjunct the publish spec carried locale overrides the approved
        // preview never had, and `createAdPresentationHash` folds those into the hash.
        localizedOwnerUiEnabled && localizationBundleForPublish && isAiV5LocalePresentationOverridesEnabled()
          ? resolveLocalePresentationOverrides({
              basePresentation: publishBaseComposedPresentation,
              localizationBundle: localizationBundleForPublish,
              merchantIdentity: composedMerchant,
            })
          : null;
      const publishComposedPresentation =
        publishLocalePresentationResolution?.presentation ?? publishBaseComposedPresentation;
      const publishPresentationReviewContext = buildLiveAdPresentationReviewContext({
        creativeFormat: shouldPublishPosterSpec ? "poster_v1" : "standard_card",
        sourceLocale: supportedSourceLocaleForPublish,
        title,
        promoLine,
        ctaText,
        description,
        poster: posterForPublishSpec,
      });
      const publishComposedPresentationHash = createAdPresentationHash({
        presentation: publishComposedPresentation,
        offerFacts: publishOwnerLanguagePreview.offerFacts,
        copy: publishOwnerLanguagePreview.copy,
        reviewContext: publishPresentationReviewContext,
      });
      if (
        !editingDealId &&
        reviewGeneratedAd &&
        (composedExactPresentationApprovalEnabled ||
          (automaticLocalizationApprovalEnabled && ownerLanguagePreviewAvailable)) &&
        approvedComposedPresentationHash !== publishComposedPresentationHash
      ) {
        showPublishError(
          t("createAi.errPresentationApprovalRequired", {
            defaultValue: "Approve the exact ad preview again before publishing.",
          }),
          "warning",
        );
        return;
      }
      const publishComposedCompositeQa = runDeterministicAdCompositeQa({
        offerFacts: publishOwnerLanguagePreview.offerFacts,
        merchant: composedMerchant,
        copy: publishOwnerLanguagePreview.copy,
        presentation: publishComposedPresentation,
        liveState: composedLiveState,
        surface: "merchant_preview",
        imageUri: posterForPublish,
        selectedImageAssetId: publishImageAssetId ?? publishComposedPresentation.imageAssetId,
        imageSafeZoneConfidence: publishImageSafeZones.confidence,
      });
      const publishComposedScreenshotQaSnapshot = buildComposedScreenshotQaSnapshot(
        publishComposedCompositeQa,
        composedScreenshotQaEnabled,
      );
      const publishLocaleScreenshotQaRequired =
        // Same gate as the preview's `localeScreenshotQaEnabled`.
        localizedOwnerUiEnabled &&
        localizationBundleForPublish &&
        isAiV5LocaleScreenshotQaEnabled() &&
        (publishLocalePresentationResolution?.screenshotQaTriggerLocales.length ?? 0) > 0;
      const publishComposedScreenshotQaRequired =
        publishComposedScreenshotQaSnapshot.required || Boolean(publishLocaleScreenshotQaRequired);
      const composedPresentationForPublish = ownerLanguagePreviewAvailable
        ? selectedComposedPresentation
        : publishComposedPresentation;
      const composedPresentationHashForPublish = ownerLanguagePreviewAvailable
        ? selectedComposedPresentationHash
        : publishComposedPresentationHash;
      const composedCompositeQaForPublish = ownerLanguagePreviewAvailable
        ? selectedComposedCompositeQa
        : publishComposedCompositeQa;
      const composedScreenshotQaSnapshotForPublish = ownerLanguagePreviewAvailable
        ? selectedComposedScreenshotQaSnapshot
        : publishComposedScreenshotQaSnapshot;
      const composedScreenshotQaRequiredForPublish = ownerLanguagePreviewAvailable
        ? selectedComposedScreenshotQaRequired
        : publishComposedScreenshotQaRequired;
      if (!editingDealId && composedCompositeQaForPublish.decision === "block") {
        showPublishError(
          t("createAi.errCompositeQaBlocked", {
            defaultValue: "This ad preview failed layout checks. Try another style or change the photo.",
          }),
          "warning",
        );
        return;
      }
      if (!editingDealId && composedScreenshotQaRequiredForPublish) {
        showPublishError(
          t("createAi.errCompositeScreenshotQaRequired", {
            defaultValue: "This ad preview needs visual QA before publishing. Try another style or use a safer layout.",
          }),
          "warning",
        );
        return;
      }
      const publishLocalizationApproval =
        offerDefinition && localizationBundleForPublish
          ? buildVerifiedAdLocalizationApproval({
              bundle: localizationBundleForPublish,
              offerDefinition,
              presentationHash: composedPresentationHashForPublish,
              selectedImageAssetId: composedPresentationForPublish.imageAssetId,
              providerStatus: adForPublishSpecWithPoster?.localization_status ?? null,
              localePresentationOverrides: composedPresentationForPublish.localeOverrides ?? null,
              screenshotQaRequired: composedScreenshotQaRequiredForPublish,
            })
          : null;
      const localizationApprovalForPublish = ownerLanguagePreviewAvailable
        ? selectedLocalizationApproval?.approved &&
          approvedLocalizationApprovalHash === selectedLocalizationApproval.approval.approvalHash &&
          selectedLocalizationApproval.approval.presentationHash === composedPresentationHashForPublish
          ? selectedLocalizationApproval.approval
          : publishLocalizationApproval?.approved
            ? publishLocalizationApproval.approval
            : null
        : publishLocalizationApproval?.approved
          ? publishLocalizationApproval.approval
          : null;
      if (automaticLocalizationApprovalEnabled && localizationBundleForPublish && !localizationApprovalForPublish) {
        showPublishError(
          t("createAi.errLocalizationApprovalRequired", {
            defaultValue: "Approve the exact multilingual preview again before publishing.",
          }),
          "warning",
        );
        return;
      }
      const composedCardPublishSpec = shouldBindComposedPresentationApproval || localizationApprovalForPublish
        ? {
            presentation: composedPresentationForPublish,
            presentationHash: composedPresentationHashForPublish,
            selectedTemplateId: composedPresentationForPublish.templateId,
            alternateTemplateIds: composedPresentationOptions
              .filter((spec) => spec.templateId !== composedPresentationForPublish.templateId)
              .map((spec) => spec.templateId),
            merchantStyleOverrideUsed: composedStyleIndex > 0,
            compositeQa: composedCompositeQaForPublish,
            screenshotQa: composedScreenshotQaSnapshotForPublish,
          }
        : null;
      if (!posterForPublish) {
        showPublishError(t("createAi.errImageRequired", {
          defaultValue: "Every deal needs an image. Add a photo, or generate again so AI can create one.",
        }));
        return;
      }
      const eligibilityColumns = dealEligibilityFormToDealColumns(eligibilityForm, eligibilityResult, "LIVE");
      const displayCopy = buildAuthoritativeDealDisplayCopy(
        offerDefinition,
        {
          title: title.trim(),
          description: listingDescription.trim(),
        },
        // Validated above via checkMerchantDealTitleAgainstOffer; only set when
        // the merchant actually edited the headline, so unedited publishes keep
        // the canonical offer line as the stored title.
        { factSafeMerchantTitle: merchantEditedCopy.title },
      );
      let translationFallbackUsed = false;
      let translations: DealTranslationResult;
      try {
        translations = await translateDealCopy({
          business_id: businessId,
          title: displayCopy.title,
          description: displayCopy.description,
          source_locale: sourceLocaleForPublish,
        });
      } catch (translationErr) {
        translationFallbackUsed = true;
        translations = buildDealTranslationFallback({
          title: displayCopy.title,
          description: displayCopy.description,
          source_locale: sourceLocaleForPublish,
          offerDefinition,
        });
        trackEvent("deal_publish_translation_fallback_used", {
          businessId,
          source_locale: sourceLocaleForPublish,
          error_code: getErrorCode(translationErr) ?? null,
        });
      }

      const baseRow = {
        business_id: businessId,
        title: displayCopy.title,
        description: displayCopy.description,
        source_locale: translations.source_locale,
        title_en: translations.title_en,
        title_es: translations.title_es,
        title_ko: translations.title_ko,
        description_en: translations.description_en,
        description_es: translations.description_es,
        description_ko: translations.description_ko,
        price: priceNum,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        claim_cutoff_buffer_minutes: cutoffNum,
        max_claims: maxClaimsNum,
        is_active: true,
        poster_url: posterForPublish ?? null,
        poster_storage_path: finalStoragePath ?? null,
        is_recurring: isRecurring,
        days_of_week: isRecurring ? daysOfWeek : null,
        window_start_minutes: isRecurring ? minutesFromDate(windowStart) : null,
        window_end_minutes: isRecurring ? minutesFromDate(windowEnd) : null,
        timezone: isRecurring ? timezone : null,
        quality_tier: quality.tier,
        ...eligibilityColumns,
      };
      if (editingDealId) {
        const updateRow = { ...baseRow, location_id: publishLocationIds[0] ?? null };
        const updateResult = await updateDealWithCompatibility(updateRow);
        if (updateResult.error) throw updateResult.error;
        if (translationFallbackUsed) {
          void translateDeal(editingDealId, sourceLocaleForPublish);
        }
      } else {
        const locTargets =
          publishLocationIds.length > 0 ? publishLocationIds : [null as string | null];
        const rows = locTargets.map((lid) => ({ ...baseRow, location_id: lid }));
        if (!offerDefinition) throw new Error("Missing offer definition for versioned publish.");
        const publishAdSpecOptions = {
          composedCard: composedCardPublishSpec,
          localizationApproval: localizationApprovalForPublish,
          ...(localizationBundleForPublish ? {} : { localization: null }),
        };
        const publishBodyBase = {
          business_id: businessId,
          offer_definition: offerDefinition,
          deal_rows: rows,
          idempotency_key:
            publishIdempotencyKeyRef.current ??
            (publishIdempotencyKeyRef.current = createPublishIdempotencyKey("create_ai")),
        };
        let versionedResult: PublishOfferVersionedDealResult;
        try {
          versionedResult = await publishOfferVersionedDeal({
            ...publishBodyBase,
            ad_spec: buildOfferVersionPublishAdSpec(
              "create_ai",
              offerDefinition,
              adForPublishSpecWithPoster,
              publishAdSpecOptions,
            ),
          });
        } catch (publishErr) {
          if (!posterForPublishSpec || !isPosterPublishSpecError(publishErr)) {
            throw publishErr;
          }
          trackEvent("deal_publish_poster_spec_fallback_used", {
            businessId,
            reason_codes: publishReasonCodes(publishErr).join(","),
            source: "create_ai",
          });
          const standardCardAdForPublish = adForPublishSpecWithPoster
            ? {
                ...adForPublishSpecWithPoster,
                poster: undefined,
              }
            : null;
          versionedResult = await publishOfferVersionedDeal({
            ...publishBodyBase,
            ad_spec: buildOfferVersionPublishAdSpec(
              "create_ai",
              offerDefinition,
              standardCardAdForPublish,
              publishAdSpecOptions,
            ),
          });
        }
        const dealsOut = versionedResult.deals.map((row) => ({
          id: row.deal_id,
          shouldNotify: row.idempotency_replayed !== true,
        }));
        for (const row of dealsOut) {
          if (translationFallbackUsed && row.id) {
            void translateDeal(row.id, sourceLocaleForPublish);
          }
          if (row.id && row.shouldNotify) {
            void notifyDealPublished(row.id);
          }
        }
      }

      const baseline = aiDraftBaselineRef.current;
      if (baseline) {
        const edited =
          title.trim() !== baseline.title.trim() ||
          promoLine.trim() !== baseline.promo_line.trim() ||
          ctaText.trim() !== baseline.cta_text.trim() ||
          description.trim() !== baseline.description.trim();
        if (edited) {
          trackEvent(AiAdsEvents.FIELDS_EDITED_BEFORE_PUBLISH, { screen: "create_ai" });
        }
        trackEvent(AiAdsEvents.PUBLISHED_WITH_AI_DRAFT, {
          screen: "create_ai",
          draft_edited: edited,
          composed_preview_enabled: composedAdPreviewEnabled,
          selected_template_id: composedAdPreviewEnabled ? selectedComposedPresentation.templateId : null,
          merchant_style_override_used: composedAdPreviewEnabled ? composedStyleIndex > 0 : null,
          composite_qa_decision: composedAdPreviewEnabled ? selectedComposedCompositeQa.decision : null,
          composite_qa_repair_count: composedAdPreviewEnabled ? selectedComposedCompositeQa.repairCodes.length : null,
        });
      }

      await clearAiRecoveryDraft();
      // Hand off a one-shot success flash to whichever tab the owner lands on
      // (usually dashboard). Without this the redirect is silent — nervous pilots
      // need a "yes, it worked" moment.
      const successMessage = editingDealId
        ? t("createAi.publishUpdateSuccessBody")
        : t("createAi.publishSuccessBody");
      setPublishing(false);
      setPublishStatus("success");
      publishIdempotencyKeyRef.current = null;
      setPublishStatusMessage(successMessage);
      setBanner({ message: successMessage, tone: "success" });
      if (editingDealId) {
        const savedPosterPath = baseRow.poster_storage_path;
        const savedPosterUrl = baseRow.poster_url;
        setPhotoUri(null);
        setPhotoPath(savedPosterPath);
        setPosterUrl(savedPosterUrl);
        setPhotoStepCollapsed(false);
        setUsePhotoAsFinal(Boolean(savedPosterPath || savedPosterUrl));
        setMerchantOriginalWarningAcknowledged(false);
        setGeneratedAd(null);
        setImageVersions([]);
        setAdAccepted(false);
        setApprovedComposedPresentationHash(null);
        setApprovedLocalizationApprovalHash(null);
        aiDraftBaselineRef.current = null;
        setEditDirtyBaseline(
          buildDealFormDirtySnapshot({
            photoUri: null,
            photoPath: savedPosterPath,
            posterUrl: savedPosterUrl,
            generatedPosterPath: null,
            hintText,
            price,
            title,
            promoLine,
            posterHeadlineText,
            posterSublineText,
            ctaText,
            description,
            dealEligibility: JSON.stringify(eligibilityForm),
            maxClaims,
            cutoffMins,
            validityMode,
            startTime: start,
            endTime: end,
            daysOfWeek,
            windowStart,
            windowEnd,
            timezone,
            publishLocationIds,
            hasGeneratedAd: false,
            adAccepted: false,
          }),
        );
      }
      await markRecentPublish(title.trim());
      setAllowPostPublishNavigation(true);
      await new Promise((resolve) => setTimeout(resolve, 700));
      router.replace("/(tabs)/dashboard");
    } catch (err: unknown) {
      setAllowPostPublishNavigation(false);
      const detail = publishErrorDetail(err);
      const message = detail
        ? `${t("createAi.errPublishFailed")} ${detail}`
        : t("createAi.errPublishFailed");
      showPublishError(message);
    } finally {
      setPublishing(false);
      publishInFlightRef.current = false;
    }
  }

  async function saveTemplate() {
    if (!businessId) {
      setBanner({ message: t("createAi.errCreateBusinessFirst"), tone: "error" });
      return;
    }
    if (!canPublish) {
      setBanner({ message: t("createAi.errPublishDraftFirst"), tone: "error" });
      return;
    }
    const priceNum = parseOptionalPriceInput(price);
    if (priceNum !== null && Number.isNaN(priceNum)) {
      setBanner({ message: t("createAi.errPriceNumber"), tone: "error" });
      return;
    }
    if (blockIneligibleOffer("save_template")) return;
    setSavingTemplate(true);
    setBanner(null);
    try {
      const path = await ensureUploadedPhoto();
      const signedPoster = await ensurePosterUrl(path);
      const maxClaimsNum = Number(maxClaims);
      const cutoffNum = Number(cutoffMins);
      const isRecurring = validityMode === "recurring";
      const composedDescription = composeListingDescription(promoLine, ctaText, description);
      const userPhotoStoragePath = path ?? extractDealPhotoStoragePath(posterUrl);
      const storagePath = resolveCurrentDealPosterStoragePath({
        aiPosterStoragePath: imageVersionStoragePath(generatedAd),
        uploadedPhotoStoragePath: userPhotoStoragePath,
        posterUrl,
        allowPhotoFallback: usePhotoAsFinal,
      });
      const durablePoster = storagePath ? buildPublicDealPhotoUrl(storagePath) : null;
      const explicitPhotoPoster = usePhotoAsFinal ? signedPoster ?? posterUrl ?? null : null;

      const { error } = await supabase.from("deal_templates").insert({
        business_id: businessId,
        title: title.trim(),
        description: composedDescription.trim(),
        price: priceNum,
        poster_url: durablePoster ?? explicitPhotoPoster,
        poster_storage_path: storagePath ?? null,
        max_claims: maxClaimsNum,
        claim_cutoff_buffer_minutes: cutoffNum,
        is_recurring: isRecurring,
        days_of_week: isRecurring ? daysOfWeek : null,
        window_start_minutes: isRecurring ? minutesFromDate(windowStart) : null,
        window_end_minutes: isRecurring ? minutesFromDate(windowEnd) : null,
        timezone: isRecurring ? timezone : null,
      });
      if (error) throw error;
      setBanner({ message: t("createAi.templateSaved"), tone: "success" });
    } catch {
      setBanner({ message: t("createAi.errSaveTemplateFailed"), tone: "error" });
    } finally {
      setSavingTemplate(false);
    }
  }

  // `isLoggedIn`/`businessId` both start falsy while useBusiness() resolves, so
  // without this gate a signed-in merchant sees "Please log in to create deals."
  // for the length of the business fetch every time this screen mounts.
  if (businessLoading) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (!isLoggedIn) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3, color: theme.text }}>{t("createAi.titleScreen")}</Text>
        <Text style={{ marginTop: Spacing.md, opacity: 0.7, color: theme.text }}>{t("createAi.loginPrompt")}</Text>
      </View>
    );
  }

  if (!businessId) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3, color: theme.text }}>{t("createAi.titleScreen")}</Text>
        <Text style={{ marginTop: Spacing.md, opacity: 0.7, color: theme.text }}>{t("createAi.needBusiness")}</Text>
      </View>
    );
  }

  if (dealIdFromRoute && dealEditLoading) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.primary} />
        <Text style={{ marginTop: Spacing.md, opacity: 0.7, color: theme.text }}>{t("createAi.loadingDeal")}</Text>
      </View>
    );
  }

  const selectedPhotoUri = photoUri ?? posterUrl ?? (photoPath ? buildPublicDealPhotoUrl(photoPath) : null);
  const currentAdStoragePath = imageVersionStoragePath(generatedAd);
  const adImageUri = currentAdStoragePath
    ? buildPublicDealPhotoUrl(currentAdStoragePath)
    : usePhotoAsFinal ? selectedPhotoUri : null;
  const showPosterFormat = creativeFormat === "poster_v1" || previewFormat === "poster_v1";
  const originalStoragePath = photoPath ?? extractDealPhotoStoragePath(posterUrl);
  const currentImageVersionId = generatedAd ? imageVersionId(generatedAd) : null;
  const selectedPosterTemplateId: PosterTemplateId = FIXED_POSTER_TEMPLATE_ID;
  // Built with the same inputs the publish path uses so the poster preview
  // always shows exactly what will publish — including live headline/subheadline
  // edits. The stale generated spec is only a fallback when no offer exists.
  const livePosterPreviewSpec =
    showPosterFormat && offerDefinition
      ? buildPosterSpecFromOfferDefinition({
          definition: offerDefinition,
          enabled: true,
          templateId: selectedPosterTemplateId,
          sourceAssetPath: currentAdStoragePath ?? originalStoragePath ?? null,
          renderedAssetPath: null,
          headline: posterHeadlineText.trim() || title.trim() || generatedAd?.headline || null,
          subline: posterSublineText.trim() || null,
          sourceLocale: publishSourceLocale,
          businessCategory: businessContextForAi.category,
          compositionPlan: generatedAd?.poster?.composition_plan ?? generatedAd?.item_research?.description ?? null,
        })
      : null;
  const effectivePosterSpec = showPosterFormat ? livePosterPreviewSpec ?? generatedAd?.poster ?? null : null;
  const liveReviewDraft = buildAiDealReviewDraft({
    generatedAd,
    title,
    promoLine,
    ctaText,
    poster: effectivePosterSpec,
    sourceLocale: publishSourceLocale,
    offerDefinition,
  });
  const reviewGeneratedAd = liveReviewDraft.ad;
  const posterHeadlineEditCheck = checkMerchantPosterHeadline(posterHeadlineText);
  const posterSublineEditCheck = checkMerchantPosterSubline(posterSublineText);
  const showPosterPreview = Boolean(effectivePosterSpec);
  const posterPreviewImageUri = adImageUri ?? selectedPhotoUri;
  const originalImageAd = generatedAd ? buildOriginalPhotoVersionAd(generatedAd, originalStoragePath) : null;
  const originalImageVersion = originalImageAd ? buildImageVersionEntry(originalImageAd, "original") : null;
  const composedAdPreviewEnabled =
    isAiV4ComposedAdCardEnabled() ||
    isAiV4SharedRendererEnabled() ||
    isAiV4AuthoritativeOfferCardEnabled();
  const composedPresentationResolverEnabled = composedAdPreviewEnabled && isAiV4PresentationResolverEnabled();
  const composedMinimalInputEnabled = composedAdPreviewEnabled && isAiV4MinimalInputFlowEnabled();
  const composedInstantStyleAlternatesEnabled = composedAdPreviewEnabled && isAiV4InstantStyleAlternatesEnabled();
  const composedCompositeQaEnabled = composedAdPreviewEnabled && isAiV4CompositeQaEnabled();
  const composedScreenshotQaEnabled = composedAdPreviewEnabled && isAiV4CompositeScreenshotQaEnabled();
  const composedExactPresentationApprovalEnabled = composedAdPreviewEnabled && isAiV4ExactPresentationApprovalEnabled();
  const ownerLanguagePreviewAvailable = Boolean(
    localizedOwnerUiEnabled &&
      offerDefinition &&
      reviewGeneratedAd?.localization_bundle,
  );
  const localePresentationOverridesEnabled =
    ownerLanguagePreviewAvailable && isAiV5LocalePresentationOverridesEnabled();
  const localeScreenshotQaEnabled =
    ownerLanguagePreviewAvailable && isAiV5LocaleScreenshotQaEnabled();
  const activeMerchantPreviewLocale = publishSourceLocale;
  const ownerLanguagePreview = buildOwnerLanguagePreview({
    generatedAd: reviewGeneratedAd,
    offerDefinition,
    sourceLocale: reviewGeneratedAd?.localization_bundle?.sourceLocale ?? publishSourceLocale,
    previewLocale: activeMerchantPreviewLocale,
    localizedPreviewEnabled: ownerLanguagePreviewAvailable,
    fallbackOfferLine: reviewGeneratedAd?.locked_offer_line || offerContract?.canonicalOfferLine || title || promoLine,
    fallbackTermsLine: reviewGeneratedAd?.locked_terms_line || offerContract?.canonicalShortTerms || description,
    fallbackCtaLabel: ctaText,
  });
  const composedOfferFacts = ownerLanguagePreview.offerFacts;
  const composedCopy = ownerLanguagePreview.copy;
  const composedMerchant = buildMerchantIdentity({
    businessName,
    locationName: businessProfile?.location,
    addressLine: businessProfile?.address ?? businessProfile?.location ?? null,
  });
  const composedLiveState = {
    status: "live" as const,
    statusLabel: t("dealStatus.live"),
    quantityRemainingLabel: `${t("createAi.maxClaimsLabel")} ${maxClaims}`.trim(),
    timeRemainingLabel: displayScheduleSummary,
    claimAvailable: true,
  };
  const composedImageSourceType: AdImageSourceType = adImageUri
    ? imageSourceTypeFromGeneratedAd(generatedAd) === "deterministic_fallback"
      ? "merchant_original"
      : imageSourceTypeFromGeneratedAd(generatedAd)
    : "deterministic_fallback";
  const composedImageQa = sourceAwareQaFromSelectionQa(
    generatedAd?.image_selection?.qa,
    composedImageSourceType,
    Boolean(adImageUri),
  );
  const composedImageSafeZones = buildImageSafeZoneResult({
    hasImage: Boolean(adImageUri),
    imageSourceType: composedImageSourceType,
    imageQa: composedImageQa,
    cropSuitabilityScore: cropSuitabilityScoreForQa(composedImageQa),
  });
  const composedBasePresentation = buildDefaultAdPresentationSpec({
    imageAssetId: currentAdStoragePath ?? originalStoragePath ?? adImageUri ?? null,
    imageSourceType: composedImageSourceType,
    templateId: "split_offer_panel",
    themeId: colorScheme === "dark" ? "dark_neutral" : "light_neutral",
    resolutionReasonCodes: adImageUri ? ["MERCHANT_PREVIEW_IMAGE"] : ["MERCHANT_PREVIEW_FALLBACK"],
  });
  const composedPresentationResolution = composedPresentationResolverEnabled
    ? resolveAdPresentation({
        approvedCopy: composedCopy,
        lockedOfferContent: composedOfferFacts,
        merchantIdentity: composedMerchant,
        imageQa: composedImageQa,
        imageSafeZones: composedImageSafeZones,
        creativeStrategy: reviewGeneratedAd?.item_research?.description ?? reviewGeneratedAd?.headline ?? hintText,
        liveStateCapabilities: {
          supportsQuantityRemaining: true,
          supportsTimeRemaining: true,
        },
        targetSurface: "merchant_preview",
        imageAssetId: currentAdStoragePath ?? originalStoragePath ?? adImageUri ?? null,
        imageSourceType: composedImageSourceType,
        themeId: colorScheme === "dark" ? "dark_neutral" : "light_neutral",
      })
    : null;
  const composedPresentationOptions = composedPresentationResolution
    ? [composedPresentationResolution.recommended, ...composedPresentationResolution.alternates]
    : [composedBasePresentation];
  const selectedBaseComposedPresentation =
    composedPresentationOptions[Math.min(composedStyleIndex, Math.max(0, composedPresentationOptions.length - 1))] ??
    composedBasePresentation;
  const selectedLocalePresentationResolution =
    localePresentationOverridesEnabled && reviewGeneratedAd?.localization_bundle
      ? resolveLocalePresentationOverrides({
          basePresentation: selectedBaseComposedPresentation,
          localizationBundle: reviewGeneratedAd.localization_bundle,
          merchantIdentity: composedMerchant,
        })
      : null;
  const selectedComposedPresentation =
    selectedLocalePresentationResolution?.presentation ?? selectedBaseComposedPresentation;
  const selectedPresentationReviewContext = buildLiveAdPresentationReviewContext({
    creativeFormat: showPosterFormat ? "poster_v1" : "standard_card",
    sourceLocale: publishSourceLocale,
    title,
    promoLine,
    ctaText,
    description,
    poster: effectivePosterSpec,
  });
  const selectedComposedPresentationHash = createAdPresentationHash({
    presentation: selectedComposedPresentation,
    offerFacts: composedOfferFacts,
    copy: composedCopy,
    reviewContext: selectedPresentationReviewContext,
  });
  const selectedComposedCompositeQa = runDeterministicAdCompositeQa({
    offerFacts: composedOfferFacts,
    merchant: composedMerchant,
    copy: composedCopy,
    presentation: selectedComposedPresentation,
    liveState: composedLiveState,
    surface: "merchant_preview",
    imageUri: adImageUri,
    selectedImageAssetId: currentAdStoragePath ?? originalStoragePath ?? selectedComposedPresentation.imageAssetId,
    imageSafeZoneConfidence: composedImageSafeZones.confidence,
  });
  const selectedComposedScreenshotQaSnapshot = buildComposedScreenshotQaSnapshot(
    selectedComposedCompositeQa,
    composedScreenshotQaEnabled,
  );
  const selectedLocaleScreenshotQaTriggerLocales =
    localeScreenshotQaEnabled ? selectedLocalePresentationResolution?.screenshotQaTriggerLocales ?? [] : [];
  const selectedLocaleScreenshotQaRequired = selectedLocaleScreenshotQaTriggerLocales.length > 0;
  const selectedComposedScreenshotQaRequired =
    selectedComposedScreenshotQaSnapshot.required || selectedLocaleScreenshotQaRequired;
  // Distinguish a provider-supplied bundle from the deterministic bundle the
  // live review snapshot creates when generation returned none. Both follow
  // the same approval path; this flag preserves the provenance distinction.
  const generatedAdLocalizationBundleAvailable =
    ownerLanguagePreviewAvailable &&
    offerDefinition &&
    generatedAd?.localization_bundle;
  const selectedReviewLocalizationBundle = reviewGeneratedAd?.localization_bundle ?? null;
  const selectedLocalizationApproval =
    (generatedAdLocalizationBundleAvailable ||
      (ownerLanguagePreviewAvailable && offerDefinition && selectedReviewLocalizationBundle))
      ? buildVerifiedAdLocalizationApproval({
          bundle: selectedReviewLocalizationBundle,
          offerDefinition,
          presentationHash: selectedComposedPresentationHash,
          selectedImageAssetId: selectedComposedPresentation.imageAssetId,
          providerStatus: reviewGeneratedAd?.localization_status ?? null,
          localePresentationOverrides: selectedComposedPresentation.localeOverrides ?? null,
          screenshotQaRequired: selectedComposedScreenshotQaRequired,
        })
      : null;
  const shouldBindComposedPresentationApproval =
    composedAdPreviewEnabled ||
    Boolean(automaticLocalizationApprovalEnabled && ownerLanguagePreviewAvailable);
  const composedPresentationApprovalMatches =
    approvedComposedPresentationHash === selectedComposedPresentationHash &&
    selectedComposedCompositeQa.decision !== "block" &&
    selectedComposedCompositeQa.decision !== "unavailable" &&
    !selectedComposedScreenshotQaRequired;
  const selectedLocalizationApprovalMatches =
    selectedLocalizationApproval?.approved === true &&
    approvedLocalizationApprovalHash === selectedLocalizationApproval.approval.approvalHash;
  const liveReviewApprovalRequired =
    composedExactPresentationApprovalEnabled ||
    Boolean(automaticLocalizationApprovalEnabled && ownerLanguagePreviewAvailable);
  const acceptedDraftRequiresReapproval = Boolean(
    generatedAd &&
      adAccepted &&
      ((liveReviewApprovalRequired && !composedPresentationApprovalMatches) ||
        (automaticLocalizationApprovalEnabled &&
          ownerLanguagePreviewAvailable &&
          !selectedLocalizationApprovalMatches)),
  );
  const canTryComposedStyle = composedInstantStyleAlternatesEnabled && composedPresentationOptions.length > 1;
  // Single-variant flow (Dan 2026-07-08): the multi-variant copy picker is gone,
  // so the "Ask AI for changes" refine panel is always visible under the preview
  // (the merchant refines the one variant by comment instead of picking angles).
  const showComposedRevisePanel = !adAccepted;
  const canCompareImages = Boolean(
    selectedPhotoUri &&
      adImageUri &&
      originalImageVersion &&
      originalStoragePath &&
      currentAdStoragePath &&
      originalStoragePath !== currentAdStoragePath,
  );
  const restorableImageVersions = imageVersions.filter((entry) => entry.id !== currentImageVersionId);
  const imageVersionLabel = (entry: ImageVersionEntry, index: number) => {
    if (entry.kind === "original") {
      return t("createAi.imageCompareOriginal", { defaultValue: "Original photo" });
    }
    if (entry.kind === "revision") {
      return t("createAi.imageVersionRevision", {
        number: index + 1,
        defaultValue: `Revision ${index + 1}`,
      });
    }
    if (entry.kind === "fallback") {
      return t("createAi.imageVersionFallback", { defaultValue: "Fallback image" });
    }
    return t("createAi.imageVersionGenerated", { defaultValue: "Generated image" });
  };
  const revisionsLeft = Math.max(0, SOFT_REVISION_CAP - revisionsUsed);
  const revisionsLeftLabel =
    revisionsLeft === 0
      ? t("createAi.reviseRevisionsNoneLeft")
      : revisionsLeft === 1
        ? t("createAi.reviseRevisionsLeftSingular")
        : t("createAi.reviseRevisionsLeftPlural", { count: revisionsLeft });
  const canReviseAd = revisionsLeft > 0 && !revising && !generating && !cooldownActive;
  const renderPosterPreview = () => {
    if (!effectivePosterSpec) return null;
    return (
      <View
        style={{
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colorScheme === "dark" ? "#334155" : theme.border,
          backgroundColor: colorScheme === "dark" ? "#020617" : theme.surface,
          overflow: "hidden",
        }}
      >
        <AdPosterCanvas
          spec={effectivePosterSpec}
          imageUri={posterPreviewImageUri}
          templateId={selectedPosterTemplateId}
          liveScheduleLabel={posterLiveScheduleLabel}
          eyebrowLabel={posterEyebrowLabel}
          contentLocale={supportedLocaleOrDefault(i18n.language)}
          // S4: the merchant must preview the same name the shopper will see, or preview
          // and publish disagree — a §7 hard fail.
          merchantName={businessName}
        />
      </View>
    );
  };
  const progressRevisionTarget = revisionFeedback.trim()
    ? copyOnlyRevisionTargetForFeedback(revisionTarget, revisionFeedback)
    : revisionTarget;
  const revisionProgressMessageKey =
    progressRevisionTarget === "copy"
      ? "createAi.revisingCopyMessage"
      : progressRevisionTarget === "image"
        ? "createAi.revisingImageMessage"
        : "createAi.revisingBothMessage";
  const revisionProgressHintKey =
    progressRevisionTarget === "copy"
      ? "createAi.revisingCopyHint"
      : progressRevisionTarget === "image"
        ? "createAi.revisingImageHint"
        : "createAi.revisingBothHint";
  const targetLabel: Record<RevisionTarget, string> = {
    copy: t("createAi.reviseTargetCopy"),
    image: t("createAi.reviseTargetImage"),
    both: t("createAi.reviseTargetBoth"),
  };
  const revisionSuggestionOptions: RevisionSuggestion[] = [
    {
      key: "top_headline",
      target: "copy",
      label: t("createAi.reviseSuggestionTopHeadline", { defaultValue: "Fix top headline" }),
      feedback: t("createAi.reviseSuggestionTopHeadlineFeedback", {
        defaultValue: "Change the top headline so it sounds like a real ad based on the full offer.",
      }),
    },
    {
      key: "shorter",
      target: "copy",
      label: t("createAi.reviseSuggestionShorter", { defaultValue: "Make it shorter" }),
      feedback: t("createAi.reviseSuggestionShorterFeedback", {
        defaultValue: "Make the copy shorter and clearer without changing the offer.",
      }),
    },
    {
      key: "warmer",
      target: "copy",
      label: t("createAi.reviseSuggestionWarmer", { defaultValue: "Warmer tone" }),
      feedback: t("createAi.reviseSuggestionWarmerFeedback", {
        defaultValue: "Make the wording warmer and more inviting while keeping the offer facts exact.",
      }),
    },
    {
      key: "new_image",
      target: "image",
      label: t("createAi.reviseSuggestionNewImage", { defaultValue: "New image angle" }),
      feedback: t("createAi.reviseSuggestionNewImageFeedback", {
        defaultValue: "Try a different image angle with cleaner composition and no text in the image.",
      }),
    },
  ];
  function applyRevisionSuggestion(suggestion: RevisionSuggestion) {
    setRevisionTarget(suggestion.target);
    setRevisionFeedback(suggestion.feedback);
    trackEvent(AiAdsEvents.REVISION_SUGGESTION_SELECTED, {
      screen: "create_ai",
      suggestion_key: suggestion.key,
      revision_target: suggestion.target,
      revision_count: revisionsUsed,
    });
  }
  const iosSchedulePickerTitle =
    iosSchedulePicker === "start"
      ? t("createAi.startTime", { defaultValue: "Start date and time" })
      : iosSchedulePicker === "end"
        ? t("createAi.endTime", { defaultValue: "End date and time" })
        : iosSchedulePicker === "windowStart"
          ? t("createAi.windowStart", { defaultValue: "Daily start" })
          : iosSchedulePicker === "windowEnd"
            ? t("createAi.windowEnd", { defaultValue: "Daily end" })
            : t("createAi.validity", { defaultValue: "Deal schedule" });
  const iosSchedulePickerMode =
    iosSchedulePicker === "windowStart" || iosSchedulePicker === "windowEnd" ? "time" : "datetime";

  function setOneTimeStartTime(nextStartTime: Date) {
    const nextSchedule = createOneTimeDealScheduleFromStart(nextStartTime);
    setStartTime(nextSchedule.startTime);
    setEndTime(nextSchedule.endTime);
  }

  function openIosSchedulePicker(target: IosSchedulePickerTarget, value: Date) {
    setIosScheduleDraft(value);
    setIosSchedulePicker(target);
  }

  function cancelIosSchedulePicker() {
    setIosSchedulePicker(null);
  }

  function confirmIosSchedulePicker() {
    if (!iosSchedulePicker) return;
    if (iosSchedulePicker === "start") {
      setOneTimeStartTime(iosScheduleDraft);
    } else if (iosSchedulePicker === "end") {
      setEndTime(iosScheduleDraft);
    } else if (iosSchedulePicker === "windowStart") {
      setSchedulePreset(null);
      setWindowStart(iosScheduleDraft);
    } else {
      setSchedulePreset(null);
      setWindowEnd(iosScheduleDraft);
    }
    setIosSchedulePicker(null);
  }

  return (
    <KeyboardScreen style={{ backgroundColor: theme.background }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: theme.background }}
        {...FORM_SCROLL_KEYBOARD_PROPS}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: top,
          paddingHorizontal: horizontal,
          paddingBottom: scrollBottom + Spacing.xxxl * 2,
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: "700", letterSpacing: -0.3, color: theme.text }}>
          {editingDealId ? t("createAi.titleEdit") : t("createAi.titleMain")}
        </Text>
        <Text
          style={{ marginTop: 4, opacity: 0.65, fontSize: 13, lineHeight: 18, color: theme.text }}
          maxFontSizeMultiplier={1.12}
        >
          {t("createAi.intro")}
        </Text>

        {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}
        {dealLoadError ? <Banner message={dealLoadError} tone="error" onRetry={() => setDealLoadNonce((n) => n + 1)} /> : null}
        {pendingRecoveredDraft ? (
          <View
            style={{
              marginTop: 14,
              padding: 14,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.primary,
              backgroundColor: PrimaryTint.surface,
              gap: 10,
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 16, color: theme.accentText }}>
              {t("createAi.recoverDraftTitle", { defaultValue: "Finish your deal?" })}
            </Text>
            <Text style={{ color: theme.mutedText, lineHeight: 20 }}>
              {t("createAi.recoverDraftBody", {
                defaultValue: "We found an unfinished ad draft for this business.",
              })}
            </Text>
            <PrimaryButton
              title={t("createAi.continueDraft", { defaultValue: "Continue draft" })}
              onPress={() => applyRecoveredDraft(pendingRecoveredDraft)}
            />
            <SecondaryButton
              title={t("createAi.startOverDraft", { defaultValue: "Start over" })}
              onPress={() => {
                setPendingRecoveredDraft(null);
                void clearAiRecoveryDraft();
                setBanner({
                  message: t("createAi.draftClearedBanner", { defaultValue: "Draft cleared. Start a fresh deal when you're ready." }),
                  tone: "info",
                });
              }}
            />
          </View>
        ) : null}

        {showCamera ? (
          <View style={{ marginTop: 16, borderRadius: 16, overflow: "hidden" }}>
            <CameraView ref={cameraRef} style={{ height: 360, width: "100%" }} facing="back" />
            <View style={{ padding: 12, backgroundColor: Gray[900] }}>
              <PrimaryButton title={t("createAi.capturePhoto")} onPress={capturePhoto} />
              <View style={{ marginTop: 8 }}>
                <SecondaryButton title={t("createAi.cancel")} onPress={() => setShowCamera(false)} />
              </View>
            </View>
          </View>
        ) : (
          <>
            <StepBadge n={1} total={3} t={t} />
            <Text style={{ marginTop: 10, fontWeight: "700", fontSize: 16, color: theme.text }}>{t("createAi.adFormatTitle")}</Text>
            <View
              style={{
                flexDirection: "row",
                marginTop: 8,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 8,
                overflow: "hidden",
                backgroundColor: theme.surface,
              }}
            >
              {(["standard_card", "poster_v1"] as CreativeFormat[]).map((format, index) => {
                const selected = creativeFormat === format;
                const iconName = format === "poster_v1" ? "crop-portrait" : "view-agenda";
                return (
                  <Pressable
                    key={format}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => selectCreativeFormat(format)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      minHeight: 48,
                      borderRightWidth: index === 0 ? 1 : 0,
                      borderRightColor: theme.border,
                      backgroundColor: selected ? PrimaryTint.surface : theme.surface,
                      paddingVertical: 9,
                      paddingHorizontal: 8,
                      justifyContent: "center",
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }}>
                      <MaterialIcons
                        name={iconName}
                        size={18}
                        color={selected ? theme.primary : theme.icon}
                      />
                      <Text
                        style={{
                          minWidth: 0,
                          color: selected ? theme.accentText : theme.text,
                          fontWeight: "800",
                          fontSize: 14,
                          textAlign: "center",
                        }}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.82}
                      >
                        {format === "poster_v1" ? t("createAi.adFormatPoster") : t("createAi.adFormatStandard")}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{ marginTop: 10, fontWeight: "700", fontSize: 16, color: theme.text }}>{t("createAi.photo")}</Text>
            {/* Both buttons default to width:100%; flex wrappers keep the row inside the viewport. */}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <View style={{ flex: 1 }}>
                <PrimaryButton title={t("createAi.takePhoto")} onPress={takePhoto} />
              </View>
              <View style={{ flex: 1 }}>
                <SecondaryButton title={t("createAi.pickPhoto")} onPress={pickPhotoFromLibrary} />
              </View>
            </View>
            {!selectedPhotoUri && !photoStepCollapsed ? (
              <Pressable
                onPress={skipPhotoToDescription}
                accessibilityRole="button"
                accessibilityLabel={t("createAi.skipPhoto", { defaultValue: "Skip photo" })}
                style={{
                  minHeight: 44,
                  marginTop: 6,
                  alignSelf: "flex-start",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Text style={{ color: theme.accentText, fontWeight: "800", fontSize: 14 }}>
                  {t("createAi.skipPhoto", { defaultValue: "Skip photo" })}
                </Text>
                <MaterialIcons name="arrow-forward" size={18} color={theme.accentText} />
              </Pressable>
            ) : null}

            {selectedPhotoUri ? (
              <Image
                source={{ uri: selectedPhotoUri }}
                style={{ height: 260, width: "100%", borderRadius: 18, marginTop: 12 }}
                contentFit="cover"
              />
            ) : null}

            {selectedPhotoUri ? (
              <View style={{ marginTop: 14 }}>
                <View
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: usePhotoAsFinal ? theme.primary : theme.border,
                    backgroundColor: usePhotoAsFinal ? PrimaryTint.surface : theme.surfaceMuted,
                    marginBottom: 12,
                    gap: 8,
                  }}
                >
                  <Text style={{ fontWeight: "800", color: usePhotoAsFinal ? theme.accentText : theme.text }}>
                    {usePhotoAsFinal
                      ? t("createAi.actualPhotoFinalSelected", { defaultValue: "Actual photo selected as final ad" })
                      : t("createAi.photoGuidanceSelected", { defaultValue: "Used for AI guidance" })}
                  </Text>
                  <Text style={{ fontSize: 12, lineHeight: 17, color: theme.mutedText }}>
                    {usePhotoAsFinal
                      ? t("createAi.actualPhotoFinalHelp", {
                          defaultValue: "Twofer will publish this photo unless you generate a new AI ad.",
                        })
                      : t("createAi.photoGuidanceHelp", {
                          defaultValue: "Twofer uses this photo to understand the item, then creates a polished ad.",
                        })}
                  </Text>
                  <SecondaryButton
                    title={
                      usePhotoAsFinal
                        ? t("createAi.usePhotoAsGuidance", { defaultValue: "Use for AI guidance instead" })
                        : t("createAi.useActualPhotoAsFinal", { defaultValue: "Use actual photo as final ad" })
                    }
                    onPress={() => {
                      const nextUseAsFinal = !usePhotoAsFinal;
                      setUsePhotoAsFinal(nextUseAsFinal);
                      setMerchantOriginalWarningAcknowledged(false);
                      if (nextUseAsFinal) {
                        setUseCustomImageEdit(false);
                        if (generatedAd) resetGenerationState();
                        setManualDraftUnlocked(true);
                      }
                    }}
                  />
                  {usePhotoAsFinal ? (
                    <Pressable
                      onPress={() => setMerchantOriginalWarningAcknowledged((value) => !value)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: merchantOriginalWarningAcknowledged }}
                      style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        gap: 8,
                        padding: 10,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: merchantOriginalWarningAcknowledged ? theme.primary : theme.border,
                        backgroundColor: colorScheme === "dark" ? theme.surface : "#fff",
                      }}
                    >
                      <MaterialIcons
                        name={merchantOriginalWarningAcknowledged ? "check-box" : "check-box-outline-blank"}
                        size={22}
                        color={merchantOriginalWarningAcknowledged ? theme.primary : theme.mutedText}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: theme.text, lineHeight: 18 }}>
                          {t("createAi.originalPhotoAckLabel")}
                        </Text>
                        <Text style={{ marginTop: 2, fontSize: 12, lineHeight: 17, color: theme.mutedText }}>
                          {t("createAi.originalPhotoAckHelper")}
                        </Text>
                      </View>
                    </Pressable>
                  ) : null}
                </View>
                <Text style={{ fontWeight: "700", fontSize: 14, marginBottom: 6, color: theme.text }}>{t("createAi.photoPolishTitle")}</Text>
                <Text style={{ opacity: 0.7, fontSize: 12, marginBottom: 8, color: theme.text }}>
                  {t("createAi.photoPolishHelp")}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {PHOTO_TREATMENT_OPTIONS.map((opt) => {
                    const selected = !useCustomImageEdit && photoTreatment === opt.key;
                    return (
                      <Pressable
                        key={opt.key}
                        onPress={() => {
                          if (!useCustomImageEdit && opt.key === photoTreatment) return;
                          setUseCustomImageEdit(false);
                          setPhotoTreatment(opt.key);
                          // Stale-ad guard: changing the treatment after generating means the
                          // displayed ad no longer reflects the chosen polish.
                          if (generatedAd) resetGenerationState();
                        }}
                        style={{
                          flexGrow: 1,
                          flexBasis: "47%",
                          minWidth: 130,
                          paddingVertical: 10,
                          paddingHorizontal: 8,
                          borderRadius: 12,
                          backgroundColor: selected ? theme.primary : theme.surfaceMuted,
                          borderWidth: selected ? 0 : 1,
                          borderColor: theme.border,
                        }}
                      >
                        <Text style={{ fontWeight: "700", fontSize: 13, color: selected ? theme.primaryText : colorScheme === "dark" ? theme.text : Gray[700], textAlign: "center" }}>
                          {t(opt.labelKey)}
                        </Text>
                        <Text style={{ marginTop: 2, fontSize: 11, color: selected ? theme.primaryText : theme.mutedText, textAlign: "center" }}>
                          {t(opt.helperKey)}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    onPress={() => {
                      if (!useCustomImageEdit) {
                        setUseCustomImageEdit(true);
                        if (generatedAd) resetGenerationState();
                      }
                      requestAnimationFrame(() => customImageEditInputRef.current?.focus());
                    }}
                    style={{
                      flexGrow: 1,
                      flexBasis: "47%",
                      minWidth: 130,
                      paddingVertical: 10,
                      paddingHorizontal: 8,
                      borderRadius: 12,
                      backgroundColor: useCustomImageEdit ? theme.primary : theme.surfaceMuted,
                      borderWidth: useCustomImageEdit ? 0 : 1,
                      borderColor: theme.border,
                    }}
                  >
                    <Text style={{ fontWeight: "700", fontSize: 13, color: useCustomImageEdit ? theme.primaryText : colorScheme === "dark" ? theme.text : Gray[700], textAlign: "center" }}>
                      {t("createAi.treatmentCustomLabel")}
                    </Text>
                    <Text style={{ marginTop: 2, fontSize: 11, color: useCustomImageEdit ? theme.primaryText : theme.mutedText, textAlign: "center" }}>
                      {t("createAi.treatmentCustomHelper")}
                    </Text>
                  </Pressable>
                </View>
                {useCustomImageEdit && !usePhotoAsFinal ? (
                  <TextInput
                    ref={customImageEditInputRef}
                    value={customImageEditInstruction}
                    onChangeText={(text) => {
                      setCustomImageEditInstruction(text);
                      // Typing here must NOT drop the generated ad: resetGenerationState()
                      // nulls generatedAd, which collapses the review UI back to Step 1
                      // mid-keystroke and leaves this field holding one character. The
                      // instruction only needs to be applied on the next Generate, so just
                      // un-accept the draft (keeps the image visible) like the copy fields.
                      invalidateAcceptedAdDraft();
                    }}
                    placeholder={t("createAi.customImageEditPlaceholder")}
                    placeholderTextColor={theme.mutedText}
                    inputAccessoryViewID={IOS_DONE_INPUT_ACCESSORY_ID}
                    maxLength={400}
                    multiline
                    style={{
                      marginTop: 10,
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 12,
                      padding: 12,
                      minHeight: 54,
                      backgroundColor: theme.surface,
                      color: theme.text,
                      fontSize: 13,
                    }}
                  />
                ) : null}
              </View>
            ) : null}

            <View
              onLayout={(e) => {
                descriptionSectionYRef.current = e.nativeEvent.layout.y;
              }}
              style={{ marginTop: 12 }}
            >
              <StepBadge n={2} total={3} t={t} />
            </View>
            <Text style={{ marginTop: 8, fontWeight: "700", color: theme.text }}>{t("createAi.dealDescriptionLabel")}</Text>
            <Text style={{ marginTop: 3, color: theme.mutedText, fontSize: 12, lineHeight: 16 }} numberOfLines={2}>
              {selectedPhotoUri ? t("createAi.dealDescriptionHelpWithPhoto") : t("createAi.dealDescriptionHelpNoPhoto")}
            </Text>
            <View style={{ marginTop: 6 }}>
              <TextInput
                ref={hintInputRef}
                value={hintText}
                onChangeText={handleHintTextChange}
                placeholder={selectedPhotoUri ? t("createAi.hintPlaceholder") : t("createAi.hintPlaceholderNoPhoto")}
                placeholderTextColor={theme.mutedText}
                multiline
                style={{
                  borderWidth: 1,
                  borderColor: isRecording ? theme.danger : theme.border,
                  borderRadius: 14,
                  padding: 12,
                  paddingRight: Platform.OS !== "web" ? 54 : 12,
                  minHeight: 52,
                  backgroundColor: theme.surface,
                  color: theme.text,
                }}
              />
              {Platform.OS !== "web" ? (
                <Pressable
                  onPress={isRecording ? () => void stopRecordingAndTranscribe() : () => void startRecording()}
                  disabled={transcribing}
                  style={{ position: "absolute", right: 8, bottom: 8, width: 40, height: 40, borderRadius: 20, backgroundColor: isRecording ? theme.danger : theme.primary, alignItems: "center", justifyContent: "center" }}
                >
                  {transcribing ? (
                    <ActivityIndicator color={theme.primaryText} size="small" />
                  ) : (
                    <MaterialIcons name={isRecording ? "stop" : "mic"} size={20} color={theme.primaryText} />
                  )}
                </Pressable>
              ) : null}
            </View>

            <Text style={{ marginTop: 8, color: theme.text }}>{t("createAi.priceOptional")}</Text>
            <TextInput
              value={price}
              onChangeText={(value) => setPrice(sanitizeDecimalInput(value))}
              keyboardType="decimal-pad"
              inputAccessoryViewID={IOS_DONE_INPUT_ACCESSORY_ID}
              returnKeyType="done"
              placeholder={t("createAi.placeholderPrice")}
              placeholderTextColor={theme.mutedText}
              style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 10, marginTop: 5, color: theme.text, backgroundColor: theme.surface }}
            />

            <DealEligibilityForm
              value={eligibilityForm}
              onChange={handleEligibilityFormChange}
              t={t}
              theme={theme}
              colorScheme={colorScheme}
              inputAccessoryViewID={IOS_DONE_INPUT_ACCESSORY_ID}
              result={eligibilityResult}
              compact
            />

            {eligibilityResult.eligible ? (
              <>
            <View
              onLayout={(e) => {
                const y = e.nativeEvent.layout.y;
                scheduleSectionYRef.current = y;
                setScheduleSectionY(y);
              }}
              style={{ marginTop: 16 }}
            >
              <StepBadge n={3} total={3} t={t} />
            </View>
            <Text style={{ marginTop: 10, fontWeight: "700", color: theme.text }}>
              {t("createAi.scheduleTitle", { defaultValue: "Schedule" })}
            </Text>
            <Text style={{ marginTop: 4, color: theme.mutedText, fontSize: 12, lineHeight: 17 }}>
              {t("createAi.scheduleHelp", {
                defaultValue: "Choose when customers can claim this deal. Run it once or repeat it weekly.",
              })}
            </Text>
            <Text style={{ marginTop: 4, color: theme.accentText, fontSize: 12, lineHeight: 17, fontWeight: "600" }}>
              {slowHoursPreset
                ? t("createAi.slowHoursNudge", {
                    defaultValue: "Best for filling slower times — try your slow-hours preset under Recurring.",
                  })
                : t("createAi.slowHoursNudgeManual", {
                    defaultValue: "Tip: target the times you actually want more customers. Slower hours work best.",
                  })}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              <Pressable
                onPress={() => setValidityMode("one-time")}
                style={{ maxWidth: "100%", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: validityMode === "one-time" ? theme.primary : theme.surfaceMuted }}
              >
                <Text
                  style={{ color: validityMode === "one-time" ? theme.primaryText : colorScheme === "dark" ? theme.text : Gray[700], fontWeight: "700" }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                  maxFontSizeMultiplier={1.15}
                >
                  {t("createAi.oneTime")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setValidityMode("recurring")}
                style={{ maxWidth: "100%", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: validityMode === "recurring" ? theme.primary : theme.surfaceMuted }}
              >
                <Text
                  style={{ color: validityMode === "recurring" ? theme.primaryText : colorScheme === "dark" ? theme.text : Gray[700], fontWeight: "700" }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                  maxFontSizeMultiplier={1.15}
                >
                  {t("createAi.recurring")}
                </Text>
              </Pressable>
            </View>

            {validityMode === "one-time" ? (
              <>
                <Text style={{ marginTop: 12, color: theme.text }}>{t("createAi.startTime")}</Text>
                <Pressable
                  onPress={() => {
                    if (Platform.OS === "ios") {
                      openIosSchedulePicker("start", startTime);
                    } else {
                      setShowStartPicker(true);
                    }
                  }}
                  style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, backgroundColor: theme.surface }}
                >
                  <Text style={{ color: theme.text }}>{formatAppDateTime(startTime, i18n.language)}</Text>
                </Pressable>
                {showStartPicker ? (
                  Platform.OS === "android" ? (
                    <DateTimePicker
                      value={androidStartDateRef.current ?? startTime}
                      mode={androidStartPickerMode}
                      onChange={(event, date) => {
                        if (event.type === "dismissed" || !date) {
                          setShowStartPicker(false);
                          setAndroidStartPickerMode("date");
                          androidStartDateRef.current = null;
                          return;
                        }
                        if (androidStartPickerMode === "date") {
                          androidStartDateRef.current = date;
                          setAndroidStartPickerMode("time");
                        } else {
                          const picked = androidStartDateRef.current ?? startTime;
                          const merged = new Date(picked);
                          merged.setHours(date.getHours(), date.getMinutes(), 0, 0);
                          setOneTimeStartTime(merged);
                          setShowStartPicker(false);
                          setAndroidStartPickerMode("date");
                          androidStartDateRef.current = null;
                        }
                      }}
                    />
                  ) : Platform.OS === "ios" ? null : (
                    <DateTimePicker
                      value={startTime}
                      mode="datetime"
                      onChange={(_event, date) => { setShowStartPicker(false); if (date) setOneTimeStartTime(date); }}
                    />
                  )
                ) : null}

                <Text style={{ marginTop: 12, color: theme.text }}>{t("createAi.endTime")}</Text>
                <Pressable
                  onPress={() => {
                    if (Platform.OS === "ios") {
                      openIosSchedulePicker("end", endTime);
                    } else {
                      setShowEndPicker(true);
                    }
                  }}
                  style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, backgroundColor: theme.surface }}
                >
                  <Text style={{ color: theme.text }}>{formatAppDateTime(endTime, i18n.language)}</Text>
                </Pressable>
                {showEndPicker ? (
                  Platform.OS === "android" ? (
                    <DateTimePicker
                      value={androidEndDateRef.current ?? endTime}
                      mode={androidEndPickerMode}
                      onChange={(event, date) => {
                        if (event.type === "dismissed" || !date) {
                          setShowEndPicker(false);
                          setAndroidEndPickerMode("date");
                          androidEndDateRef.current = null;
                          return;
                        }
                        if (androidEndPickerMode === "date") {
                          androidEndDateRef.current = date;
                          setAndroidEndPickerMode("time");
                        } else {
                          const picked = androidEndDateRef.current ?? endTime;
                          const merged = new Date(picked);
                          merged.setHours(date.getHours(), date.getMinutes(), 0, 0);
                          setEndTime(merged);
                          setShowEndPicker(false);
                          setAndroidEndPickerMode("date");
                          androidEndDateRef.current = null;
                        }
                      }}
                    />
                  ) : Platform.OS === "ios" ? null : (
                    <DateTimePicker
                      value={endTime}
                      mode="datetime"
                      onChange={(_event, date) => { setShowEndPicker(false); if (date) setEndTime(date); }}
                    />
                  )
                ) : null}
              </>
            ) : (
              <>
                <Text style={{ marginTop: 12, fontWeight: "600", fontSize: 13, opacity: 0.5, color: theme.text }}>{t("createAi.schedulePresetsLabel")}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                  {slowHoursPreset ? (
                    <Pressable
                      onPress={() => {
                        if (schedulePreset === "slow_hours") {
                          setSchedulePreset(null);
                        } else {
                          setSchedulePreset("slow_hours");
                          setDaysOfWeek([...slowHoursPreset.days]);
                          setWindowStart(dateFromMinutes(slowHoursPreset.startMin));
                          setWindowEnd(dateFromMinutes(slowHoursPreset.endMin));
                        }
                      }}
                      style={{ maxWidth: "100%", paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: schedulePreset === "slow_hours" ? theme.primary : theme.surfaceMuted }}
                    >
                      <Text
                        style={{ color: schedulePreset === "slow_hours" ? theme.primaryText : colorScheme === "dark" ? theme.text : Gray[700], fontWeight: "700", fontSize: 13 }}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.78}
                        maxFontSizeMultiplier={1.15}
                      >
                        {t("createAi.presetSlowHours", { defaultValue: "Use your slow hours" })}
                      </Text>
                    </Pressable>
                  ) : null}
                  {SCHEDULE_PRESETS.map((preset) => {
                    const active = schedulePreset === preset.key;
                    return (
                      <Pressable
                        key={preset.key}
                        onPress={() => {
                          if (active) {
                            setSchedulePreset(null);
                          } else {
                            setSchedulePreset(preset.key);
                            setDaysOfWeek([...preset.days]);
                            setWindowStart(dateFromMinutes(preset.startMin));
                            setWindowEnd(dateFromMinutes(preset.endMin));
                          }
                        }}
                        style={{ maxWidth: "100%", paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? theme.primary : theme.surfaceMuted }}
                      >
                        <Text
                          style={{ color: active ? theme.primaryText : colorScheme === "dark" ? theme.text : Gray[700], fontWeight: "700", fontSize: 13 }}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.78}
                          maxFontSizeMultiplier={1.15}
                        >
                          {t(`createAi.preset_${preset.key}`)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={{ marginTop: 12, color: theme.text }}>{t("createAi.days")}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                  {[
                    { label: t("createAi.dayMon"), value: 1 },
                    { label: t("createAi.dayTue"), value: 2 },
                    { label: t("createAi.dayWed"), value: 3 },
                    { label: t("createAi.dayThu"), value: 4 },
                    { label: t("createAi.dayFri"), value: 5 },
                    { label: t("createAi.daySat"), value: 6 },
                    { label: t("createAi.daySun"), value: 7 },
                  ].map((day) => {
                    const selected = daysOfWeek.includes(day.value);
                    return (
                      <Pressable
                        key={day.value}
                        onPress={() => {
                          setSchedulePreset(null);
                          setDaysOfWeek((prev) =>
                            selected ? prev.filter((d) => d !== day.value) : [...prev, day.value],
                          );
                        }}
                        style={{ maxWidth: "100%", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: selected ? theme.primary : theme.surfaceMuted }}
                      >
                        <Text
                          style={{ color: selected ? theme.primaryText : colorScheme === "dark" ? theme.text : Gray[700], fontWeight: "600" }}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.78}
                          maxFontSizeMultiplier={1.15}
                        >
                          {day.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={{ marginTop: 12, color: theme.text }}>{t("createAi.timeWindow")}</Text>
                <Pressable
                  onPress={() => {
                    if (Platform.OS === "ios") {
                      openIosSchedulePicker("windowStart", windowStart);
                    } else {
                      setShowWindowStartPicker(true);
                    }
                  }}
                  style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, backgroundColor: theme.surface }}
                >
                  <Text style={{ color: theme.text }}>{t("createAi.windowStart")} {formatMinutes(minutesFromDate(windowStart))}</Text>
                </Pressable>
                {showWindowStartPicker && Platform.OS !== "ios" ? (
                  <DateTimePicker
                    value={windowStart}
                    mode="time"
                    onChange={(_event, date) => { setShowWindowStartPicker(false); setSchedulePreset(null); if (date) setWindowStart(date); }}
                  />
                ) : null}

                <Pressable
                  onPress={() => {
                    if (Platform.OS === "ios") {
                      openIosSchedulePicker("windowEnd", windowEnd);
                    } else {
                      setShowWindowEndPicker(true);
                    }
                  }}
                  style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, backgroundColor: theme.surface }}
                >
                  <Text style={{ color: theme.text }}>{t("createAi.windowEnd")} {formatPickerTime(windowEnd)}</Text>
                </Pressable>
                {showWindowEndPicker && Platform.OS !== "ios" ? (
                  <DateTimePicker
                    value={windowEnd}
                    mode="time"
                    onChange={(_event, date) => { setShowWindowEndPicker(false); setSchedulePreset(null); if (date) setWindowEnd(date); }}
                  />
                ) : null}
              </>
            )}

            <Pressable
              onPress={() => setClaimSettingsOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: claimSettingsOpen }}
              accessibilityLabel={t("createAi.claimSettingsHeader")}
              style={{ marginTop: 12, gap: 4 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <Text style={{ flex: 1, fontWeight: "700", color: theme.text }}>
                  {t("createAi.claimSettingsHeader")}
                </Text>
                <Text style={{ fontSize: 12, opacity: 0.55, color: theme.text }}>
                  {claimSettingsOpen
                    ? t("createAi.collapseSettings", { defaultValue: "Hide" })
                    : t("createAi.expandSettings", { defaultValue: "Show" })}
                </Text>
              </View>
              {!claimSettingsOpen ? (
                <Text style={{ fontSize: 12, lineHeight: 17, color: theme.mutedText }}>
                  {t("createAi.claimSettingsSummary", {
                    maxClaims,
                    cutoffMins,
                    defaultValue: "{{maxClaims}} claims max, {{cutoffMins}} min cutoff",
                  })}
                </Text>
              ) : null}
            </Pressable>
            {claimSettingsOpen ? (
              <>
                <Text style={{ marginTop: 8, color: theme.text }}>{t("createAi.maxClaims")}</Text>
                <TextInput
                  value={maxClaims}
                  onChangeText={(value) => setMaxClaims(sanitizeIntegerInput(value))}
                  keyboardType="number-pad"
                  inputAccessoryViewID={IOS_DONE_INPUT_ACCESSORY_ID}
                  returnKeyType="done"
                  placeholder={t("createAi.placeholderMaxClaims")}
                  placeholderTextColor={theme.mutedText}
                  style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, color: theme.text, backgroundColor: theme.surface }}
                />
                <Text style={{ marginTop: 8, color: theme.text }}>{t("createAi.cutoffBuffer")}</Text>
                <TextInput
                  value={cutoffMins}
                  onChangeText={(value) => setCutoffMins(sanitizeIntegerInput(value))}
                  keyboardType="number-pad"
                  inputAccessoryViewID={IOS_DONE_INPUT_ACCESSORY_ID}
                  returnKeyType="done"
                  placeholder={t("createAi.placeholderCutoff")}
                  placeholderTextColor={theme.mutedText}
                  style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, color: theme.text, backgroundColor: theme.surface }}
                />
              </>
            ) : null}

            {quota && quota.remaining <= 5 && quota.remaining > 0 ? (
              <Banner message={t("createAi.quotaWarning", { remaining: quota.remaining })} tone="info" />
            ) : null}

            <View
              onLayout={(e) => {
                generationSectionYRef.current = e.nativeEvent.layout.y;
              }}
              style={{ marginTop: 16, gap: 10 }}
            >
              {quota ? (
                <Text style={{ fontSize: 12, opacity: 0.5, textAlign: "center", color: theme.text }}>
                  {t("createAi.quotaRemaining", { remaining: quota.remaining, limit: quota.limit })}
                </Text>
              ) : null}
              {generating ? (
                <PrimaryButton
                  title={t("createAi.generateWorking")}
                  onPress={() => {}}
                  disabled
                />
              ) : cooldownActive ? (
                <PrimaryButton
                  title={t("createAi.generateCooldownCta", { seconds: cooldownSecondsLeft })}
                  onPress={() => {}}
                  disabled
                />
              ) : (
                <PrimaryButton
                  title={t("createAi.generateCta")}
                  onPress={() => void generateAd()}
                  disabled={revising}
                />
              )}
              {cooldownActive && !generating ? (
                <Text style={{ fontSize: 12, opacity: 0.5, textAlign: "center", color: theme.text }}>
                  {t("createAi.cooldownCaption")}
                </Text>
              ) : null}
              {!generating && !generatedAd && !showDraftEditor ? (
                <SecondaryButton
                  title={t("createAi.showDraftFields")}
                  onPress={() => {
                    setManualDraftUnlocked(true);
                    setBanner({ message: t("createAi.manualDraftBanner"), tone: "info" });
                  }}
                />
              ) : null}
            </View>

            {generationRecovery && !generating ? (
              <View style={{ marginTop: 16, padding: 14, borderRadius: 8, backgroundColor: theme.surfaceMuted, borderWidth: 1, borderColor: theme.border, gap: 10 }}>
                {/* Header is the ACTUAL failure reason (cooldown / monthly cap / copy
                    failure / timeout / ownership), not a generic "couldn't generate"
                    line — so the cause is visible instead of hidden. */}
                <Text style={{ fontWeight: "700", color: theme.text }}>{generationRecovery.title}</Text>
                <Text style={{ opacity: 0.8, lineHeight: 20, color: theme.text }}>
                  {generationRecovery.body}
                </Text>
                {generationRecovery.showFallbackAction ? (
                  <PrimaryButton
                    title={t("createAi.useFallbackTemplate", { defaultValue: "Use fallback template" })}
                    onPress={useFallbackTemplateAd}
                  />
                ) : null}
                {generationRecovery.showManualAction ? (
                  <SecondaryButton
                    title={t("createAi.editFallbackDetails", { defaultValue: "Edit details" })}
                    onPress={() => {
                      setManualDraftUnlocked(true);
                      setBanner({ message: t("createAi.manualDraftBanner"), tone: "info" });
                      scrollToDraftEditor();
                    }}
                  />
                ) : null}
              </View>
            ) : null}
              </>
            ) : (
              <View
                style={{
                  marginTop: 16,
                  padding: 14,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.surfaceMuted,
                  gap: 8,
                }}
              >
                <StepBadge n={3} total={3} t={t} />
                <Text style={{ fontWeight: "800", color: theme.text }}>
                  {t("dealEligibility.invalidTitle", { defaultValue: "Not eligible yet" })}
                </Text>
                <Text style={{ color: theme.mutedText, fontSize: 13, lineHeight: 19 }}>
                  {eligibilityResult.message ??
                    t("dealEligibility.invalidBody", {
                      defaultValue: "Finish the required offer rules before choosing schedule and generating an ad.",
                    })}
                </Text>
              </View>
            )}

            {/* Single ad preview - text rendered natively below the image, not baked in. */}
            {generatedAd && !adAccepted ? (
              <View
                onLayout={(e) => {
                  adReviewSectionYRef.current = e.nativeEvent.layout.y;
                }}
                style={{ marginTop: 22, gap: 14 }}
              >
                <Text style={{ fontWeight: "700", fontSize: 16, color: theme.text }}>{t("createAi.dealPreview")}</Text>

                {composedAdPreviewEnabled ? (
                  <>
                    <ComposedPreviewTelemetryBeacon
                      generatedAdPresent={Boolean(generatedAd)}
                      presentation={selectedComposedPresentation}
                      presentationHash={selectedComposedPresentationHash}
                      presentationOptionsCount={composedPresentationOptions.length}
                      imageSafeZoneConfidence={composedImageSafeZones.confidence}
                      compositeQa={selectedComposedCompositeQa}
                      screenshotQaRequired={selectedComposedScreenshotQaRequired}
                      generationStartedAtRef={adGenerationStartedAtRef}
                      previewShownAtRef={composedPreviewShownAtRef}
                      lastHashRef={lastComposedPreviewTelemetryHashRef}
                    />
                    {showPosterPreview ? (
                      renderPosterPreview()
                    ) : (
                      <StandardDealPreviewCard
                        imageUri={adImageUri}
                        businessName={businessName}
                        addressLine={businessProfile?.address ?? businessProfile?.location ?? null}
                        headline={ownerLanguagePreview.headline}
                        body={ownerLanguagePreview.body}
                        statusLabel={t("dealStatus.live")}
                        noImageLabel={t("createAi.errImageGenerationNoImage")}
                        theme={theme}
                        darkMode={colorScheme === "dark"}
                      />
                    )}
                    {composedMinimalInputEnabled ? (
                      <View style={{ gap: 8 }}>
                        <SecondaryButton
                          title={t("createAi.composedChangePhoto", { defaultValue: "Change photo" })}
                          onPress={() => {
                            setComposedEditIntent(null);
                            scrollRef.current?.scrollTo({ y: 0, animated: true });
                          }}
                        />
                        {/* The poster look is fixed to one template, so cycling composed
                            presentations changes nothing visible — hide the button there. */}
                        {showPosterPreview ? null : (
                        <SecondaryButton
                          title={t("createAi.composedTryAnotherStyle", { defaultValue: "Try another style" })}
                          onPress={() => {
                            const nextStyleIndex = (composedStyleIndex + 1) % composedPresentationOptions.length;
                            const nextPresentation = composedPresentationOptions[nextStyleIndex];
                            const nextPresentationHash = createAdPresentationHash({
                              presentation: nextPresentation,
                              offerFacts: composedOfferFacts,
                              copy: composedCopy,
                              reviewContext: selectedPresentationReviewContext,
                            });
                            trackEvent(AiAdsEvents.COMPOSED_STYLE_CHANGED, {
                              screen: "create_ai",
                              previous_template_id: selectedComposedPresentation.templateId,
                              selected_template_id: nextPresentation.templateId,
                              alternate_template_count: Math.max(0, composedPresentationOptions.length - 1),
                              merchant_style_override_used: nextStyleIndex > 0,
                              previous_presentation_hash: selectedComposedPresentationHash,
                              presentation_hash: nextPresentationHash,
                            });
                            setComposedStyleIndex(nextStyleIndex);
                            setComposedEditIntent(null);
                            setAdAccepted(false);
                            setApprovedComposedPresentationHash(null);
                            setApprovedLocalizationApprovalHash(null);
                            setPublishStatus("idle");
                            setPublishStatusMessage(null);
                            aiDraftBaselineRef.current = null;
                          }}
                          disabled={!canTryComposedStyle}
                        />
                        )}
                      </View>
                    ) : null}
                  </>
                ) : (
                  <>
                    {showPosterPreview ? (
                      renderPosterPreview()
                    ) : (
                      <StandardDealPreviewCard
                        imageUri={adImageUri}
                        businessName={businessName}
                        addressLine={businessProfile?.address ?? businessProfile?.location ?? null}
                        headline={ownerLanguagePreview.headline}
                        body={ownerLanguagePreview.body}
                        statusLabel={t("dealStatus.live")}
                        noImageLabel={t("createAi.errImageGenerationNoImage")}
                        theme={theme}
                        darkMode={colorScheme === "dark"}
                      />
                    )}
                  </>
                )}

                {canCompareImages && originalImageVersion ? (
                  <View style={{ padding: 12, borderRadius: 14, backgroundColor: theme.surfaceMuted, borderWidth: 1, borderColor: theme.border, gap: 10 }}>
                    <Text style={{ fontWeight: "800", color: theme.text }}>
                      {t("createAi.imageCompareTitle", { defaultValue: "Compare images" })}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Image source={{ uri: selectedPhotoUri! }} style={{ height: 140, width: "100%", borderRadius: 10 }} contentFit="cover" />
                        <Text style={{ marginTop: 6, fontSize: 12, fontWeight: "700", color: theme.mutedText }} numberOfLines={1}>
                          {t("createAi.imageCompareOriginal", { defaultValue: "Original photo" })}
                        </Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Image source={{ uri: adImageUri! }} style={{ height: 140, width: "100%", borderRadius: 10 }} contentFit="cover" />
                        <Text style={{ marginTop: 6, fontSize: 12, fontWeight: "700", color: theme.mutedText }} numberOfLines={1}>
                          {t("createAi.imageCompareCurrent", { defaultValue: "Current ad image" })}
                        </Text>
                      </View>
                    </View>
                    <SecondaryButton
                      title={t("createAi.imageRestoreOriginal", { defaultValue: "Restore original photo" })}
                      onPress={() => restoreImageVersion(originalImageVersion)}
                    />
                  </View>
                ) : null}

                {restorableImageVersions.length > 0 ? (
                  <View style={{ padding: 12, borderRadius: 14, backgroundColor: theme.surfaceMuted, borderWidth: 1, borderColor: theme.border, gap: 10 }}>
                    <Text style={{ fontWeight: "800", color: theme.text }}>
                      {t("createAi.imageVersionsTitle", { defaultValue: "Earlier image versions" })}
                    </Text>
                    {restorableImageVersions.map((entry, index) => {
                      const storagePath = imageVersionStoragePath(entry.ad);
                      if (!storagePath) return null;
                      const versionUri = buildPublicDealPhotoUrl(storagePath);
                      if (!versionUri) return null;
                      return (
                        <View
                          key={entry.id}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 10,
                            paddingVertical: 8,
                            borderTopWidth: index === 0 ? 0 : 1,
                            borderTopColor: theme.border,
                          }}
                        >
                          <Image source={{ uri: versionUri }} style={{ width: 72, height: 72, borderRadius: 10 }} contentFit="cover" />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ fontWeight: "700", color: theme.text }} numberOfLines={1}>
                              {imageVersionLabel(entry, index)}
                            </Text>
                            <Text style={{ marginTop: 2, fontSize: 12, color: theme.mutedText }} numberOfLines={1}>
                              {entry.kind === "original"
                                ? t("createAi.imageCompareOriginal", { defaultValue: "Original photo" })
                                : entry.ad.photo_source === "uploaded_enhanced"
                                  ? t("createAi.imageVersionEdited", { defaultValue: "AI-edited photo" })
                                  : t("createAi.imageVersionGenerated", { defaultValue: "Generated image" })}
                            </Text>
                          </View>
                          <Pressable
                            onPress={() => restoreImageVersion(entry)}
                            style={{
                              paddingVertical: 8,
                              paddingHorizontal: 10,
                              borderRadius: 999,
                              backgroundColor: theme.surface,
                              borderWidth: 1,
                              borderColor: theme.border,
                            }}
                          >
                            <Text style={{ fontWeight: "800", fontSize: 12, color: theme.text }} numberOfLines={1}>
                              {t("createAi.imageRestoreVersion", { defaultValue: "Restore" })}
                            </Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                ) : null}

                <PrimaryButton
                  title={t("createAi.useThisAd")}
                  onPress={acceptAd}
                />

                {/* Revise panel */}
                {showComposedRevisePanel ? (
                  <View style={{ padding: 14, borderRadius: 12, backgroundColor: theme.surfaceMuted, borderWidth: 1, borderColor: theme.border, gap: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <Text
                        style={{ flex: 1, minWidth: 160, fontWeight: "800", fontSize: 14, color: theme.text }}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.86}
                      >
                        {t("createAi.tweakTitle")}
                      </Text>
                      <View
                        style={{
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: theme.border,
                          backgroundColor: theme.surface,
                          paddingHorizontal: 9,
                          paddingVertical: 5,
                        }}
                      >
                        <Text style={{ fontSize: 12, lineHeight: 15, fontWeight: "800", color: theme.mutedText }} numberOfLines={1}>
                          {revisionsLeftLabel}
                        </Text>
                      </View>
                    </View>

                    {revisionsLeft === 0 ? (
                      <View style={{ padding: 12, borderRadius: 10, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }}>
                        <Text style={{ color: theme.mutedText, lineHeight: 19 }}>
                          {t("createAi.reviseLimitBody")}
                        </Text>
                      </View>
                    ) : (
                      <>
                        <View style={{ flexDirection: "row", gap: 6 }}>
                          {(["copy", "image", "both"] as RevisionTarget[]).map((target) => {
                            const selected = revisionTarget === target;
                            return (
                              <Pressable
                                key={target}
                                disabled={!canReviseAd}
                                onPress={() => setRevisionTarget(target)}
                                style={{
                                  flex: 1,
                                  paddingVertical: 8,
                                  borderRadius: 999,
                                  backgroundColor: selected ? theme.primary : theme.surface,
                                  borderWidth: 1,
                                  borderColor: selected ? theme.primary : theme.border,
                                  opacity: canReviseAd ? 1 : 0.5,
                                }}
                              >
                                <Text style={{ textAlign: "center", fontWeight: "700", color: selected ? theme.primaryText : colorScheme === "dark" ? theme.text : Gray[700], fontSize: 13 }}>
                                  {targetLabel[target]}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>

                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          {revisionSuggestionOptions.map((suggestion) => {
                            const selected = revisionTarget === suggestion.target && revisionFeedback === suggestion.feedback;
                            return (
                              <Pressable
                                key={suggestion.key}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                                disabled={!canReviseAd}
                                onPress={() => applyRevisionSuggestion(suggestion)}
                                style={{
                                  paddingVertical: 8,
                                  paddingHorizontal: 10,
                                  borderRadius: 999,
                                  backgroundColor: selected ? PrimaryTint.surface : theme.surface,
                                  borderWidth: 1,
                                  borderColor: selected ? theme.primary : theme.border,
                                  opacity: canReviseAd ? 1 : 0.55,
                                }}
                              >
                                <Text
                                  numberOfLines={1}
                                  style={{
                                    color: selected ? theme.accentText : theme.text,
                                    fontWeight: "800",
                                    fontSize: 12,
                                  }}
                                >
                                  {suggestion.label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>

                        <TextInput
                          value={revisionFeedback}
                          onChangeText={setRevisionFeedback}
                          placeholder={t("createAi.reviseFeedbackPlaceholder")}
                          placeholderTextColor={theme.mutedText}
                          multiline
                          editable={canReviseAd}
                          style={{
                            borderWidth: 1,
                            borderColor: theme.border,
                            borderRadius: 10,
                            padding: 12,
                            minHeight: 48,
                            backgroundColor: theme.surface,
                            color: theme.text,
                            fontSize: 14,
                            opacity: canReviseAd ? 1 : 0.6,
                          }}
                        />

                        <SecondaryButton
                          title={revising ? t("createAi.reviseButtonBusy") : t("createAi.reviseButton")}
                          onPress={() => void reviseAd()}
                          disabled={!canReviseAd}
                        />
                      </>
                    )}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Draft editor — appears once user accepts the ad or starts a manual draft */}
            {showDraftEditor ? (
              <View
                onLayout={(e) => {
                  draftEditorSectionYRef.current = e.nativeEvent.layout.y;
                }}
              >
                <Text style={{ marginTop: 22, fontWeight: "700" }}>{t("createAi.dealPreview")}</Text>
                {showPosterPreview ? (
                  <View style={{ marginTop: 10, gap: 12 }}>
                    {renderPosterPreview()}
                  </View>
                ) : (
                  <View style={{ marginTop: 10 }}>
                    {(() => {
                      const storagePath = imageVersionStoragePath(generatedAd);
                      const previewUri = storagePath
                        ? buildPublicDealPhotoUrl(storagePath)
                        : usePhotoAsFinal ? selectedPhotoUri : null;
                      return (
                        <StandardDealPreviewCard
                          imageUri={previewUri}
                          businessName={businessName}
                          addressLine={businessProfile?.address ?? businessProfile?.location ?? null}
                          headline={title || promoLine || hintText || t("createAi.placeholderDealTitle")}
                          body={promoLine || description || null}
                          statusLabel={t("dealStatus.live")}
                          noImageLabel={t("createAi.errImageGenerationNoImage")}
                          theme={theme}
                          darkMode={colorScheme === "dark"}
                        />
                      );
                    })()}
                  </View>
                )}

                {showPosterFormat ? (
                  <>
                    <Text style={{ marginTop: 16, color: theme.text }}>
                      {t("createAi.editPosterHeadline")} ({posterHeadlineText.trim().length}/{POSTER_TEXT_LIMITS.headline})
                    </Text>
                    <TextInput value={posterHeadlineText} maxLength={POSTER_TEXT_LIMITS.headline} onChangeText={(value) => { setPosterHeadlineText(value); invalidateAcceptedAdDraft(); }} placeholder={t("createAi.posterHeadlinePlaceholder")} placeholderTextColor={theme.mutedText} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, color: theme.text, backgroundColor: theme.surface }} />
                    {!posterHeadlineEditCheck.ok ? (
                      <Text style={{ marginTop: 4, fontSize: 13, color: theme.danger }}>
                        {t("createAi.posterHeadlineNotAllowed")}
                      </Text>
                    ) : null}
                    <Text style={{ marginTop: 12, color: theme.text }}>
                      {t("createAi.editPosterSubheadline")} ({posterSublineText.trim().length}/{POSTER_TEXT_LIMITS.subline})
                    </Text>
                    <TextInput value={posterSublineText} maxLength={POSTER_TEXT_LIMITS.subline} onChangeText={(value) => { setPosterSublineText(value); invalidateAcceptedAdDraft(); }} placeholder={t("createAi.posterSubheadlinePlaceholder")} placeholderTextColor={theme.mutedText} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, color: theme.text, backgroundColor: theme.surface }} />
                    {!posterSublineEditCheck.ok ? (
                      <Text style={{ marginTop: 4, fontSize: 13, color: theme.danger }}>
                        {t("createAi.posterSubheadlineNotAllowed")}
                      </Text>
                    ) : null}
                  </>
                ) : null}
                <Text style={{ marginTop: 16, color: theme.text }}>{t("createAi.editHeadline")}</Text>
                <TextInput value={title} onChangeText={(value) => { setTitle(value); invalidateAcceptedAdDraft(); }} placeholder={t("createAi.headlinePlaceholder")} placeholderTextColor={theme.mutedText} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, color: theme.text, backgroundColor: theme.surface }} />
                <Text style={{ marginTop: 12, color: theme.text }}>{t("createAi.editSubheadline")}</Text>
                <TextInput value={promoLine} onChangeText={(value) => { setPromoLine(value); invalidateAcceptedAdDraft(); }} placeholder={t("createAi.subheadlinePlaceholder")} placeholderTextColor={theme.mutedText} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, color: theme.text, backgroundColor: theme.surface }} />
                <Text style={{ marginTop: 12, color: theme.text }}>{t("createAi.editCta")}</Text>
                <TextInput value={ctaText} onChangeText={(value) => { setCtaText(value); invalidateAcceptedAdDraft(); }} placeholder={t("createAi.ctaPlaceholder")} placeholderTextColor={theme.mutedText} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, color: theme.text, backgroundColor: theme.surface }} />
                <Text style={{ marginTop: 12, color: theme.text }}>{t("createAi.editDetails")}</Text>
                <TextInput value={description} onChangeText={(value) => { setDescription(value); invalidateAcceptedAdDraft(); }} placeholder={t("createAi.detailsPlaceholder")} placeholderTextColor={theme.mutedText} multiline style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, minHeight: 90, color: theme.text, backgroundColor: theme.surface }} />

                {acceptedDraftRequiresReapproval ? (
                  <View
                    style={{
                      marginTop: 16,
                      padding: 14,
                      borderRadius: 12,
                      backgroundColor: theme.surfaceMuted,
                      borderWidth: 1,
                      borderColor: theme.border,
                      gap: 8,
                    }}
                  >
                    <Text style={{ fontWeight: "800", color: theme.text }}>
                      {t("createAi.approveChangesTitle")}
                    </Text>
                    <Text style={{ color: theme.mutedText, lineHeight: 19 }}>
                      {t("createAi.approveChangesBody")}
                    </Text>
                    <PrimaryButton title={t("createAi.approveChangesButton")} onPress={acceptAd} />
                  </View>
                ) : null}

                <View style={{ marginTop: 16, gap: 8 }}>
                  {displayedPublishStatus !== "ready" ? (
                    <View
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        backgroundColor: publishStatusCard.backgroundColor,
                        borderWidth: 1,
                        borderColor: publishStatusCard.borderColor,
                        flexDirection: "row",
                        gap: 10,
                        alignItems: "flex-start",
                      }}
                    >
                      <MaterialIcons name={publishStatusCard.icon} size={20} color={publishStatusCard.titleColor} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "800", color: publishStatusCard.titleColor }}>
                          {publishStatusCard.title}
                        </Text>
                        <Text style={{ marginTop: 3, color: theme.mutedText, lineHeight: 18 }}>
                          {publishStatusCard.body}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                  {displayedPublishStatus === "missing" ? (
                    <SecondaryButton
                      title={publishReadiness.buttonLabel}
                      onPress={() => {}}
                      disabled
                    />
                  ) : (
                    <PrimaryButton
                      title={
                        displayedPublishStatus === "publishing"
                          ? t("createAi.publishing")
                          : displayedPublishStatus === "success"
                            ? editingDealId
                              ? t("createAi.publishUpdateSuccessTitle")
                              : t("createAi.publishSuccessTitle")
                            : publishReadiness.buttonLabel
                      }
                      onPress={() => void publishDeal()}
                      disabled={displayedPublishStatus === "publishing" || displayedPublishStatus === "success"}
                    />
                  )}
                  <SecondaryButton
                    title={savingTemplate ? t("createAi.savingTemplate") : t("createAi.saveTemplate")}
                    onPress={() => void saveTemplate()}
                    disabled={savingTemplate || !canPublish}
                  />
                </View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      <DancingPenguinProgressOverlay
        visible={generating || revising}
        title={revising ? t("createAi.revisingWorking") : t("createAi.generateWorking")}
        message={
          revising
            ? t(revisionProgressMessageKey)
            : selectedPhotoUri
              ? t("createAi.generatingWithPhoto")
              : t("createAi.generatingNoPhoto")
        }
        hint={
          revising
            ? t(revisionProgressHintKey)
            : selectedPhotoUri
              ? t("createAi.generatingHint")
              : t("createAi.generatingHintNoPhoto", {
                  defaultValue:
                    "Writing your ad and checking the deal details. This usually finishes faster without a photo.",
                })
        }
        cancelLabel={t("createAi.cancel")}
        onCancel={cancelGeneration}
        theme={theme}
        testID="ai-draft-penguin-progress-overlay"
      />
      <IosDoneInputAccessory />
      <Modal
        visible={Platform.OS === "ios" && iosSchedulePicker !== null}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        accessibilityViewIsModal
        onRequestClose={cancelIosSchedulePicker}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.28)" }}>
          <View
            style={{
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              backgroundColor: theme.surface,
              paddingTop: 8,
              paddingHorizontal: horizontal,
              paddingBottom: scrollBottom,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 8,
              }}
            >
              <Pressable
                accessibilityRole="button"
                onPress={cancelIosSchedulePicker}
                style={{ minHeight: 44, justifyContent: "center", paddingRight: 16 }}
              >
                <Text style={{ color: theme.mutedText, fontSize: 16, fontWeight: "700" }}>
                  {t("commonUi.cancel")}
                </Text>
              </Pressable>
              <Text
                numberOfLines={1}
                style={{ flex: 1, color: theme.text, fontSize: 16, fontWeight: "800", textAlign: "center" }}
              >
                {iosSchedulePickerTitle}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={confirmIosSchedulePicker}
                style={{ minHeight: 44, justifyContent: "center", paddingLeft: 16 }}
              >
                <Text style={{ color: theme.primary, fontSize: 16, fontWeight: "800" }}>
                  {t("commonUi.done", { defaultValue: "Done" })}
                </Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={iosScheduleDraft}
              mode={iosSchedulePickerMode}
              display="spinner"
              textColor={theme.text}
              themeVariant={colorScheme}
              style={{ height: 216, alignSelf: "stretch" }}
              onChange={(_event, date) => {
                if (date) setIosScheduleDraft(date);
              }}
            />
          </View>
        </View>
      </Modal>
      {confirmModal}
    </KeyboardScreen>
  );
}

function StepBadge({ n, total, t }: { n: number; total: number; t: (key: string, opts?: Record<string, unknown>) => string }) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  return (
    <View style={{ borderRadius: 14, backgroundColor: theme.surfaceMuted, paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start" }}>
      <Text style={{ fontSize: 12, fontWeight: "800", letterSpacing: 0.2, opacity: 0.72, color: theme.text }}>
        {t("createAi.stepOfTotal", { current: n, total })}
      </Text>
    </View>
  );
}
