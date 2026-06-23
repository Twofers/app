import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { ComposedAdCard } from "@/components/composed-ad-card/ComposedAdCard";
import { GeneratedAdPreviewCard } from "@/components/generated-ad-preview-card";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useBrandedConfirm } from "@/hooks/use-branded-confirm";
import { Colors, Gray, PrimaryTint } from "@/constants/theme";
import {
  aiGenerateAd,
  aiReviseAd,
  notifyDealPublished,
  translateDealCopy,
  getErrorCode,
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
import { assessDealQuality } from "../../lib/deal-quality";
import {
  resolveDealFlowLanguage,
  translateDealQualityBlock,
} from "../../lib/translate-deal-quality";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { format } from "date-fns";
import { dateFnsLocaleFor } from "../../lib/i18n/date-locale";
import { isAppLocale, type AppLocale } from "../../lib/i18n/config";
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
  type AiDealRecoveryDraft,
} from "../../lib/ai-deal-draft-recovery";
import { uploadDealPhoto } from "../../lib/upload-deal-photo";
import { validateStrongDealOnly } from "../../lib/strong-deal-guard";
import { validateDealEligibility } from "../../lib/deal-eligibility";
import {
  buildDealOfferContract,
  validateAiCopyAgainstOffer,
} from "../../lib/deal-offer-contract";
import { buildOfferDefinitionV1FromContract } from "../../lib/offer-definition";
import { buildDefaultAdPresentationSpec } from "@/lib/ad-presentation-spec";
import {
  buildApprovedAdCopy,
  buildMerchantIdentity,
  imageSourceTypeFromGeneratedAd,
} from "@/lib/ad-render-content";
import {
  buildLockedOfferContent,
  renderAuthoritativeOfferFromDefinition,
} from "@/lib/authoritative-offer-renderer";
import {
  isAiV4AuthoritativeOfferCardEnabled,
  isAiV4ComposedAdCardEnabled,
  isAiV4SharedRendererEnabled,
} from "@/lib/runtime-env";
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
  aiComposeOfferTranscribe,
  fetchAiComposeQuota,
  type AiComposeQuota,
} from "../../lib/ai-compose-offer";
import {
  buildAuthoritativeDealDisplayCopy,
  buildOfferVersionPublishAdSpec,
  createPublishIdempotencyKey,
  publishOfferVersionedDeal,
} from "../../lib/offer-version-publish";
import {
  buildAdImageSelection,
  type AdImageSelectionQa,
  type MerchantImageEditMode,
  type MerchantImageSourceMode,
} from "../../lib/merchant-image-selection";

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

const CUTOFF_DURATION_MESSAGE = "Redemption cutoff must be shorter than the deal duration.";

const SCHEDULE_DAY_BY_VALUE: Record<number, string> = {
  1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun",
};

