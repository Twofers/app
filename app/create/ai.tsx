import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { File as ExpoFsFile } from "expo-file-system";
import DateTimePicker from "@react-native-community/datetimepicker";
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
import { useBusinessLocations } from "../../hooks/use-business-locations";
import { Banner } from "../../components/ui/banner";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import {
  aiGenerateAd,
  aiReviseAd,
  notifyDealPublished,
  translateDeal,
  getErrorCode,
} from "../../lib/functions";
import {
  adToDealDraft,
  composeListingDescription,
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
import { formatAppDateTime } from "../../lib/i18n/format-datetime";
import { buildPublicDealPhotoUrl, extractDealPhotoStoragePath } from "../../lib/deal-poster-url";
import { isDemoPreviewAccountEmail } from "../../lib/demo-account";
import { validateStrongDealOnly } from "../../lib/strong-deal-guard";
import {
  aiComposeOfferTranscribe,
  fetchAiComposeQuota,
  type AiComposeQuota,
} from "../../lib/ai-compose-offer";

type TemplateRow = {
  id: string;
  title: string | null;
  description: string | null;
  price: number | null;
  poster_url: string | null;
  max_claims: number;
  claim_cutoff_buffer_minutes: number;
  is_recurring: boolean;
  days_of_week: number[] | null;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
  timezone?: string | null;
};

const SCHEDULE_DAY_BY_VALUE: Record<number, string> = {
  1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun",
};

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
const SOFT_REVISION_CAP = 5;
const DEFAULT_WEEKDAYS_SORTED_KEY = "1,2,3,4,5";

function parseOptionalPriceInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? NaN : n;
}

type PhotoTreatmentOption = { key: PhotoTreatment; labelKey: string; helperKey: string };

const PHOTO_TREATMENT_OPTIONS: ReadonlyArray<PhotoTreatmentOption> = [
  { key: "touchup", labelKey: "createAi.treatmentTouchupLabel", helperKey: "createAi.treatmentTouchupHelper" },
  { key: "cleanbg", labelKey: "createAi.treatmentCleanbgLabel", helperKey: "createAi.treatmentCleanbgHelper" },
  { key: "studiopolish", labelKey: "createAi.treatmentStudiopolishLabel", helperKey: "createAi.treatmentStudiopolishHelper" },
];

type RevisionTarget = "copy" | "image" | "both";

const COPY_PRESET_KEYS = [
  "createAi.revisePresetShorter",
  "createAi.revisePresetCasual",
  "createAi.revisePresetProfessional",
  "createAi.revisePresetSavings",
  "createAi.revisePresetItem",
];

const IMAGE_PRESET_KEYS_GENERATED = [
  "createAi.revisePresetGenAngle",
  "createAi.revisePresetGenBrighter",
  "createAi.revisePresetGenMoodier",
];

const IMAGE_PRESET_KEYS_PHOTO = [
  "createAi.revisePresetPhotoBrighter",
  "createAi.revisePresetPhotoCrop",
  "createAi.revisePresetPhotoBg",
];

export default function AiDealScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
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
    fromAiCompose?: string;
    fromMenuOffer?: string;
    fromReuse?: string;
    fromCreateHub?: string;
    prefillLocationId?: string;
    prefillExtraLocationIds?: string;
  }>();
  const { templateId, dealId: dealIdParam } = params;
  const { t, i18n } = useTranslation();
  const {
    isLoggedIn,
    businessId,
    businessContextForAi,
    businessPreferredLocale,
    sessionEmail,
    businessName,
    businessProfile,
    subscriptionTier,
  } = useBusiness();
  // For owners with multiple locations: surface a picker so they can target a specific
  // location (or multiple at once on Premium). Without this, multi-location cafes always
  // got a deal scoped to whatever default location was active.
  const { visibleLocations: businessLocations } = useBusinessLocations(businessId, subscriptionTier);
  const isDemoAiAccount = isDemoPreviewAccountEmail(sessionEmail);
  const dealOutputLang = resolveDealFlowLanguage(businessPreferredLocale, i18n.language);

  // Voice input
  const recorder = useAudioRecorder(
    Platform.OS === "android" ? RecordingPresets.HIGH_QUALITY : RecordingPresets.LOW_QUALITY,
  );
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // AI quota
  const [quota, setQuota] = useState<AiComposeQuota | null>(null);
  const lastQuotaFetchRef = useRef(0);
  const reloadQuota = useCallback(async () => {
    if (!businessId) return;
    const q = await fetchAiComposeQuota(businessId);
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
  // Default to "touchup" — least aggressive transformation, lowest risk of distorting
  // a real product photo. First-time owners can opt up to clean-bg or studio polish.
  const [photoTreatment, setPhotoTreatment] = useState<PhotoTreatment>("touchup");

  const [hintText, setHintText] = useState("");
  const [price, setPrice] = useState("");
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
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
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

  const aiDraftBaselineRef = useRef<{
    title: string;
    promo_line: string;
    cta_text: string;
    description: string;
  } | null>(null);
  const [manualDraftUnlocked, setManualDraftUnlocked] = useState(false);
  const [lastGenerationError, setLastGenerationError] = useState<string | null>(null);
  const [publishLocationIds, setPublishLocationIds] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const [scheduleSectionY, setScheduleSectionY] = useState<number | null>(null);
  const menuOfferScrollDoneRef = useRef(false);
  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [dealLoadError, setDealLoadError] = useState<string | null>(null);
  const [dealEditLoading, setDealEditLoading] = useState(false);

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

  const canPublish = useMemo(() => {
    return title.trim().length > 0 && listingBody.trim().length > 0;
  }, [title, listingBody]);

  const showDraftEditor =
    templateLoaded ||
    editingDealId != null ||
    adAccepted ||
    title.trim().length > 0 ||
    promoLine.trim().length > 0 ||
    ctaText.trim().length > 0 ||
    description.trim().length > 0 ||
    manualDraftUnlocked;

  const composeDirty = useMemo(() => {
    if (photoUri || hintText.trim() || price.trim()) return true;
    if (generatedAd != null || adAccepted) return true;
    if (title.trim() || promoLine.trim() || ctaText.trim() || description.trim()) return true;
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
    maxClaims,
    cutoffMins,
    validityMode,
    daysOfWeek,
    manualDraftUnlocked,
    templateLoaded,
  ]);

  usePreventRemove(
    composeDirty,
    useCallback(
      ({ data }) => {
        Alert.alert(t("dealDraft.unsavedTitle"), t("dealDraft.unsavedBody"), [
          { text: t("dealDraft.keepEditing"), style: "cancel" },
          {
            text: t("dealDraft.discard"),
            style: "destructive",
            onPress: () => navigation.dispatch(data.action),
          },
        ]);
      },
      [navigation, t],
    ),
  );

  const dealIdFromRoute = useMemo(() => {
    const raw = dealIdParam;
    const s = Array.isArray(raw) ? raw[0] : raw;
    return typeof s === "string" ? s.trim() : "";
  }, [dealIdParam]);

  useEffect(() => {
    if (!dealIdFromRoute || !businessId) return;
    let cancelled = false;
    setDealLoadError(null);
    setDealEditLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("deals")
          .select(
            "id,title,description,price,poster_url,poster_storage_path,start_time,end_time,max_claims,claim_cutoff_buffer_minutes,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone,location_id",
          )
          .eq("id", dealIdFromRoute)
          .eq("business_id", businessId)
          .maybeSingle();
        if (cancelled) return;
        if (error || !data) {
          setDealLoadError(error?.message ?? "Not found");
          setEditingDealId(null);
          return;
        }
        const row = data as Record<string, unknown>;
        setEditingDealId(String(row.id));
        setTitle(String(row.title ?? ""));
        setDescription(String(row.description ?? ""));
        setPromoLine("");
        setCtaText("");
        setPrice(row.price != null ? String(row.price) : "");
        const rawPosterUrl = (row.poster_url as string | null) ?? null;
        const pPath = row.poster_storage_path as string | null | undefined;
        // Restore both the storage path AND a usable preview URL — without this the photo
        // selector renders empty when editing an existing deal that has a poster.
        if (pPath) {
          setPhotoPath(pPath);
          setPosterUrl(rawPosterUrl ?? buildPublicDealPhotoUrl(pPath));
        } else {
          setPosterUrl(rawPosterUrl);
        }
        setMaxClaims(String(row.max_claims ?? 50));
        setCutoffMins(String(row.claim_cutoff_buffer_minutes ?? 15));
        setValidityMode(row.is_recurring ? "recurring" : "one-time");
        if (row.start_time) setStartTime(new Date(String(row.start_time)));
        if (row.end_time) setEndTime(new Date(String(row.end_time)));
        setDaysOfWeek(
          Array.isArray(row.days_of_week) && row.days_of_week.length
            ? (row.days_of_week as number[])
            : [1, 2, 3, 4, 5],
        );
        if (row.window_start_minutes != null) {
          const wm = Number(row.window_start_minutes);
          const d = new Date();
          d.setHours(Math.floor(wm / 60), wm % 60, 0, 0);
          setWindowStart(d);
        }
        if (row.window_end_minutes != null) {
          const wm = Number(row.window_end_minutes);
          const d = new Date();
          d.setHours(Math.floor(wm / 60), wm % 60, 0, 0);
          setWindowEnd(d);
        }
        const tz = row.timezone;
        if (typeof tz === "string" && tz.trim()) setTimezone(tz.trim());
        else setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago");
        const lid = row.location_id;
        setPublishLocationIds(lid ? [String(lid)] : []);
        setManualDraftUnlocked(true);
        setGeneratedAd(null);
        setAdAccepted(false);
        aiDraftBaselineRef.current = null;
        setLastGenerationError(null);
        setTemplateLoaded(false);
      } finally {
        if (!cancelled) setDealEditLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dealIdFromRoute, businessId]);

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
        setTitle(row.title ?? "");
        setDescription(row.description ?? "");
        setPromoLine("");
        setCtaText("");
        setPrice(row.price != null ? String(row.price) : "");
        setPosterUrl(row.poster_url ?? null);
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
    const fromAi = g(params.fromAiCompose);
    const fromMenu = g(params.fromMenuOffer);
    const fromReuse = g(params.fromReuse);
    const fromHub = g(params.fromCreateHub);
    const pl = g(params.prefillLocationId).trim();
    const pe = g(params.prefillExtraLocationIds).trim();
    const locIds = [pl, ...pe.split(",").map((s) => s.trim()).filter(Boolean)].filter(Boolean);
    if (locIds.length) setPublishLocationIds(locIds);
    if (!pt && !pp && !pc && !pd && !ph && !price0 && !posterPath && locIds.length === 0) return;

    if (pt) setTitle((prev) => prev || pt);
    if (pp) setPromoLine((prev) => prev || pp);
    if (pc) setCtaText((prev) => prev || pc);
    if (pd) setDescription((prev) => prev || pd);
    if (ph) setHintText((prev) => prev || ph);
    if (price0) setPrice((prev) => prev || price0);
    if (posterPath) {
      setPhotoPath((prev) => prev || posterPath);
      setPosterUrl((prev) => prev || buildPublicDealPhotoUrl(posterPath));
    }

    if (fromAi === "1" && (pt || pp || pc || pd || ph || posterPath)) {
      setBanner({ message: t("createQuick.prefillFromAiCompose"), tone: "success" });
    } else if (fromMenu === "1" && (pt || pp || pc || pd || ph)) {
      setBanner({ message: t("createQuick.prefillFromMenuOffer"), tone: "success" });
    } else if (fromReuse === "1" && (pt || ph || price0)) {
      setBanner({ message: t("createAi.prefillFromReuse"), tone: "success" });
      setManualDraftUnlocked(true);
    } else if (fromHub === "1" && (pt || ph)) {
      setBanner({ message: t("createAi.prefillFromHub"), tone: "success" });
      setManualDraftUnlocked(true);
    }
  }, [
    templateId, params.prefillTitle, params.prefillPromoLine, params.prefillCta,
    params.prefillDescription, params.prefillHint, params.prefillPrice, params.prefillPosterPath,
    params.fromAiCompose, params.fromMenuOffer, params.fromReuse, params.fromCreateHub,
    params.prefillLocationId, params.prefillExtraLocationIds, dealIdFromRoute, t,
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

  /**
   * Reset everything generated from the previous photo/offer combination. Called whenever
   * the user changes the source inputs (new photo, new treatment) so we never publish a stale
   * AI-generated poster paired with a different photo.
   */
  function resetGenerationState() {
    setGeneratedAd(null);
    setAdAccepted(false);
    setRevisionsUsed(0);
    setRevisionFeedback("");
    setActivePreset(null);
    aiDraftBaselineRef.current = null;
    lastSentPhotoTreatmentRef.current = null;
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
    const asset = result.assets[0];
    // Size guard: a 12 MP phone photo is 6+ MB raw; uploads can stall for 30+ seconds
    // on cellular. Reject anything over 5 MB up front so we don't lose the user mid-upload.
    if (typeof asset.fileSize === "number" && asset.fileSize > 5 * 1024 * 1024) {
      setBanner({
        message: t("createAi.errPhotoTooLarge", { defaultValue: "Photo is too large (max 5 MB). Try a smaller one." }),
        tone: "error",
      });
      return;
    }
    setPhotoUri(asset.uri);
    setPosterUrl(null);
    setPhotoPath(null);
    resetGenerationState();
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
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (photo?.uri) {
        setPhotoUri(photo.uri);
        setPosterUrl(null);
        setPhotoPath(null);
        resetGenerationState();
      }
    } catch (e) {
      // Camera failures on lower-end Android: surface a banner so the user isn't stuck on
      // the camera modal with no feedback.
      setBanner({
        message: t("createAi.errCameraCapture", { defaultValue: "Could not take photo. Try again." }),
        tone: "error",
      });
    } finally {
      // Always close the camera modal so the user can recover via library upload.
      setShowCamera(false);
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
        setBanner({
          message: e instanceof Error ? e.message : t("createAi.transcribeFailed"),
          tone: "error",
        });
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
      // Reject scheduling deals that already started in the past (60s grace for clock skew).
      // This only applies to NEW deals — existing deals being edited are allowed to keep
      // their original startTime even if it's now in the past.
      if (!editingDealId && startTime.getTime() < Date.now() - 60_000) {
        setBanner({ message: t("createAi.errStartInPast", { defaultValue: "Start time can't be in the past." }), tone: "error" });
        return false;
      }
      // Cutoff is a buffer subtracted from end_time within the deal's own duration —
      // it must be smaller than the deal's total length, not just smaller than (endTime - now).
      const durationMinutes = Math.floor((endTime.getTime() - startTime.getTime()) / 60000);
      if (cutoffNum >= durationMinutes) {
        setBanner({ message: t("createQuick.errCutoffDuration"), tone: "error" });
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
        setBanner({ message: t("createQuick.errCutoffDuration"), tone: "error" });
        return false;
      }
    }
    return true;
  }

  async function ensureUploadedPhoto() {
    if (photoPath) return photoPath;
    if (!photoUri || !businessId) return null;
    const path = `${businessId}/${Date.now()}.jpg`;
    let body: Blob | ArrayBuffer;
    if (Platform.OS === "web") {
      const response = await fetch(photoUri);
      body = await response.blob();
    } else {
      const b64 = await new ExpoFsFile(photoUri).base64();
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      body = bytes.buffer;
    }
    const { error: uploadError } = await supabase.storage
      .from("deal-photos")
      .upload(path, body, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw uploadError;
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
    if (code === "OPENAI_KEY_MISSING") return t("createAi.friendlyOpenaiConfig");
    if (code === "MONTHLY_LIMIT") return t("createAi.friendlyGenerationRateLimit");
    if (code === "COOLDOWN_ACTIVE") return raw;
    if (code === "REVISION_LIMIT") return t("createAi.errRegenClientLimit");
    const lower = raw.toLowerCase();
    if (lower.includes("unauthorized") || lower.includes("log in")) {
      return t("createAi.friendlySession");
    }
    if (lower.includes("photo")) return t("createAi.friendlyPhoto");
    if (lower.length > 120) return t("createAi.friendlyGenerationLongError");
    return raw || t("createAi.fallbackIntro");
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

    trackEvent(AiAdsEvents.GENERATE_TAPPED, { screen: "create_ai" });
    setGenerating(true);
    setBanner(null);
    setLastGenerationError(null);
    resetGenerationState();
    const requestId = ++generationRequestIdRef.current;

    try {
      const path = await ensureUploadedPhoto();
      if (path) await ensurePosterUrl(path);
      // Snapshot the treatment we're about to send so revisions reference the same one
      // even if the user changes the selector mid-flight.
      const sentTreatment = path ? photoTreatment : null;

      const { ad } = await aiGenerateAd({
        business_id: businessId,
        hint_text: hintText.trim(),
        business_context: businessContextForAi,
        output_language: dealOutputLang,
        ...(path ? { photo_path: path, photo_treatment: photoTreatment } : {}),
        ...(offerScheduleSummary ? { offer_schedule_summary: offerScheduleSummary } : {}),
      });
      // Stale-result guard: discard if user kicked off another generation after this one.
      if (requestId !== generationRequestIdRef.current) return;
      lastSentPhotoTreatmentRef.current = sentTreatment;
      setGeneratedAd(ad);
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
      setGenerating(false);
    }
  }

  async function reviseAd() {
    if (!generatedAd || !businessId) return;
    if (revisionsUsed >= SOFT_REVISION_CAP) {
      setBanner({ message: t("createAi.errRegenClientLimit"), tone: "info" });
      return;
    }
    if (!activePreset && !revisionFeedback.trim()) {
      setBanner({ message: t("createAi.reviseErrPickSomething"), tone: "info" });
      return;
    }
    setRevising(true);
    setBanner(null);
    const requestId = ++generationRequestIdRef.current;
    /**
     * Send the treatment that produced the *previous* ad image, not the current UI selection.
     * This way the server's image-only revision applies enhancement consistent with what the
     * user is looking at, even if they fiddled with the selector after generating.
     */
    const treatmentForRevision =
      lastSentPhotoTreatmentRef.current ?? (photoPath ? photoTreatment : null);
    try {
      const { ad } = await aiReviseAd({
        business_id: businessId,
        hint_text: hintText.trim(),
        business_context: businessContextForAi,
        output_language: dealOutputLang,
        previous_ad: generatedAd,
        revision_target: revisionTarget,
        revision_count: revisionsUsed + 1,
        ...(activePreset ? { revision_preset: activePreset } : {}),
        ...(revisionFeedback.trim() ? { revision_feedback: revisionFeedback.trim() } : {}),
        ...(photoPath ? { photo_path: photoPath, photo_treatment: treatmentForRevision } : {}),
        ...(offerScheduleSummary ? { offer_schedule_summary: offerScheduleSummary } : {}),
      });
      // Stale-result guard: discard if user replaced the photo or kicked off another generation.
      if (requestId !== generationRequestIdRef.current) return;
      setGeneratedAd(ad);
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
      setRevising(false);
    }
  }

  function acceptAd() {
    if (!generatedAd) return;
    applyAdToDraft(generatedAd);
    setAdAccepted(true);
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

  async function publishDeal() {
    if (!validateInputs()) return;
    if (!businessId) {
      setBanner({ message: t("createAi.errCreateBusinessFirst"), tone: "error" });
      return;
    }
    if (!canPublish) {
      setBanner({ message: t("createAi.errPublishDraft"), tone: "error" });
      return;
    }
    const priceNum = parseOptionalPriceInput(price);
    if (priceNum !== null && Number.isNaN(priceNum)) {
      setBanner({ message: t("createAi.errPriceNumber"), tone: "error" });
      return;
    }

    const composedDescription = composeListingDescription(promoLine, ctaText, description);
    const quality = assessDealQuality({
      title: title.trim(),
      description: composedDescription,
      price: priceNum,
    });
    if (quality.blocked) {
      setBanner({
        message: translateDealQualityBlock(quality, dealOutputLang),
        tone: "error",
      });
      return;
    }

    const strongGuard = validateStrongDealOnly({
      title: title.trim(),
      description: composedDescription,
    });
    if (!strongGuard.ok) {
      const key = `dealQuality.strongGuard.${strongGuard.reason}`;
      setBanner({ message: t(key, { defaultValue: t("dealQuality.strongDealMessage") }), tone: "warning" });
      return;
    }

    const isRecurring = validityMode === "recurring";
    if (!isRecurring && endTime.getTime() <= Date.now()) {
      setBanner({ message: t("createAi.errEndAfterStart"), tone: "error" });
      return;
    }

    setPublishing(true);
    setBanner(null);
    try {
      const path = await ensureUploadedPhoto();
      const signedPoster = await ensurePosterUrl(path);
      const userPhotoStoragePath = path ?? extractDealPhotoStoragePath(posterUrl);
      const maxClaimsNum = Number(maxClaims);
      const cutoffNum = Number(cutoffMins);
      // Recurring deals don't have a meaningful end_time on the deal row itself — the
      // recurrence pattern (days_of_week + window) drives availability. Use a far-future
      // sentinel (5 years) so the deal doesn't silently expire from the merchant's view.
      // Previously this was 30 days, which surprised owners who expected "recurring" to
      // mean "always on".
      const RECURRING_FAR_FUTURE_MS = 5 * 365 * 24 * 60 * 60 * 1000;
      const recurringStart = (() => {
        // Normalize recurring start to start-of-today so editing later doesn't shift it.
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
      })();
      const start = isRecurring ? recurringStart : startTime;
      const end = isRecurring ? new Date(Date.now() + RECURRING_FAR_FUTURE_MS) : endTime;

      const aiPosterPath = generatedAd?.poster_storage_path ?? null;
      const finalStoragePath = aiPosterPath ?? userPhotoStoragePath;
      const finalPublicPoster = finalStoragePath ? buildPublicDealPhotoUrl(finalStoragePath) : null;

      const baseRow = {
        business_id: businessId,
        title: title.trim(),
        description: composedDescription.trim(),
        price: priceNum,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        claim_cutoff_buffer_minutes: cutoffNum,
        max_claims: maxClaimsNum,
        is_active: true,
        poster_url: finalPublicPoster ?? signedPoster ?? posterUrl ?? null,
        poster_storage_path: finalStoragePath ?? null,
        is_recurring: isRecurring,
        days_of_week: isRecurring ? daysOfWeek : null,
        window_start_minutes: isRecurring ? minutesFromDate(windowStart) : null,
        window_end_minutes: isRecurring ? minutesFromDate(windowEnd) : null,
        timezone: isRecurring ? timezone : null,
        quality_tier: quality.tier,
      };
      if (editingDealId) {
        const { error } = await supabase
          .from("deals")
          .update({ ...baseRow, location_id: publishLocationIds[0] ?? null })
          .eq("id", editingDealId)
          .eq("business_id", businessId);
        if (error) throw error;
        void notifyDealPublished(editingDealId);
        void translateDeal(editingDealId);
      } else {
        const locTargets =
          publishLocationIds.length > 0 ? publishLocationIds : [null as string | null];
        const rows = locTargets.map((lid) => ({ ...baseRow, location_id: lid }));
        const { data: dealsOut, error } = await supabase.from("deals").insert(rows).select("id");
        if (error) throw error;
        for (const row of dealsOut ?? []) {
          if (row?.id) {
            void notifyDealPublished(row.id);
            void translateDeal(row.id);
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

      router.replace("/(tabs)");
    } catch (err: unknown) {
      let detail = "";
      if (err instanceof Error) {
        const m = err.message.toLowerCase();
        if (m.includes("row-level security") || m.includes("rls") || m.includes("policy")) {
          detail = t("createAi.errPublishPermission");
        } else if (m.includes("duplicate") || m.includes("unique")) {
          detail = t("createAi.errPublishDuplicate");
        } else if (m.includes("storage") || m.includes("upload")) {
          detail = t("createAi.errPublishPhoto");
        } else if (m.includes("network") || m.includes("fetch")) {
          detail = t("createAi.errPublishNetwork");
        } else if (err.message.length <= 120) {
          detail = err.message;
        }
      }
      setBanner({
        message: detail
          ? `${t("createAi.errPublishFailed")} ${detail}`
          : t("createAi.errPublishFailed"),
        tone: "error",
      });
    } finally {
      setPublishing(false);
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
    setSavingTemplate(true);
    setBanner(null);
    try {
      const path = await ensureUploadedPhoto();
      const signedPoster = await ensurePosterUrl(path);
      const maxClaimsNum = Number(maxClaims);
      const cutoffNum = Number(cutoffMins);
      const isRecurring = validityMode === "recurring";
      const composedDescription = composeListingDescription(promoLine, ctaText, description);
      const storagePath = path ?? extractDealPhotoStoragePath(posterUrl);
      const durablePoster = storagePath ? buildPublicDealPhotoUrl(storagePath) : null;

      const { error } = await supabase.from("deal_templates").insert({
        business_id: businessId,
        title: title.trim(),
        description: composedDescription.trim(),
        price: priceNum,
        poster_url: durablePoster ?? signedPoster,
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
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("createAi.titleScreen")}</Text>
        <Text style={{ marginTop: Spacing.md, opacity: 0.7 }}>{t("createAi.loginPrompt")}</Text>
      </View>
    );
  }

  if (!businessId) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("createAi.titleScreen")}</Text>
        <Text style={{ marginTop: Spacing.md, opacity: 0.7 }}>{t("createAi.needBusiness")}</Text>
      </View>
    );
  }

  if (dealIdFromRoute && dealEditLoading) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: Spacing.md, opacity: 0.7 }}>{t("createAi.loadingDeal")}</Text>
      </View>
    );
  }

  const adImageUri = generatedAd?.poster_storage_path
    ? buildPublicDealPhotoUrl(generatedAd.poster_storage_path)
    : photoUri ?? posterUrl ?? null;
  const revisionsLeft = Math.max(0, SOFT_REVISION_CAP - revisionsUsed);
  const revisionsLeftLabel =
    revisionsLeft === 0
      ? t("createAi.reviseRevisionsNoneLeft")
      : revisionsLeft === 1
        ? t("createAi.reviseRevisionsLeftSingular")
        : t("createAi.reviseRevisionsLeftPlural", { count: revisionsLeft });
  const imagePresetKeys = generatedAd?.photo_source === "generated"
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

  return (
    <KeyboardScreen>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        {...FORM_SCROLL_KEYBOARD_PROPS}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: top,
          paddingHorizontal: horizontal,
          paddingBottom: scrollBottom,
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: "700", letterSpacing: -0.3 }}>
          {editingDealId ? t("createAi.titleEdit") : t("createAi.titleMain")}
        </Text>
        <Text style={{ marginTop: 4, opacity: 0.65, fontSize: 13, lineHeight: 18 }}>{t("createAi.intro")}</Text>

        {isDemoAiAccount ? (
          <View style={{ marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: "#f0f7ff", borderWidth: 1, borderColor: "#c5daf7" }}>
            <Text style={{ fontWeight: "700", fontSize: 15, color: "#0d47a1" }}>{t("createAi.demoModeTitle")}</Text>
            <Text style={{ marginTop: 8, fontSize: 14, lineHeight: 21, color: "#1565c0" }}>{t("createAi.demoModeBody")}</Text>
          </View>
        ) : null}

        {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}
        {dealLoadError ? <Banner message={dealLoadError} tone="error" /> : null}

        {showCamera ? (
          <View style={{ marginTop: 16, borderRadius: 16, overflow: "hidden" }}>
            <CameraView ref={cameraRef} style={{ height: 360, width: "100%" }} facing="back" />
            <View style={{ padding: 12, backgroundColor: "#111" }}>
              <PrimaryButton title={t("createAi.capturePhoto")} onPress={capturePhoto} />
              <View style={{ marginTop: 8 }}>
                <SecondaryButton title={t("createAi.cancel")} onPress={() => setShowCamera(false)} />
              </View>
            </View>
          </View>
        ) : (
          <>
            <StepBadge n={1} total={3} t={t} />
            <Text style={{ marginTop: 10, fontWeight: "700", fontSize: 16 }}>{t("createAi.photo")}</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <PrimaryButton title={t("createAi.takePhoto")} onPress={takePhoto} />
              <SecondaryButton title={t("createAi.pickPhoto")} onPress={pickPhotoFromLibrary} />
            </View>

            {photoUri || posterUrl ? (
              <Image
                source={{ uri: photoUri ?? posterUrl ?? "" }}
                style={{ height: 260, width: "100%", borderRadius: 18, marginTop: 12 }}
                contentFit="cover"
              />
            ) : (
              <View style={{ marginTop: 12 }}>
                <View style={{ height: 260, borderRadius: 18, backgroundColor: "#f3f6ff", borderWidth: 1.5, borderColor: "#cfd7ff", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 }}>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: "#2f3fb2" }}>
                    {t("createAi.takePhoto")} / {t("createAi.pickPhoto")}
                  </Text>
                  <Text style={{ marginTop: 8, opacity: 0.72, textAlign: "center" }}>{t("createAi.photoHint")}</Text>
                </View>
              </View>
            )}

            {photoUri || posterUrl ? (
              <View style={{ marginTop: 14 }}>
                <Text style={{ fontWeight: "700", fontSize: 14, marginBottom: 6 }}>{t("createAi.photoPolishTitle")}</Text>
                <Text style={{ opacity: 0.7, fontSize: 12, marginBottom: 8 }}>
                  {t("createAi.photoPolishHelp")}
                </Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {PHOTO_TREATMENT_OPTIONS.map((opt) => {
                    const selected = photoTreatment === opt.key;
                    return (
                      <Pressable
                        key={opt.key}
                        onPress={() => {
                          if (opt.key === photoTreatment) return;
                          setPhotoTreatment(opt.key);
                          // Stale-ad guard: changing the treatment after generating means the
                          // displayed ad no longer reflects the chosen polish.
                          if (generatedAd) resetGenerationState();
                        }}
                        style={{
                          flex: 1,
                          paddingVertical: 10,
                          paddingHorizontal: 8,
                          borderRadius: 12,
                          backgroundColor: selected ? "#FF9F1C" : "#f6f7fb",
                          borderWidth: selected ? 0 : 1,
                          borderColor: "#e0e3ec",
                        }}
                      >
                        <Text style={{ fontWeight: "700", fontSize: 13, color: selected ? "#fff" : "#111", textAlign: "center" }}>
                          {t(opt.labelKey)}
                        </Text>
                        <Text style={{ marginTop: 2, fontSize: 11, color: selected ? "#fff" : "#666", textAlign: "center" }}>
                          {t(opt.helperKey)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View style={{ marginTop: 16 }}>
              <StepBadge n={2} total={3} t={t} />
            </View>
            <Text style={{ marginTop: 10, fontWeight: "700" }}>{t("createAi.fewWords")}</Text>
            <View style={{ marginTop: 6 }}>
              <TextInput
                value={hintText}
                onChangeText={setHintText}
                placeholder={t("createAi.hintPlaceholder")}
                multiline
                style={{
                  borderWidth: 1,
                  borderColor: isRecording ? "#e0245e" : "#cfd3de",
                  borderRadius: 14,
                  padding: 14,
                  paddingRight: Platform.OS !== "web" ? 56 : 14,
                  minHeight: 56,
                  backgroundColor: "#fff",
                }}
              />
              {Platform.OS !== "web" ? (
                <Pressable
                  onPress={isRecording ? () => void stopRecordingAndTranscribe() : () => void startRecording()}
                  disabled={transcribing}
                  accessibilityRole="button"
                  accessibilityLabel={isRecording ? t("createAi.stopRecording", { defaultValue: "Stop recording" }) : t("createAi.startRecording", { defaultValue: "Record voice note" })}
                  style={{ position: "absolute", right: 8, bottom: 8, width: 40, height: 40, borderRadius: 20, backgroundColor: isRecording ? "#e0245e" : "#111", alignItems: "center", justifyContent: "center" }}
                >
                  {transcribing ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <MaterialIcons name={isRecording ? "stop" : "mic"} size={20} color="#fff" />
                  )}
                </Pressable>
              ) : null}
            </View>

            <Text style={{ marginTop: 12 }}>{t("createAi.priceOptional")}</Text>
            <TextInput
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder={t("createAi.placeholderPrice")}
              style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12, marginTop: 6 }}
            />

            <View
              onLayout={(e) => setScheduleSectionY(e.nativeEvent.layout.y)}
              style={{ marginTop: 16 }}
            >
              <StepBadge n={3} total={3} t={t} />
            </View>
            <Text style={{ marginTop: 10, fontWeight: "700" }}>{t("createAi.validity")}</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Pressable
                onPress={() => setValidityMode("one-time")}
                style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: validityMode === "one-time" ? "#111" : "#eee" }}
              >
                <Text style={{ color: validityMode === "one-time" ? "#fff" : "#111", fontWeight: "700" }}>{t("createAi.oneTime")}</Text>
              </Pressable>
              <Pressable
                onPress={() => setValidityMode("recurring")}
                style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: validityMode === "recurring" ? "#111" : "#eee" }}
              >
                <Text style={{ color: validityMode === "recurring" ? "#fff" : "#111", fontWeight: "700" }}>{t("createAi.recurring")}</Text>
              </Pressable>
            </View>

            {validityMode === "one-time" ? (
              <>
                <Text style={{ marginTop: 12 }}>{t("createAi.startTime")}</Text>
                <Pressable onPress={() => setShowStartPicker(true)} style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12, marginTop: 6 }}>
                  <Text>{formatAppDateTime(startTime, i18n.language)}</Text>
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
                  ) : (
                    <DateTimePicker
                      value={startTime}
                      mode="datetime"
                      onChange={(_event, date) => { setShowStartPicker(false); if (date) setStartTime(date); }}
                    />
                  )
                ) : null}

                <Text style={{ marginTop: 12 }}>{t("createAi.endTime")}</Text>
                <Pressable onPress={() => setShowEndPicker(true)} style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12, marginTop: 6 }}>
                  <Text>{formatAppDateTime(endTime, i18n.language)}</Text>
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
                  ) : (
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
                <Text style={{ marginTop: 12 }}>{t("createAi.days")}</Text>
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
                          setDaysOfWeek((prev) =>
                            selected ? prev.filter((d) => d !== day.value) : [...prev, day.value],
                          );
                        }}
                        style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: selected ? "#111" : "#eee" }}
                      >
                        <Text style={{ color: selected ? "#fff" : "#111", fontWeight: "600" }}>{day.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={{ marginTop: 12 }}>{t("createAi.timeWindow")}</Text>
                <Pressable onPress={() => setShowWindowStartPicker(true)} style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12, marginTop: 6 }}>
                  <Text>{t("createAi.windowStart")} {formatMinutes(minutesFromDate(windowStart))}</Text>
                </Pressable>
                {showWindowStartPicker ? (
                  <DateTimePicker
                    value={windowStart}
                    mode="time"
                    onChange={(_event, date) => { setShowWindowStartPicker(false); if (date) setWindowStart(date); }}
                  />
                ) : null}

                <Pressable onPress={() => setShowWindowEndPicker(true)} style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12, marginTop: 6 }}>
                  <Text>{t("createAi.windowEnd")} {formatPickerTime(windowEnd)}</Text>
                </Pressable>
                {showWindowEndPicker ? (
                  <DateTimePicker
                    value={windowEnd}
                    mode="time"
                    onChange={(_event, date) => { setShowWindowEndPicker(false); if (date) setWindowEnd(date); }}
                  />
                ) : null}
              </>
            )}

            <Text style={{ marginTop: 12 }}>{t("createAi.maxClaims")}</Text>
            <TextInput
              value={maxClaims}
              onChangeText={setMaxClaims}
              keyboardType="number-pad"
              placeholder={t("createAi.placeholderMaxClaims")}
              style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12, marginTop: 6 }}
            />

            <Text style={{ marginTop: 12 }}>{t("createAi.cutoffBuffer")}</Text>
            <TextInput
              value={cutoffMins}
              onChangeText={setCutoffMins}
              keyboardType="number-pad"
              placeholder={t("createAi.placeholderCutoff")}
              style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12, marginTop: 6 }}
            />

            {/*
              Multi-location picker — only renders when the merchant has more than one
              location configured. Premium owners can target multiple locations at once
              (creates one deal row per location at publish time); single-location cafes
              never see this section.
            */}
            {businessLocations.length > 1 ? (
              <View style={{ marginTop: 16 }}>
                <Text style={{ fontWeight: "700" }}>
                  {t("createAi.locationsHeader", { defaultValue: "Where does this deal run?" })}
                </Text>
                <Text style={{ marginTop: 4, opacity: 0.7, fontSize: 13 }}>
                  {subscriptionTier === "premium"
                    ? t("createAi.locationsHelpMulti", {
                        defaultValue: "Tap to toggle. Premium plan — pick one or more locations.",
                      })
                    : t("createAi.locationsHelpSingle", {
                        defaultValue: "Pick the location for this deal.",
                      })}
                </Text>
                <View style={{ marginTop: 8, gap: 6 }}>
                  {businessLocations.map((loc) => {
                    const selected = publishLocationIds.includes(loc.id);
                    return (
                      <Pressable
                        key={loc.id}
                        onPress={() => {
                          if (subscriptionTier === "premium") {
                            // Toggle membership.
                            setPublishLocationIds((prev) =>
                              prev.includes(loc.id)
                                ? prev.filter((id) => id !== loc.id)
                                : [...prev, loc.id],
                            );
                          } else {
                            // Pro tier: single-select.
                            setPublishLocationIds([loc.id]);
                          }
                        }}
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          borderWidth: selected ? 2 : 1,
                          borderColor: selected ? "#FF9F1C" : "#cfd3de",
                          backgroundColor: selected ? "#FFF6E6" : "#fff",
                        }}
                      >
                        <Text style={{ fontWeight: "700", fontSize: 14 }}>{loc.name}</Text>
                        {loc.address ? (
                          <Text style={{ marginTop: 2, opacity: 0.7, fontSize: 12 }}>{loc.address}</Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {quota && quota.remaining <= 5 && quota.remaining > 0 ? (
              <Banner message={t("createAi.quotaWarning", { remaining: quota.remaining })} tone="info" />
            ) : null}

            <View style={{ marginTop: 16, gap: 10 }}>
              {quota ? (
                <Text style={{ fontSize: 12, opacity: 0.5, textAlign: "center" }}>
                  {t("createAi.quotaRemaining", { remaining: quota.remaining, limit: quota.limit })}
                </Text>
              ) : null}
              <PrimaryButton
                title={generating ? t("createAi.generateWorking") : t("createAi.generateCta")}
                onPress={() => void generateAd()}
                disabled={generating || revising}
                style={{ height: 62, borderRadius: 18 }}
              />
              {generating ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 }}>
                  <ActivityIndicator />
                  <Text style={{ opacity: 0.75, flex: 1 }}>
                    {photoUri || posterUrl
                      ? t("createAi.generatingWithPhoto")
                      : t("createAi.generatingNoPhoto")}
                  </Text>
                </View>
              ) : null}
            </View>

            {lastGenerationError && !generating ? (
              <View style={{ marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: "#fafafa", borderWidth: 1, borderColor: "#e0e0e0", gap: 10 }}>
                <Text style={{ fontWeight: "700" }}>{t("createAi.fallbackIntro")}</Text>
                <Text style={{ opacity: 0.8, lineHeight: 20 }}>{t("createAi.fallbackBody")}</Text>
                <SecondaryButton
                  title={t("createAi.showDraftFields")}
                  onPress={() => {
                    setManualDraftUnlocked(true);
                    setBanner({ message: t("createAi.manualDraftBanner"), tone: "info" });
                  }}
                />
              </View>
            ) : null}

            {/* Single ad preview — text rendered ABOVE image, not baked in */}
            {generatedAd ? (
              <View style={{ marginTop: 22, gap: 14 }}>
                <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("createAi.yourAd")}</Text>

                {/* Ad card: text above, image below */}
                <View
                  style={{
                    borderRadius: 24,
                    backgroundColor: "#fff",
                    overflow: "hidden",
                    elevation: 4,
                    shadowColor: "#000",
                    shadowOpacity: 0.1,
                    shadowRadius: 12,
                    shadowOffset: { width: 0, height: 4 },
                  }}
                >
                  {/* Top — meta line */}
                  <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 4 }}>
                    {businessName ? (
                      <Text style={{ fontSize: 12, color: "#888", fontWeight: "600", letterSpacing: 0.3 }}>
                        {businessName.toUpperCase()}
                      </Text>
                    ) : null}
                  </View>

                  {/* Headline + subline */}
                  <View style={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 14 }}>
                    <Text style={{ fontSize: 24, fontWeight: "900", letterSpacing: -0.4, color: "#FF7A00", lineHeight: 28 }}>
                      {generatedAd.headline}
                    </Text>
                    <Text style={{ marginTop: 8, fontSize: 16, fontWeight: "500", color: "#222", lineHeight: 22 }}>
                      {generatedAd.subheadline}
                    </Text>
                  </View>

                  {/* Image */}
                  {adImageUri ? (
                    <Image
                      source={{ uri: adImageUri }}
                      style={{ height: 320, width: "100%" }}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={{ height: 200, backgroundColor: "#f0f0f0", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ opacity: 0.5 }}>{t("createAi.noImage")}</Text>
                    </View>
                  )}

                  {/* CTA + meta */}
                  <View style={{ paddingHorizontal: 18, paddingVertical: 16, gap: 10 }}>
                    <View
                      style={{
                        backgroundColor: "#FF9F1C",
                        paddingVertical: 12,
                        paddingHorizontal: 20,
                        borderRadius: 14,
                        alignSelf: "flex-start",
                      }}
                    >
                      <Text style={{ fontSize: 15, fontWeight: "800", color: "#fff", letterSpacing: 0.2 }}>
                        {generatedAd.cta}
                      </Text>
                    </View>
                    {businessProfile?.address || businessProfile?.location ? (
                      <Text style={{ fontSize: 13, color: "#666" }}>
                        {businessProfile.address ?? businessProfile.location}
                      </Text>
                    ) : null}
                    <Text style={{ fontSize: 12, color: "#888" }}>{displayScheduleSummary}</Text>
                  </View>
                </View>

                {generatedAd.item_research?.is_familiar && generatedAd.item_research.description ? (
                  <View style={{ padding: 12, borderRadius: 12, backgroundColor: "#f8f6f0", borderLeftWidth: 3, borderLeftColor: "#FF9F1C" }}>
                    <Text style={{ fontSize: 11, fontWeight: "800", color: "#a06400", letterSpacing: 0.5 }}>{t("createAi.researchLabel")}</Text>
                    <Text style={{ marginTop: 4, fontSize: 13, color: "#444", lineHeight: 19 }}>
                      {generatedAd.item_research.description}
                    </Text>
                  </View>
                ) : null}

                {/* Accept button */}
                {!adAccepted ? (
                  <PrimaryButton
                    title={t("createAi.useThisAd")}
                    onPress={acceptAd}
                    style={{ height: 56, borderRadius: 16 }}
                  />
                ) : (
                  <View style={{ padding: 12, borderRadius: 12, backgroundColor: "#e8f6e8", borderWidth: 1, borderColor: "#9ed79e" }}>
                    <Text style={{ fontWeight: "700", color: "#1a5f1a" }}>{t("createAi.adAccepted")}</Text>
                  </View>
                )}

                {/* Revise panel */}
                {!adAccepted ? (
                  <View style={{ padding: 16, borderRadius: 18, backgroundColor: "#fafbff", borderWidth: 1, borderColor: "#e0e3ec", gap: 12 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontWeight: "700", fontSize: 15 }}>{t("createAi.tweakTitle")}</Text>
                      <Text style={{ fontSize: 12, color: "#888" }}>{revisionsLeftLabel}</Text>
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
                              backgroundColor: selected ? "#111" : "#fff",
                              borderWidth: 1,
                              borderColor: selected ? "#111" : "#cfd3de",
                            }}
                          >
                            <Text style={{ textAlign: "center", fontWeight: "700", color: selected ? "#fff" : "#111", fontSize: 13 }}>
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
                              backgroundColor: selected ? "#FF9F1C" : "#fff",
                              borderWidth: 1,
                              borderColor: selected ? "#FF9F1C" : "#cfd3de",
                            }}
                          >
                            <Text style={{ fontSize: 12, fontWeight: "600", color: selected ? "#fff" : "#222" }}>{presetText}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* Free-text feedback */}
                    <TextInput
                      value={revisionFeedback}
                      onChangeText={setRevisionFeedback}
                      placeholder={t("createAi.reviseFeedbackPlaceholder")}
                      multiline
                      style={{
                        borderWidth: 1,
                        borderColor: "#cfd3de",
                        borderRadius: 12,
                        padding: 12,
                        minHeight: 50,
                        backgroundColor: "#fff",
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
                    backgroundColor: "#fff",
                    overflow: "hidden",
                    marginTop: 10,
                    boxShadow: "0px 4px 10px rgba(0,0,0,0.08)",
                    elevation: 2,
                  }}
                >
                  {(() => {
                    const previewUri = generatedAd?.poster_storage_path
                      ? buildPublicDealPhotoUrl(generatedAd.poster_storage_path)
                      : photoUri ?? posterUrl ?? null;
                    return previewUri ? (
                      <Image source={{ uri: previewUri }} style={{ height: 200, width: "100%" }} contentFit="cover" />
                    ) : (
                      <View style={{ height: 200, backgroundColor: "#eee" }} />
                    );
                  })()}
                  <View style={{ padding: 12 }}>
                    <Text style={{ fontSize: 16, fontWeight: "700" }}>{title || t("createAi.placeholderDealTitle")}</Text>
                    {promoLine ? <Text style={{ marginTop: 6, fontWeight: "600" }}>{promoLine}</Text> : null}
                    {ctaText ? <Text style={{ marginTop: 6, fontWeight: "700" }}>{ctaText}</Text> : null}
                    <Text style={{ marginTop: 6, opacity: 0.8 }}>{description || t("createAi.placeholderOfferDetails")}</Text>
                    <Text style={{ marginTop: 8, opacity: 0.7 }}>{t("createAi.scheduleLabel")} {displayScheduleSummary}</Text>
                    <Text style={{ marginTop: 4, opacity: 0.7 }}>{t("createAi.maxClaimsLabel")} {maxClaims}</Text>
                  </View>
                </View>

                <Text style={{ marginTop: 16 }}>{t("createAi.editHeadline")}</Text>
                <TextInput value={title} onChangeText={setTitle} placeholder={t("createAi.headlinePlaceholder")} style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12, marginTop: 6 }} />
                {/*
                  When editing an existing deal, the saved description already contains
                  promo + CTA + details combined (composeListingDescription). Showing the
                  promo/CTA fields would cause whatever the user types there to be DUPLICATED
                  on top of the inlined original. So we hide them on edit and let the user
                  edit the full description in one box.
                */}
                {!editingDealId ? (
                  <>
                    <Text style={{ marginTop: 12 }}>{t("createAi.editSubheadline")}</Text>
                    <TextInput value={promoLine} onChangeText={setPromoLine} placeholder={t("createAi.subheadlinePlaceholder")} style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12, marginTop: 6 }} />
                    <Text style={{ marginTop: 12 }}>{t("createAi.editCta")}</Text>
                    <TextInput value={ctaText} onChangeText={setCtaText} placeholder={t("createAi.ctaPlaceholder")} style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12, marginTop: 6 }} />
                  </>
                ) : null}
                <Text style={{ marginTop: 12 }}>{t("createAi.editDetails")}</Text>
                <TextInput value={description} onChangeText={setDescription} placeholder={t("createAi.detailsPlaceholder")} multiline style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12, marginTop: 6, minHeight: 90 }} />

                <View style={{ marginTop: 16, gap: 8 }}>
                  <PrimaryButton
                    title={publishing ? t("createAi.publishing") : editingDealId ? t("createAi.saveDealChanges") : t("createAi.publishDeal")}
                    onPress={() => void publishDeal()}
                    disabled={publishing}
                    style={{ height: 66, borderRadius: 20 }}
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
    </KeyboardScreen>
  );
}

function StepBadge({ n, total, t }: { n: number; total: number; t: (key: string, opts?: Record<string, unknown>) => string }) {
  return (
    <View style={{ borderRadius: 14, backgroundColor: "#f6f7fb", paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start" }}>
      <Text style={{ fontSize: 12, fontWeight: "800", letterSpacing: 0.2, opacity: 0.72 }}>
        {t("createAi.stepOfTotal", { current: n, total })}
      </Text>
    </View>
  );
}