const SCHEDULE_PRESETS = [
  { key: "weekdays", days: [1, 2, 3, 4, 5], startMin: 540, endMin: 1020 },
  { key: "daily", days: [1, 2, 3, 4, 5, 6, 7], startMin: 480, endMin: 1200 },
  { key: "weekends", days: [6, 7], startMin: 600, endMin: 840 },
] as const;

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
const DEFAULT_WEEKDAYS_SORTED_KEY = "1,2,3,4,5";

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
}): GeneratedAd | null {
  if (!params.ad) return null;
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

type RevisionTarget = "copy" | "image" | "both";
type IosSchedulePickerTarget = "start" | "end" | "windowStart" | "windowEnd";
type ImageVersionKind = "generated" | "revision" | "fallback" | "original";

type ImageVersionEntry = {
  id: string;
  kind: ImageVersionKind;
  ad: GeneratedAd;
  createdAt: string;
};

const COPY_PRESET_KEYS = [
  "createAi.revisePresetPunchier",
  "createAi.revisePresetSimpler",
  "createAi.revisePresetPremium",
  "createAi.revisePresetFunnier",
  "createAi.revisePresetShorter",
  "createAi.revisePresetSavings",
  "createAi.revisePresetItem",
];

const IMAGE_PRESET_KEYS_GENERATED = [
  "createAi.revisePresetTryAnotherImage",
  "createAi.revisePresetGenAngle",
  "createAi.revisePresetGenBrighter",
  "createAi.revisePresetGenMoodier",
];

const IMAGE_PRESET_KEYS_PHOTO = [
  "createAi.revisePresetPhotoBrighter",
  "createAi.revisePresetPhotoCrop",
  "createAi.revisePresetPhotoBg",
];

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
  } = useBusiness();
  const dealOutputLang = resolveDealFlowLanguage(businessPreferredLocale, i18n.language);

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

  function formatPickerTime(date: Date) {
    return format(date, "p", { locale: dateFnsLocaleFor(i18n.language) });
  }

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [photoTreatment, setPhotoTreatment] = useState<PhotoTreatment>("studiopolish");
  const [useCustomImageEdit, setUseCustomImageEdit] = useState(false);
  const [customImageEditInstruction, setCustomImageEditInstruction] = useState("");
  const [usePhotoAsFinal, setUsePhotoAsFinal] = useState(false);
  const [merchantOriginalWarningAcknowledged, setMerchantOriginalWarningAcknowledged] = useState(false);

  const [hintText, setHintText] = useState("");
  const [price, setPrice] = useState("");
  const [eligibilityForm, setEligibilityForm] = useState<DealEligibilityFormState>(
    () => createDefaultDealEligibilityFormState(),
  );
  const [title, setTitle] = useState("");
  const [promoLine, setPromoLine] = useState("");
  const [ctaText, setCtaText] = useState("");
  const [description, setDescription] = useState("");
  const [maxClaims, setMaxClaims] = useState("50");
  const [cutoffMins, setCutoffMins] = useState("15");
  const [validityMode, setValidityMode] = useState<"one-time" | "recurring">("one-time");
  const [startTime, setStartTime] = useState(new Date());
  const [endTime, setEndTime] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [androidStartPickerMode, setAndroidStartPickerMode] = useState<"date" | "time">("date");
  const androidStartDateRef = useRef<Date | null>(null);
  const [androidEndPickerMode, setAndroidEndPickerMode] = useState<"date" | "time">("date");
  const androidEndDateRef = useRef<Date | null>(null);
  const [showWindowStartPicker, setShowWindowStartPicker] = useState(false);
  const [showWindowEndPicker, setShowWindowEndPicker] = useState(false);
  const [windowStart, setWindowStart] = useState(new Date());
  const [windowEnd, setWindowEnd] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [iosSchedulePicker, setIosSchedulePicker] = useState<IosSchedulePickerTarget | null>(null);
  const [iosScheduleDraft, setIosScheduleDraft] = useState(new Date());
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [schedulePreset, setSchedulePreset] = useState<string | null>(null);
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
  const [activePreset, setActivePreset] = useState<string | null>(null);
  /**
   * Monotonic ID for in-flight generate/revise calls. If user replaces the photo or hits
   * generate again before a revise resolves, we bump this counter and discard stale results.
   */
  const generationRequestIdRef = useRef(0);
  const aiRequestGroupIdRef = useRef(createAiRequestGroupId());

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
  const customImageEditInputRef = useRef<TextInput | null>(null);
  const [scheduleSectionY, setScheduleSectionY] = useState<number | null>(null);
  const menuOfferScrollDoneRef = useRef(false);
  const reuseScrollDoneRef = useRef(false);
  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [editingSourceLocale, setEditingSourceLocale] = useState<AppLocale | null>(null);
  const [prefillSourceLocale, setPrefillSourceLocale] = useState<AppLocale | null>(null);
  const [dealLoadError, setDealLoadError] = useState<string | null>(null);
  const [dealLoadNonce, setDealLoadNonce] = useState(0);
  const [dealEditLoading, setDealEditLoading] = useState(false);
  const [editDirtyBaseline, setEditDirtyBaseline] = useState<DealFormDirtySnapshot | null>(null);
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

  const listingBody = useMemo(
    () => composeListingDescription(promoLine, ctaText, description),
    [promoLine, ctaText, description],
  );
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

  const canPublish = useMemo(() => {
    return title.trim().length > 0 && listingBody.trim().length > 0;
  }, [title, listingBody]);

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
          body: t("createAi.publishMissingBody"),
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
  }, [colorScheme, displayedPublishStatus, editingDealId, publishStatusMessage, t, theme]);

  const showDraftEditor =
    templateLoaded ||
    editingDealId != null ||
    adAccepted ||
    title.trim().length > 0 ||
    promoLine.trim().length > 0 ||
    ctaText.trim().length > 0 ||
    description.trim().length > 0 ||
    manualDraftUnlocked;

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
    setAdAccepted(false);
    setManualDraftUnlocked(true);
    setPublishStatus("idle");
    setPublishStatusMessage(null);
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
        generatedPosterPath: generatedAd?.poster_storage_path ?? null,
        hintText,
        price,
        title,
        promoLine,
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
    setPublishStatus((current) => {
      if (current === "success" || current === "error") return "idle";
      return current;
    });
    setPublishStatusMessage(null);
  }, [
    title,
    promoLine,
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

  const composeDirty = useMemo(() => {
    if (photoUri || hintText.trim() || price.trim()) return true;
    if (generatedAd != null || adAccepted) return true;
    if (title.trim() || promoLine.trim() || ctaText.trim() || description.trim()) return true;
    if (JSON.stringify(eligibilityForm) !== JSON.stringify(createDefaultDealEligibilityFormState())) return true;
    if (maxClaims !== "50" || cutoffMins !== "15") return true;
    if (validityMode !== "one-time") return true;
    if ([...daysOfWeek].sort((a, b) => a - b).join(",") !== DEFAULT_WEEKDAYS_SORTED_KEY) return true;
    if (manualDraftUnlocked) return true;
    if (templateLoaded) return true;
    return false;
  }, [
    photoUri,
    hintText,
    price,
    generatedAd,
    adAccepted,
    title,
    promoLine,
    ctaText,
    description,
    eligibilityForm,
    maxClaims,
    cutoffMins,
    validityMode,
    daysOfWeek,
    manualDraftUnlocked,
    templateLoaded,
  ]);

  const editFormDirty = useMemo(
    () => isDealFormDirty(editDirtyBaseline, currentDealFormSnapshot),
    [editDirtyBaseline, currentDealFormSnapshot],
  );
  const dealDraftDirty = dealIdFromRoute ? editFormDirty : composeDirty;

  usePreventRemove(
    dealDraftDirty && !allowPostPublishNavigation,
    useCallback(
      ({ data }) => {
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
    setPhotoTreatment(draft.photoTreatment);
    setCustomImageEditInstruction(draft.customImageEditInstruction);
    setUseCustomImageEdit(Boolean(draft.customImageEditInstruction.trim()));
    setUsePhotoAsFinal(draft.usePhotoAsFinal);
    setMerchantOriginalWarningAcknowledged(draft.merchantOriginalWarningAcknowledged);
    setHintText(draft.hintText);
    setPrice(draft.price);
    setTitle(draft.title);
    setPromoLine(draft.promoLine);
    setCtaText(draft.ctaText);
    setDescription(draft.description);
    setEligibilityForm(draft.eligibilityForm);
    setMaxClaims(draft.maxClaims);
    setCutoffMins(draft.cutoffMins);
    setValidityMode(draft.validityMode);
    setStartTime(new Date(draft.startTime));
    setEndTime(new Date(draft.endTime));
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
    setManualDraftUnlocked(draft.manualDraftUnlocked || draft.adAccepted || Boolean(draft.generatedAd));
    setLastGenerationError(null);
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
      hintText,
      price,
      title,
      promoLine,
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
    hintText,
    price,
    title,
    promoLine,
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
        const loadedStartTime = row.start_time ? new Date(String(row.start_time)) : now;
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
        setEditingSourceLocale(isAppLocale(loadedSourceLocale) ? loadedSourceLocale : "en");
        setPrefillSourceLocale(null);
        setTitle(loadedTitle);
        setDescription(loadedDescription);
        setPromoLine("");
        setCtaText("");
        setPrice(loadedPrice);
        setPhotoUri(null);
        // Restore both the storage path AND a usable preview URL — without this the photo
        // selector renders empty when editing an existing deal that has a poster.
        setPhotoPath(loadedPhotoPath);
        setPosterUrl(loadedPosterUrl);
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
        aiDraftBaselineRef.current = null;
        setLastGenerationError(null);
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
  }, [dealIdFromRoute, businessId, dealLoadNonce, t]);

  useEffect(() => {
    if (!dealIdFromRoute) setEditDirtyBaseline(null);
  }, [dealIdFromRoute]);

  useEffect(() => {
    if (dealIdFromRoute || !templateId || !businessId) return;
    let cancelled = false;
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
        setUsePhotoAsFinal(Boolean(templatePhotoPath || templatePosterUrl));
        setMerchantOriginalWarningAcknowledged(false);
        setMaxClaims(String(row.max_claims ?? 50));
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
        aiDraftBaselineRef.current = null;
        setManualDraftUnlocked(false);
        setLastGenerationError(null);
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
    setEditingSourceLocale(null);
    setPrefillSourceLocale(isAppLocale(sourceFromRoute) ? sourceFromRoute : null);
    const pl = g(params.prefillLocationId).trim();
    const pe = g(params.prefillExtraLocationIds).trim();
    const locIds = [pl, ...pe.split(",").map((s) => s.trim()).filter(Boolean)].filter(Boolean);
    if (locIds.length) setPublishLocationIds(locIds);
    const hasSchedulePrefill = g(params.prefillIsRecurring) || g(params.prefillDaysOfWeek) || g(params.prefillMaxClaims);
    if (!pt && !pp && !pc && !pd && !ph && !price0 && !posterPath && !posterUrlParam && !prefillDealEligibility && locIds.length === 0 && !hasSchedulePrefill) return;

    if (pt) setTitle((prev) => prev || pt);
    if (pp) setPromoLine((prev) => prev || pp);
    if (pc) setCtaText((prev) => prev || pc);
    if (pd) setDescription((prev) => prev || pd);
    if (ph) setHintText((prev) => prev || ph);
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
  }, [
    templateId, params.prefillTitle, params.prefillPromoLine, params.prefillCta,
    params.prefillDescription, params.prefillHint, params.prefillPrice, params.prefillPosterPath, params.prefillPosterUrl,
    params.prefillDealEligibility,
    params.fromAiCompose, params.fromMenuOffer, params.fromReuse, params.fromCreateHub,
    params.prefillLocationId, params.prefillExtraLocationIds, params.prefillSourceLocale, dealIdFromRoute, t,
    params.prefillIsRecurring, params.prefillDaysOfWeek, params.prefillWindowStartMin,
    params.prefillWindowEndMin, params.prefillTimezone, params.prefillMaxClaims, params.prefillCutoffMins,
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
    setAdAccepted(false);
    setRevisionsUsed(0);
    setRevisionFeedback("");
    setActivePreset(null);
    aiDraftBaselineRef.current = null;
    lastSentPhotoTreatmentRef.current = null;
    aiRequestGroupIdRef.current = createAiRequestGroupId();
    generationRequestIdRef.current += 1;
  }

  async function pickPhotoFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      setBanner({ message: t("createAi.errPhotoAccess"), tone: "error" });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const uri = result.assets[0].uri;
    setPhotoUri(uri);
    setPosterUrl(null);
    setPhotoPath(null);
    setUsePhotoAsFinal(false);
    setMerchantOriginalWarningAcknowledged(false);
    resetGenerationState();
    void persistSelectedPhotoForRecovery(uri);
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
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
    if (photo?.uri) {
      setPhotoUri(photo.uri);
      setPosterUrl(null);
      setPhotoPath(null);
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
        setHintText((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
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
    setCtaText(draft.cta_text);
    setDescription(draft.offer_details);
    aiDraftBaselineRef.current = {
      title: draft.title,
      promo_line: draft.promo_line,
      cta_text: draft.cta_text,
      description: draft.offer_details,
    };
  }

  function friendlyGenerationError(raw: string, code?: string): string {
    // Map each known failure to a DISTINCT, truthful message so the owner (and a
    // developer reading a screenshot) can tell cooldown from monthly cap from a
    // copy failure. Server codes arrive via getErrorCode; codeless cases (403
    // ownership, timeouts) are matched on the parsed message text.
    if (code === "OPENAI_KEY_MISSING") return t("createAi.friendlyOpenaiConfig");
    if (code === "MONTHLY_LIMIT") return t("createAi.friendlyMonthlyLimit");
    if (code === "COOLDOWN_ACTIVE") return raw; // server message is specific ("Please wait 12s…")
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
    if (lower.includes("photo")) return t("createAi.friendlyPhoto");
    return t("createAi.friendlyGenerationLongError");
  }

  function cancelGeneration() {
    // Bumping the request id makes the in-flight result a no-op when it returns,
    // and we re-enable the UI immediately so the user is not stuck on a spinner.
    generationRequestIdRef.current += 1;
    setGenerating(false);
    setRevising(false);
    setBanner(null);
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
    setLastGenerationError(null);
    resetGenerationState();
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
        setLastGenerationError(friendly);
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
      });
      // Stale-result guard: discard if user kicked off another generation after this one.
      if (requestId !== generationRequestIdRef.current) return;
      lastSentPhotoTreatmentRef.current = sentTreatment;
      const normalizedAd = normalizeGeneratedAdDisplayCopy(ad);
      setGeneratedAd(normalizedAd);
      rememberImageVersion(normalizedAd, "generated");
      if (nextQuota) setQuota(nextQuota);
      setBanner({ message: t("createAi.successBatchFirst"), tone: "success" });
      trackEvent(AiAdsEvents.GENERATION_SUCCEEDED, {
        screen: "create_ai",
        regeneration_attempt: 0,
      });
    } catch (err: unknown) {
      if (requestId !== generationRequestIdRef.current) return;
      const raw = err instanceof Error ? err.message : String(err);
      const code = getErrorCode(err);
      const friendly = friendlyGenerationError(raw, code);
      setLastGenerationError(friendly);
      setBanner({ message: friendly, tone: "error" });
      trackEvent(AiAdsEvents.GENERATION_FAILED, {
        screen: "create_ai",
        regeneration_attempt: 0,
        message_snippet: raw.slice(0, 80),
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
    if (!generatedAd || !businessId) return;
    if (blockIneligibleOffer("revise_ad")) return;
    if (revisionsUsed >= SOFT_REVISION_CAP) {
      setBanner({ message: t("createAi.errRegenClientLimit"), tone: "info" });
      return;
    }
    if (!activePreset && !revisionFeedback.trim()) {
      setBanner({ message: t("createAi.reviseErrPickSomething"), tone: "info" });
      return;
    }
    /**
     * Send the treatment that produced the *previous* ad image, not the current UI selection.
     * This way the server's image-only revision applies enhancement consistent with what the
     * user is looking at, even if they fiddled with the selector after generating.
     */
    const sourceModeForRevision =
      generatedAd.image_selection?.sourceMode ??
      imageSourceModeForPhotoChoice(photoPath, usePhotoAsFinal);
    const editModeForRevision =
      generatedAd.image_selection?.editMode ??
      (sourceModeForRevision === "merchant_ai_edit"
        ? imageEditModeForTreatment(lastSentPhotoTreatmentRef.current ?? photoTreatment)
        : "none");
    const treatmentForRevision =
      sourceModeForRevision === "merchant_ai_edit"
        ? lastSentPhotoTreatmentRef.current ?? photoTreatment
        : null;
    const customEditText = sourceModeForRevision === "merchant_ai_edit" && editModeForRevision === "custom"
      ? cleanCustomImageEditInstruction(customImageEditInstruction || revisionFeedback)
      : "";
    if (sourceModeForRevision === "merchant_ai_edit" && editModeForRevision === "custom" && !customEditText) {
      setBanner({ message: t("createAi.errCustomImageEditRequired"), tone: "info" });
      return;
    }
    setRevising(true);
    setBanner(null);
    const requestId = ++generationRequestIdRef.current;
    const maxClaimsNum = Number(maxClaims);
    try {
      const { ad, quota: nextQuota } = await aiReviseAd({
        business_id: businessId,
        hint_text: hintText.trim(),
        business_context: businessContextForAi,
        output_language: dealOutputLang,
        request_group_id: aiRequestGroupIdRef.current,
        deal_eligibility: eligibilityInput,
        previous_ad: generatedAd,
        revision_target: revisionTarget,
        revision_count: revisionsUsed + 1,
        ...(activePreset ? { revision_preset: activePreset } : {}),
        ...(revisionFeedback.trim() ? { revision_feedback: revisionFeedback.trim() } : {}),
        image_source_mode: sourceModeForRevision,
        image_edit_mode: editModeForRevision,
        ...(editModeForRevision === "custom" ? { custom_image_edit_instruction: customEditText } : {}),
        ...(photoPath ? { photo_path: photoPath } : {}),
        ...(treatmentForRevision ? { photo_treatment: treatmentForRevision } : {}),
        ...(offerScheduleSummary ? { offer_schedule_summary: offerScheduleSummary } : {}),
        ...(Number.isFinite(maxClaimsNum) && maxClaimsNum > 0 ? { quantity_limit: maxClaimsNum } : {}),
        redemption_limit: redemptionLimitSummary,
      });
      // Stale-result guard: discard if user replaced the photo or kicked off another generation.
      if (requestId !== generationRequestIdRef.current) return;
      const normalizedAd = normalizeGeneratedAdDisplayCopy(ad);
      setGeneratedAd(normalizedAd);
      rememberImageVersion(normalizedAd, "revision");
      if (nextQuota) setQuota(nextQuota);
      setRevisionsUsed((u) => u + 1);
      setRevisionFeedback("");
      setActivePreset(null);
      setAdAccepted(false);
      aiDraftBaselineRef.current = null;
    } catch (err: unknown) {
      if (requestId !== generationRequestIdRef.current) return;
      const raw = err instanceof Error ? err.message : String(err);
      const code = getErrorCode(err);
      const friendly = friendlyGenerationError(raw, code);
      setBanner({ message: friendly, tone: "error" });
    } finally {
      if (requestId === generationRequestIdRef.current) {
        setRevising(false);
      }
    }
  }

  function acceptAd() {
    if (!generatedAd) return;
    applyAdToDraft(generatedAd);
    setAdAccepted(true);
    setPublishStatus("idle");
    setPublishStatusMessage(null);
    trackEvent(AiAdsEvents.AD_SELECTED, {
      screen: "create_ai",
      creative_lane: "single",
      regeneration_attempt: revisionsUsed,
    });
    // Scroll to draft editor
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 200);
  }

  function useFallbackTemplateAd() {
    const fallbackPosterPath = generatedAd?.poster_storage_path ?? photoPath ?? null;
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
          photo_source: generatedAd?.poster_storage_path ? generatedAd.photo_source ?? "generated" : ("uploaded_original" as const),
          photo_treatment: generatedAd?.poster_storage_path ? generatedAd.photo_treatment ?? null : null,
        }
      : fallbackBaseAd;
    if (!fallbackPosterPath) {
      setUsePhotoAsFinal(true);
      setMerchantOriginalWarningAcknowledged(false);
    }
    setGeneratedAd(fallbackAd);
    rememberImageVersion(fallbackAd, "fallback");
    applyAdToDraft(fallbackAd);
    setAdAccepted(true);
    setManualDraftUnlocked(true);
    setLastGenerationError(null);
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
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 200);
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
      const message = t("createAi.publishMissingBody");
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

    // composedDescription includes the CTA — used ONLY for the quality + strong-deal
    // guards below, so an offer phrase that happens to live only in the CTA (e.g.
    // "Get one free") still satisfies validation.
    if (offerContract) {
      const mechanicsValidation = validateAiCopyAgainstOffer(
        {
          headline: title,
          short_description: promoLine || description,
          push_notification: generatedAd?.push_notification || title,
          social_caption: generatedAd?.social_caption,
          terms_summary: description,
        },
        offerContract,
      );
      if (!mechanicsValidation.valid) {
        const message = t("createAi.offerMechanicsInvalid", {
          defaultValue: "The ad copy changes the offer terms. Keep the required purchase, free item, discount, and location exactly as shown in the locked offer.",
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
    });
    if (!strongGuard.ok) {
      const key = `dealQuality.strongGuard.${strongGuard.reason}`;
      showPublishError(t(key, { defaultValue: t("dealQuality.strongDealMessage") }), "warning");
      return;
    }

    const isRecurring = validityMode === "recurring";
    if (!isRecurring && endTime.getTime() <= Date.now()) {
      showPublishError(t("createAi.errEndAfterStart"));
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
      const start = isRecurring ? new Date() : startTime;
      const end = isRecurring ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : endTime;

      const aiPosterPath = generatedAd?.poster_storage_path ?? null;
      const finalStoragePath = resolveCurrentDealPosterStoragePath({
        aiPosterStoragePath: aiPosterPath,
        uploadedPhotoStoragePath: userPhotoStoragePath,
        posterUrl,
        allowPhotoFallback: usePhotoAsFinal,
      });
      const finalPublicPoster = finalStoragePath ? buildPublicDealPhotoUrl(finalStoragePath) : null;
      const explicitPhotoPoster = usePhotoAsFinal ? signedPoster ?? posterUrl ?? null : null;
      const posterForPublish = finalPublicPoster ?? explicitPhotoPoster;
      const adForPublishSpec = generatedAdForPublishSpec({
        ad: generatedAd,
        finalStoragePath,
        uploadedPhotoStoragePath: userPhotoStoragePath,
        usePhotoAsFinal,
        merchantOriginalWarningAcknowledged,
      });
      const allowTextOnlyPoster =
        generatedAd?.photo_source === "copy_only" || generatedAd?.photo_source === "fallback_template";
      if (!posterForPublish && !allowTextOnlyPoster) {
        showPublishError(t("createAi.errImageRequired", {
          defaultValue: "Every deal needs an image. Add a photo, or generate again so AI can create one.",
        }));
        return;
      }
      const sourceLocaleForPublish = editingSourceLocale ?? prefillSourceLocale ?? dealOutputLang;
      const eligibilityColumns = dealEligibilityFormToDealColumns(eligibilityForm, eligibilityResult, "LIVE");
      const displayCopy = buildAuthoritativeDealDisplayCopy(offerDefinition, {
        title: title.trim(),
        description: listingDescription.trim(),
      });
      const translations = await translateDealCopy({
        business_id: businessId,
        title: displayCopy.title,
        description: displayCopy.description,
        source_locale: sourceLocaleForPublish,
      });

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
      } else {
        const locTargets =
          publishLocationIds.length > 0 ? publishLocationIds : [null as string | null];
        const rows = locTargets.map((lid) => ({ ...baseRow, location_id: lid }));
        if (!offerDefinition) throw new Error("Missing offer definition for versioned publish.");
        const versionedResult = await publishOfferVersionedDeal({
          business_id: businessId,
          offer_definition: offerDefinition,
          deal_rows: rows,
          idempotency_key:
            publishIdempotencyKeyRef.current ??
            (publishIdempotencyKeyRef.current = createPublishIdempotencyKey("create_ai")),
          ad_spec: buildOfferVersionPublishAdSpec("create_ai", offerDefinition, adForPublishSpec),
        });
        const dealsOut = versionedResult.deals.map((row) => ({
          id: row.deal_id,
          shouldNotify: row.idempotency_replayed !== true,
        }));
        for (const row of dealsOut) {
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
        setUsePhotoAsFinal(Boolean(savedPosterPath || savedPosterUrl));
        setMerchantOriginalWarningAcknowledged(false);
        setGeneratedAd(null);
        setImageVersions([]);
        setAdAccepted(false);
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
      let detail = "";
      if (err instanceof Error) {
        const m = err.message.toLowerCase();
        if (
          m.includes("must be at least 40") ||
          m.includes("give something free") ||
          m.includes("strong deal")
        ) {
          // Server strong-deal guardrail rejected the copy (it can be stricter than
          // the client mirror for some phrasings). Show the actionable guidance
          // instead of a bare "Publish failed" with no reason.
          detail = t("dealQuality.strongDealMessage");
        } else if (m.includes("row-level security") || m.includes("rls") || m.includes("policy")) {
          detail = t("createAi.errPublishPermission");
        } else if (m.includes("duplicate") || m.includes("unique")) {
          detail = t("createAi.errPublishDuplicate");
        } else if (m.includes("storage") || m.includes("upload")) {
          detail = t("createAi.errPublishPhoto");
        } else if (m.includes("network") || m.includes("fetch")) {
          detail = t("createAi.errPublishNetwork");
        }
      }
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
        aiPosterStoragePath: generatedAd?.poster_storage_path ?? null,
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
  const adImageUri = generatedAd?.poster_storage_path
    ? buildPublicDealPhotoUrl(generatedAd.poster_storage_path)
    : usePhotoAsFinal ? selectedPhotoUri : null;
  const originalStoragePath = photoPath ?? extractDealPhotoStoragePath(posterUrl);
  const currentImageVersionId = generatedAd ? imageVersionId(generatedAd) : null;
  const currentAdStoragePath = imageVersionStoragePath(generatedAd);
  const originalImageAd = generatedAd ? buildOriginalPhotoVersionAd(generatedAd, originalStoragePath) : null;
  const originalImageVersion = originalImageAd ? buildImageVersionEntry(originalImageAd, "original") : null;
  const composedAdPreviewEnabled =
    isAiV4ComposedAdCardEnabled() ||
    isAiV4SharedRendererEnabled() ||
    isAiV4AuthoritativeOfferCardEnabled();
  const composedOfferFacts = offerDefinition
    ? renderAuthoritativeOfferFromDefinition(offerDefinition)
    : buildLockedOfferContent({
        primaryOfferLine: generatedAd?.locked_offer_line || offerContract?.canonicalOfferLine || title || promoLine,
        termsLine: generatedAd?.locked_terms_line || offerContract?.canonicalShortTerms || description,
      });
  const composedPresentation = buildDefaultAdPresentationSpec({
    imageAssetId: generatedAd?.poster_storage_path ?? originalStoragePath ?? adImageUri ?? null,
    imageSourceType: adImageUri
      ? imageSourceTypeFromGeneratedAd(generatedAd) === "deterministic_fallback"
        ? "merchant_original"
        : imageSourceTypeFromGeneratedAd(generatedAd)
      : "deterministic_fallback",
    templateId: adImageUri ? "hero_image_overlay" : "split_offer_panel",
    themeId: colorScheme === "dark" ? "dark_neutral" : "light_neutral",
    resolutionReasonCodes: adImageUri ? ["MERCHANT_PREVIEW_IMAGE"] : ["MERCHANT_PREVIEW_FALLBACK"],
  });
  const composedCopy = buildApprovedAdCopy({
    headline: generatedAd?.headline,
    supportingCopy: generatedAd?.subheadline || generatedAd?.short_description,
    ctaLabel: generatedAd?.cta || ctaText,
    fallbackHeadline: composedOfferFacts.primaryOfferLine,
  });
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
  const imagePresetKeys =
    generatedAd?.photo_source === "generated" ||
    generatedAd?.photo_source === "stock" ||
    generatedAd?.photo_source === "copy_only"
    ? IMAGE_PRESET_KEYS_GENERATED
    : IMAGE_PRESET_KEYS_PHOTO;
  const presetKeysForTarget =
    revisionTarget === "image"
      ? imagePresetKeys
      : revisionTarget === "copy"
        ? COPY_PRESET_KEYS
        : [...COPY_PRESET_KEYS, ...imagePresetKeys];
  const targetLabel: Record<RevisionTarget, string> = {
    copy: t("createAi.reviseTargetCopy"),
    image: t("createAi.reviseTargetImage"),
    both: t("createAi.reviseTargetBoth"),
  };
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
      setStartTime(iosScheduleDraft);
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
          paddingBottom: scrollBottom,
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: "700", letterSpacing: -0.3, color: theme.text }}>
          {editingDealId ? t("createAi.titleEdit") : t("createAi.titleMain")}
        </Text>
        <Text style={{ marginTop: 4, opacity: 0.65, fontSize: 13, lineHeight: 18, color: theme.text }}>{t("createAi.intro")}</Text>

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

            {selectedPhotoUri ? (
              <Image
                source={{ uri: selectedPhotoUri }}
                style={{ height: 260, width: "100%", borderRadius: 18, marginTop: 12 }}
                contentFit="cover"
              />
            ) : (
              <View style={{ marginTop: 12 }}>
                <View style={{ height: 260, borderRadius: 18, backgroundColor: theme.surfaceMuted, borderWidth: 1.5, borderColor: theme.border, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 }}>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: theme.text }}>
                    {t("createAi.takePhoto")} / {t("createAi.pickPhoto")}
                  </Text>
                  <Text style={{ marginTop: 8, opacity: 0.72, textAlign: "center", color: theme.text }}>{t("createAi.photoHint")}</Text>
                </View>
              </View>
            )}

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
                      if (generatedAd) resetGenerationState();
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

            <View style={{ marginTop: 16 }}>
              <StepBadge n={2} total={3} t={t} />
            </View>
            <Text style={{ marginTop: 10, fontWeight: "700", color: theme.text }}>{t("createAi.fewWords")}</Text>
            <View style={{ marginTop: 6 }}>
              <TextInput
                value={hintText}
                onChangeText={setHintText}
                placeholder={t("createAi.hintPlaceholder")}
                placeholderTextColor={theme.mutedText}
                multiline
                style={{
                  borderWidth: 1,
                  borderColor: isRecording ? theme.danger : theme.border,
                  borderRadius: 14,
                  padding: 14,
                  paddingRight: Platform.OS !== "web" ? 56 : 14,
                  minHeight: 56,
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

            <Text style={{ marginTop: 12, color: theme.text }}>{t("createAi.priceOptional")}</Text>
            <TextInput
              value={price}
              onChangeText={(value) => setPrice(sanitizeDecimalInput(value))}
              keyboardType="decimal-pad"
              inputAccessoryViewID={IOS_DONE_INPUT_ACCESSORY_ID}
              returnKeyType="done"
              placeholder={t("createAi.placeholderPrice")}
              placeholderTextColor={theme.mutedText}
              style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, color: theme.text, backgroundColor: theme.surface }}
            />

            <DealEligibilityForm
              value={eligibilityForm}
              onChange={setEligibilityForm}
              t={t}
              theme={theme}
              colorScheme={colorScheme}
              inputAccessoryViewID={IOS_DONE_INPUT_ACCESSORY_ID}
              result={eligibilityResult}
            />

            <View
              onLayout={(e) => setScheduleSectionY(e.nativeEvent.layout.y)}
              style={{ marginTop: 16 }}
            >
              <StepBadge n={3} total={3} t={t} />
            </View>
            <Text style={{ marginTop: 10, fontWeight: "700", color: theme.text }}>{t("createAi.validity")}</Text>
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
                          setStartTime(merged);
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
                      onChange={(_event, date) => { setShowStartPicker(false); if (date) setStartTime(date); }}
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
              style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
            >
              <Text style={{ fontWeight: "700", color: theme.text }}>{t("createAi.claimSettingsHeader")}</Text>
              <Text style={{ fontSize: 12, opacity: 0.5, color: theme.text }}>
                {claimSettingsOpen ? "▲" : `${maxClaims} claims, ${cutoffMins} min ▼`}
              </Text>
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

            <View style={{ marginTop: 16, gap: 10 }}>
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
              ) : (
                <PrimaryButton
                  title={t("createAi.generateCta")}
                  onPress={() => void generateAd()}
                  disabled={revising}
                />
              )}
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

            {lastGenerationError && !generating ? (
              <View style={{ marginTop: 16, padding: 14, borderRadius: 8, backgroundColor: theme.surfaceMuted, borderWidth: 1, borderColor: theme.border, gap: 10 }}>
                {/* Header is the ACTUAL failure reason (cooldown / monthly cap / copy
                    failure / timeout / ownership), not a generic "couldn't generate"
                    line — so the cause is visible instead of hidden. */}
                <Text style={{ fontWeight: "700", color: theme.text }}>{lastGenerationError}</Text>
                <Text style={{ opacity: 0.8, lineHeight: 20, color: theme.text }}>
                  {t("createAi.fallbackTemplateBody", {
                    defaultValue: "AI image generation had trouble, so we made a clean fallback ad. You can publish this now or try AI again.",
                  })}
                </Text>
                <PrimaryButton
                  title={t("createAi.useFallbackTemplate", { defaultValue: "Use fallback template" })}
                  onPress={useFallbackTemplateAd}
                />
                <SecondaryButton
                  title={t("createAi.editFallbackDetails", { defaultValue: "Edit details" })}
                  onPress={() => {
                    setManualDraftUnlocked(true);
                    setBanner({ message: t("createAi.manualDraftBanner"), tone: "info" });
                  }}
                />
              </View>
            ) : null}

            {/* Single ad preview — text rendered natively over the image, not baked in */}
            {generatedAd ? (
              <View style={{ marginTop: 22, gap: 14 }}>
                <Text style={{ fontWeight: "700", fontSize: 16, color: theme.text }}>{t("createAi.yourAd")}</Text>

                {composedAdPreviewEnabled ? (
                  <ComposedAdCard
                    imageUri={adImageUri}
                    offerFacts={composedOfferFacts}
                    merchant={composedMerchant}
                    copy={composedCopy}
                    presentation={composedPresentation}
                    liveState={composedLiveState}
                    surface="merchant_preview"
                    fallbackVisualLabel={t("createAi.fallbackVisualLabel", { defaultValue: "Twofer fallback" })}
                  />
                ) : (
                  <GeneratedAdPreviewCard
                    imageUri={adImageUri}
                    businessName={businessName}
                    headline={generatedAd.headline}
                    body={generatedAd.subheadline}
                    offerLine={generatedAd.locked_offer_line || offerContract?.canonicalOfferLine}
                    termsLine={generatedAd.locked_terms_line || offerContract?.canonicalShortTerms}
                    cta={generatedAd.cta}
                    scheduleSummary={displayScheduleSummary}
                    maxClaimsLabel={t("createAi.maxClaimsLabel")}
                    maxClaimsValue={maxClaims}
                    termsLabel={t("createAi.lockedTermsLabel", { defaultValue: "Terms" })}
                    termsHelper={t("createAi.lockedTermsHelper", {
                      defaultValue: "The offer terms are locked so customers always see the correct deal.",
                    })}
                    noImageLabel={t("createAi.noImage")}
                    fallbackVisualLabel={t("createAi.fallbackVisualLabel", { defaultValue: "Twofer fallback" })}
                    addressLine={businessProfile?.address ?? businessProfile?.location ?? null}
                    theme={theme}
                    darkMode={colorScheme === "dark"}
                  />
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

                {generatedAd.item_research?.is_familiar && generatedAd.item_research.description ? (
                  <View style={{ padding: 12, borderRadius: 12, backgroundColor: colorScheme === "dark" ? "rgba(255,159,28,0.14)" : PrimaryTint.surface, borderLeftWidth: 3, borderLeftColor: theme.primary }}>
                    <Text style={{ fontSize: 11, fontWeight: "800", color: theme.accentText, letterSpacing: 0.5 }}>{t("createAi.researchLabel")}</Text>
                    <Text style={{ marginTop: 4, fontSize: 13, color: theme.mutedText, lineHeight: 19 }}>
                      {generatedAd.item_research.description}
                    </Text>
                  </View>
                ) : null}

                {/* Accept button */}
                {!adAccepted ? (
                  <PrimaryButton
                    title={t("createAi.useThisAd")}
                    onPress={acceptAd}
                  />
                ) : (
                  <View style={{ padding: 12, borderRadius: 12, backgroundColor: colorScheme === "dark" ? "rgba(255,159,28,0.14)" : PrimaryTint.surface, borderWidth: 1, borderColor: PrimaryTint.border }}>
                    <Text style={{ fontWeight: "700", color: theme.accentText }}>{t("createAi.adAccepted")}</Text>
                  </View>
                )}

                {/* Revise panel */}
                {!adAccepted ? (
                  <View style={{ padding: 16, borderRadius: 18, backgroundColor: theme.surfaceMuted, borderWidth: 1, borderColor: theme.border, gap: 12 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontWeight: "700", fontSize: 15, color: theme.text }}>{t("createAi.tweakTitle")}</Text>
                      <Text style={{ fontSize: 12, color: theme.mutedText }}>{revisionsLeftLabel}</Text>
                    </View>

                    {/* Target toggle */}
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      {(["copy", "image", "both"] as RevisionTarget[]).map((target) => {
                        const selected = revisionTarget === target;
                        return (
                          <Pressable
                            key={target}
                            onPress={() => { setRevisionTarget(target); setActivePreset(null); }}
                            style={{
                              flex: 1,
                              paddingVertical: 8,
                              borderRadius: 999,
                              backgroundColor: selected ? theme.primary : theme.surface,
                              borderWidth: 1,
                              borderColor: selected ? theme.primary : theme.border,
                            }}
                          >
                            <Text style={{ textAlign: "center", fontWeight: "700", color: selected ? theme.primaryText : colorScheme === "dark" ? theme.text : Gray[700], fontSize: 13 }}>
                              {targetLabel[target]}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* Presets */}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {presetKeysForTarget.map((presetKey) => {
                        const presetText = t(presetKey);
                        const selected = activePreset === presetText;
                        return (
                          <Pressable
                            key={presetKey}
                            onPress={() => setActivePreset(selected ? null : presetText)}
                            style={{
                              paddingVertical: 6,
                              paddingHorizontal: 12,
                              borderRadius: 999,
                              backgroundColor: selected ? theme.primary : theme.surface,
                              borderWidth: 1,
                              borderColor: selected ? theme.primary : theme.border,
                            }}
                          >
                            <Text style={{ fontSize: 12, fontWeight: "600", color: selected ? theme.primaryText : colorScheme === "dark" ? theme.text : Gray[700] }}>{presetText}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* Free-text feedback */}
                    <TextInput
                      value={revisionFeedback}
                      onChangeText={setRevisionFeedback}
                      placeholder={t("createAi.reviseFeedbackPlaceholder")}
                      placeholderTextColor={theme.mutedText}
                      multiline
                      style={{
                        borderWidth: 1,
                        borderColor: theme.border,
                        borderRadius: 12,
                        padding: 12,
                        minHeight: 50,
                        backgroundColor: theme.surface,
                        color: theme.text,
                        fontSize: 14,
                      }}
                    />

                    <SecondaryButton
                      title={revising ? t("createAi.reviseButtonBusy") : t("createAi.reviseButton")}
                      onPress={() => void reviseAd()}
                      disabled={revising || generating || revisionsUsed >= SOFT_REVISION_CAP}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Draft editor — appears once user accepts the ad or starts a manual draft */}
            {showDraftEditor ? (
              <>
                <Text style={{ marginTop: 22, fontWeight: "700" }}>{t("createAi.dealPreview")}</Text>
                <View
                  style={{
                    borderRadius: 18,
                    backgroundColor: theme.surface,
                    overflow: "hidden",
                    marginTop: 10,
                    borderWidth: 1,
                    borderColor: theme.border,
                  }}
                >
                  {(() => {
                    const previewUri = generatedAd?.poster_storage_path
                      ? buildPublicDealPhotoUrl(generatedAd.poster_storage_path)
                      : usePhotoAsFinal ? photoUri ?? posterUrl ?? null : null;
                    return previewUri ? (
                      <Image source={{ uri: previewUri }} style={{ height: 200, width: "100%" }} contentFit="cover" />
                    ) : (
                      <View style={{ height: 200, backgroundColor: theme.surfaceMuted }} />
                    );
                  })()}
                  <View style={{ padding: 12 }}>
                    <Text style={{ fontSize: 16, fontWeight: "700", color: theme.text }}>{title || t("createAi.placeholderDealTitle")}</Text>
                    {promoLine ? <Text style={{ marginTop: 6, fontWeight: "600", color: theme.text }}>{promoLine}</Text> : null}
                    {ctaText ? <Text style={{ marginTop: 6, fontWeight: "700", color: theme.text }}>{ctaText}</Text> : null}
                    <Text style={{ marginTop: 6, opacity: 0.8, color: theme.text }}>{description || t("createAi.placeholderOfferDetails")}</Text>
                    <Text style={{ marginTop: 8, opacity: 0.7, color: theme.text }}>{t("createAi.scheduleLabel")} {displayScheduleSummary}</Text>
                    <Text style={{ marginTop: 4, opacity: 0.7, color: theme.text }}>{t("createAi.maxClaimsLabel")} {maxClaims}</Text>
                  </View>
                </View>

                <Text style={{ marginTop: 16, color: theme.text }}>{t("createAi.editHeadline")}</Text>
                <TextInput value={title} onChangeText={setTitle} placeholder={t("createAi.headlinePlaceholder")} placeholderTextColor={theme.mutedText} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, color: theme.text, backgroundColor: theme.surface }} />
                <Text style={{ marginTop: 12, color: theme.text }}>{t("createAi.editSubheadline")}</Text>
                <TextInput value={promoLine} onChangeText={setPromoLine} placeholder={t("createAi.subheadlinePlaceholder")} placeholderTextColor={theme.mutedText} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, color: theme.text, backgroundColor: theme.surface }} />
                <Text style={{ marginTop: 12, color: theme.text }}>{t("createAi.editCta")}</Text>
                <TextInput value={ctaText} onChangeText={setCtaText} placeholder={t("createAi.ctaPlaceholder")} placeholderTextColor={theme.mutedText} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, color: theme.text, backgroundColor: theme.surface }} />
                <Text style={{ marginTop: 12, color: theme.text }}>{t("createAi.editDetails")}</Text>
                <TextInput value={description} onChangeText={setDescription} placeholder={t("createAi.detailsPlaceholder")} placeholderTextColor={theme.mutedText} multiline style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 6, minHeight: 90, color: theme.text, backgroundColor: theme.surface }} />

                <View style={{ marginTop: 16, gap: 8 }}>
                  <View
                    style={{
                      padding: 14,
                      borderRadius: 16,
                      backgroundColor: publishStatusCard.backgroundColor,
                      borderWidth: 1,
                      borderColor: publishStatusCard.borderColor,
                      flexDirection: "row",
                      gap: 10,
                      alignItems: "flex-start",
                    }}
                  >
                    <MaterialIcons name={publishStatusCard.icon} size={22} color={publishStatusCard.titleColor} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "800", color: publishStatusCard.titleColor }}>
                        {publishStatusCard.title}
                      </Text>
                      <Text style={{ marginTop: 4, color: theme.mutedText, lineHeight: 19 }}>
                        {publishStatusCard.body}
                      </Text>
                    </View>
                  </View>
                  <PrimaryButton
                    title={
                      displayedPublishStatus === "publishing"
                        ? t("createAi.publishing")
                        : displayedPublishStatus === "success"
                          ? editingDealId
                            ? t("createAi.publishUpdateSuccessTitle")
                            : t("createAi.publishSuccessTitle")
                          : editingDealId ? t("createAi.saveDealChanges") : t("createAi.publishDeal")
                    }
                    onPress={() => void publishDeal()}
                    disabled={displayedPublishStatus === "publishing" || displayedPublishStatus === "success"}
                  />
                  <SecondaryButton
                    title={savingTemplate ? t("createAi.savingTemplate") : t("createAi.saveTemplate")}
                    onPress={() => void saveTemplate()}
                    disabled={savingTemplate}
                  />
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
      <DancingPenguinProgressOverlay
        visible={generating}
        title={t("createAi.generateWorking")}
        message={selectedPhotoUri ? t("createAi.generatingWithPhoto") : t("createAi.generatingNoPhoto")}
        hint={t("createAi.generatingHint")}
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
