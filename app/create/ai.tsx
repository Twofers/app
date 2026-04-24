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
import { LinearGradient } from "expo-linear-gradient";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { useBusiness } from "../../hooks/use-business";
import { Banner } from "../../components/ui/banner";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import {
  aiCreateDeal,
  aiGenerateDealCopy,
  EDGE_FUNCTION_TIMEOUT_AI_MS,
  notifyDealPublished,
  translateDeal,
  parseFunctionError,
} from "../../lib/functions";
import {
  adToDealDraft,
  composeListingDescription,
  CREATIVE_LANE_I18N_KEY,
  CREATIVE_LANE_ORDER,
  type CreativeLane,
  type GeneratedAd,
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

/** English weekday labels for `offer_schedule_summary` sent to the edge function (stable for the model). */
const SCHEDULE_DAY_BY_VALUE: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
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

/** Sent to AI so copy matches the deal schedule (MVP test cases). */
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

/** Visual style per creative lane — gives each ad a distinct look. */
const AD_LANE_STYLES: Record<CreativeLane, {
  gradient: [string, string, string];
  accent: string;
  bg: string;
  badge: string;
  badgeText: string;
  ctaBg: string;
  ctaText: string;
}> = {
  value: {
    gradient: ["transparent", "rgba(255,159,28,0.45)", "rgba(255,100,0,0.92)"],
    accent: "#FF9F1C",
    bg: "#FFF8F0",
    badge: "#FF9F1C",
    badgeText: "#fff",
    ctaBg: "#FF9F1C",
    ctaText: "#fff",
  },
  neighborhood: {
    gradient: ["transparent", "rgba(16,85,60,0.4)", "rgba(10,65,45,0.90)"],
    accent: "#0B8457",
    bg: "#F0FAF5",
    badge: "#0B8457",
    badgeText: "#fff",
    ctaBg: "#0B8457",
    ctaText: "#fff",
  },
  premium: {
    gradient: ["transparent", "rgba(25,20,55,0.45)", "rgba(15,10,40,0.92)"],
    accent: "#6C3FC5",
    bg: "#F5F0FF",
    badge: "#6C3FC5",
    badgeText: "#fff",
    ctaBg: "#6C3FC5",
    ctaText: "#fff",
  },
};

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
const MAX_REGENERATIONS_PER_DRAFT = 2;

/** Manual QA tags for validation runs — see docs/ai-ad-validation/ */
const QA_CASE_IDS = Array.from({ length: 12 }, (_, i) => `TC${String(i + 1).padStart(2, "0")}`);

const DEFAULT_WEEKDAYS_SORTED_KEY = "1,2,3,4,5";

/** Empty input → `null` for APIs; non-empty but invalid → `NaN` (use `Number.isNaN` before saving). */
function parseOptionalPriceInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? NaN : n;
}

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
  } = useBusiness();
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

  const dayOptionsUi = useMemo(
    () => [
      { label: t("createAi.dayMon"), value: 1 },
      { label: t("createAi.dayTue"), value: 2 },
      { label: t("createAi.dayWed"), value: 3 },
      { label: t("createAi.dayThu"), value: 4 },
      { label: t("createAi.dayFri"), value: 5 },
      { label: t("createAi.daySat"), value: 6 },
      { label: t("createAi.daySun"), value: 7 },
    ],
    [t],
  );

  function laneUiTitle(lane: CreativeLane): string {
    const key = CREATIVE_LANE_I18N_KEY[lane];
    return key ? t(key) : t("createAi.optionFallback");
  }

  function formatPickerTime(date: Date) {
    return format(date, "p", { locale: dateFnsLocaleFor(i18n.language) });
  }

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
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
  /** Android needs two-step datetime: date picker first, then time picker. */
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
  const [generating, setGenerating] = useState(false);
  /** Phase-based progress: 0=copy, 1=images, 2=finishing */
  const [generatingPhase, setGeneratingPhase] = useState(0);
  const [generatedAds, setGeneratedAds] = useState<GeneratedAd[] | null>(null);
  const [selectedAdIndex, setSelectedAdIndex] = useState<number | null>(null);
  /** After "Use this ad", snapshot for detecting edits before publish */
  const aiDraftBaselineRef = useRef<{
    title: string;
    promo_line: string;
    cta_text: string;
    description: string;
  } | null>(null);
  /** Successful regenerations after the latest initial generation (max 2). */
  const [regenerationsUsed, setRegenerationsUsed] = useState(0);
  const [lastSuccessfulGenAttempt, setLastSuccessfulGenAttempt] = useState(0);
  const [manualDraftUnlocked, setManualDraftUnlocked] = useState(false);
  const [lastGenerationError, setLastGenerationError] = useState<string | null>(null);
  const [publishLocationIds, setPublishLocationIds] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  /** Tags generation in Supabase logs; see docs/ai-ad-validation/README.md */
  const [manualValidationTag, setManualValidationTag] = useState("");
  const [qaPanelOpen, setQaPanelOpen] = useState(false);
  const [devEdgeBusy, setDevEdgeBusy] = useState<"copy" | "create" | null>(null);
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const [scheduleSectionY, setScheduleSectionY] = useState<number | null>(null);
  const menuOfferScrollDoneRef = useRef(false);
  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [dealLoadError, setDealLoadError] = useState<string | null>(null);
  const [dealEditLoading, setDealEditLoading] = useState(false);

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
    selectedAdIndex !== null ||
    title.trim().length > 0 ||
    promoLine.trim().length > 0 ||
    ctaText.trim().length > 0 ||
    description.trim().length > 0 ||
    manualDraftUnlocked;

  const composeDirty = useMemo(() => {
    if (photoUri || hintText.trim() || price.trim()) return true;
    if (generatedAds != null || selectedAdIndex != null) return true;
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
    generatedAds,
    selectedAdIndex,
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

  // Phase-based progress message while generating (copy ~8s, images ~20s)
  useEffect(() => {
    if (!generating) {
      setGeneratingPhase(0);
      return;
    }
    const t1 = setTimeout(() => setGeneratingPhase(1), 8000);
    const t2 = setTimeout(() => setGeneratingPhase(2), 22000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [generating]);

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
      setPosterUrl((row.poster_url as string | null) ?? null);
      const pPath = row.poster_storage_path as string | null | undefined;
      if (pPath) setPhotoPath(pPath);
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
      setGeneratedAds(null);
      setSelectedAdIndex(null);
      aiDraftBaselineRef.current = null;
      setLastGenerationError(null);
      setTemplateLoaded(false);
      } finally {
        if (!cancelled) setDealEditLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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
        setGeneratedAds(null);
        setSelectedAdIndex(null);
        aiDraftBaselineRef.current = null;
        setManualDraftUnlocked(false);
        setLastGenerationError(null);
      }
    })();
    return () => { cancelled = true; };
  }, [dealIdFromRoute, templateId, businessId]);

  /** Deep-link prefill from AI Compose / menu-offer (full publish flow stays on this screen). */
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
    templateId,
    params.prefillTitle,
    params.prefillPromoLine,
    params.prefillCta,
    params.prefillDescription,
    params.prefillHint,
    params.prefillPrice,
    params.prefillPosterPath,
    params.fromAiCompose,
    params.fromMenuOffer,
    params.fromReuse,
    params.fromCreateHub,
    params.prefillLocationId,
    params.prefillExtraLocationIds,
    dealIdFromRoute,
    t,
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

  async function pickPhotoFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      setBanner({ message: t("createAi.errPhotoAccess"), tone: "error" });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setPhotoUri(result.assets[0].uri);
    setPosterUrl(null);
    setPhotoPath(null);
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
      const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : undefined;
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

  function validateInputs(forGenerate: boolean) {
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
    // Schedule only needs to be valid at publish time. For AI generation we use
    // whatever the merchant has so far (or defaults) as context — blocking the
    // creative step on a picker error is a terrible first impression.
    if (forGenerate) return true;
    if (validityMode === "one-time") {
      if (endTime <= startTime) {
        setBanner({ message: t("createAi.errEndAfterStart"), tone: "error" });
        return false;
      }

      const now = new Date();
      const durationMinutes = Math.floor((endTime.getTime() - now.getTime()) / 60000);
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

  function friendlyGenerationError(raw: string): string {
    const lower = raw.toLowerCase();
    if (
      lower.includes("openai_api_key") ||
      lower.includes("openai_key_missing") ||
      lower.includes("not set")
    ) {
      return t("createAi.friendlyOpenaiConfig");
    }
    if (lower.includes("unauthorized") || lower.includes("log in")) {
      return t("createAi.friendlySession");
    }
    if (lower.includes("photo") || lower.includes("access the photo")) {
      return t("createAi.friendlyPhoto");
    }
    if (lower.includes("regeneration limit")) {
      return t("createAi.friendlyRegenLimit");
    }
    if (
      lower.includes("rate limit") ||
      lower.includes("429") ||
      lower.includes("please wait") ||
      lower.includes("cooldown")
    ) {
      // The server includes the wait time in the raw message (e.g.
      // "Please wait 42s before..."), so surface it verbatim when short.
      if (raw.length <= 120) return raw;
      return t("createAi.friendlyGenerationRateLimit");
    }
    if (raw.length > 120) {
      return t("createAi.friendlyGenerationLongError");
    }
    return raw || t("createAi.fallbackIntro");
  }

  async function generateAdVariants(mode: "initial" | "regenerate") {
    if (!validateInputs(true)) return;
    if (!businessId) {
      setBanner({ message: t("createAi.errCreateBusinessFirst"), tone: "error" });
      return;
    }

    if (mode === "regenerate" && regenerationsUsed >= MAX_REGENERATIONS_PER_DRAFT) {
      const limTag = manualValidationTag.trim().slice(0, 80);
      trackEvent(AiAdsEvents.REGENERATE_LIMIT_HIT, {
        screen: "create_ai",
        ...(limTag ? { manual_validation_tag: limTag } : {}),
      });
      setBanner({
        message: t("createAi.errRegenClientLimit"),
        tone: "info",
      });
      return;
    }

    // Validate price before clearing state (so existing ads aren't wiped on bad input)
    const priceNumPreCheck = parseOptionalPriceInput(price);
    if (priceNumPreCheck !== null && Number.isNaN(priceNumPreCheck)) {
      setBanner({ message: t("createAi.errPriceNumber"), tone: "error" });
      return;
    }

    const attemptForApi = mode === "initial" ? 0 : regenerationsUsed + 1;

    const tagForLog = manualValidationTag.trim().slice(0, 80);

    if (mode === "initial") {
      trackEvent(AiAdsEvents.GENERATE_TAPPED, {
        screen: "create_ai",
        ...(tagForLog ? { manual_validation_tag: tagForLog } : {}),
      });
      setRegenerationsUsed(0);
    } else {
      trackEvent(AiAdsEvents.REGENERATE_TAPPED, {
        screen: "create_ai",
        attempt: attemptForApi,
        ...(tagForLog ? { manual_validation_tag: tagForLog } : {}),
      });
    }

    setGenerating(true);
    setBanner(null);
    setLastGenerationError(null);
    setSelectedAdIndex(null);
    setGeneratedAds(null);
    aiDraftBaselineRef.current = null;

    try {
      const path = await ensureUploadedPhoto();
      if (path) {
        await ensurePosterUrl(path);
      }
      const priceNum = priceNumPreCheck;
      const { data, error } = await supabase.functions.invoke("ai-generate-ad-variants", {
        body: {
          business_id: businessId,
          photo_path: path ?? null,
          hint_text: hintText.trim(),
          price: priceNum,
          business_context: businessContextForAi,
          regeneration_attempt: attemptForApi,
          offer_schedule_summary: offerScheduleSummary,
          output_language: dealOutputLang,
          ...(tagForLog ? { manual_validation_tag: tagForLog } : {}),
        },
        timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
      });
      if (error) {
        throw new Error(parseFunctionError(error));
      }
      if (data && typeof data === "object" && "error" in data) {
        throw new Error(String((data as { error?: string }).error ?? t("createAi.errGenerationFailed")));
      }
      const ads = (data as { ads?: GeneratedAd[] })?.ads;
      if (!Array.isArray(ads) || ads.length !== 3) {
        throw new Error(t("createAi.errUnexpectedAiResponse"));
      }
      setGeneratedAds(ads);
      setLastSuccessfulGenAttempt(attemptForApi);
      if (mode === "regenerate") {
        setRegenerationsUsed((u) => u + 1);
      }
      setLastGenerationError(null);
      setBanner({
        message:
          attemptForApi > 0 ? t("createAi.successBatchNew") : t("createAi.successBatchFirst"),
        tone: "success",
      });
      trackEvent(AiAdsEvents.GENERATION_SUCCEEDED, {
        screen: "create_ai",
        regeneration_attempt: attemptForApi,
        ...(tagForLog ? { manual_validation_tag: tagForLog } : {}),
      });
    } catch (err: unknown) {
      const raw =
        (err instanceof Error ? err.message : String(err)) || t("createAi.errAiGenerationFailed");
      const friendly = friendlyGenerationError(raw);
      setLastGenerationError(friendly);
      setBanner({ message: friendly, tone: "error" });
      trackEvent(AiAdsEvents.GENERATION_FAILED, {
        screen: "create_ai",
        regeneration_attempt: attemptForApi,
        message_snippet: raw.slice(0, 80),
        ...(tagForLog ? { manual_validation_tag: tagForLog } : {}),
      });
    } finally {
      setGenerating(false);
    }
  }

  async function devTestGenerateDealCopy() {
    if (!hintText.trim()) {
      setBanner({ message: t("createAi.errAddHint"), tone: "error" });
      return;
    }
    setDevEdgeBusy("copy");
    setBanner(null);
    try {
      const priceNum = parseOptionalPriceInput(price);
      const out = await aiGenerateDealCopy({
        hint_text: hintText.trim(),
        price: priceNum != null && !Number.isNaN(priceNum) ? priceNum : null,
        business_name: businessName ?? null,
        business_id: businessId ?? null,
      });
      const body = [`title: ${out.title}`, `promo_line: ${out.promo_line}`, `description: ${out.description}`].join(
        "\n\n",
      );
      Alert.alert(t("createAi.devCopyOkTitle"), body.length > 1600 ? `${body.slice(0, 1600)}…` : body);
    } catch (e: unknown) {
      Alert.alert(t("createAi.devCopyFailTitle"), e instanceof Error ? e.message : String(e));
    } finally {
      setDevEdgeBusy(null);
    }
  }

  function devPromptAiCreateDeal() {
    // Dev one-shot creates a real deal — needs full schedule validation.
    if (!validateInputs(false)) return;
    Alert.alert(t("createAi.devCreateConfirmTitle"), t("createAi.devCreateConfirmMsg"), [
      { text: t("createAi.cancel"), style: "cancel" },
      {
        text: t("createAi.devCreateConfirmRun"),
        style: "destructive",
        onPress: () => void runDevAiCreateDeal(),
      },
    ]);
  }

  async function runDevAiCreateDeal() {
    if (!businessId) return;
    setDevEdgeBusy("create");
    setBanner(null);
    try {
      const path = await ensureUploadedPhoto();
      if (!path) {
        throw new Error(t("createAi.errUploadPhotoForDevCreate"));
      }
      const maxClaimsNum = Number(maxClaims);
      const cutoffNum = Number(cutoffMins);
      const priceNum = parseOptionalPriceInput(price);
      const isRecurring = validityMode === "recurring";
      const end = isRecurring ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : endTime;
      const out = await aiCreateDeal({
        business_id: businessId,
        photo_path: path,
        hint_text: hintText.trim(),
        price: priceNum != null && !Number.isNaN(priceNum) ? priceNum : null,
        end_time: end.toISOString(),
        max_claims: maxClaimsNum,
        claim_cutoff_buffer_minutes: cutoffNum,
      });
      void notifyDealPublished(out.deal_id);
      void translateDeal(out.deal_id);
      Alert.alert(t("createAi.devCreateOkTitle"), `deal_id: ${out.deal_id}\n\n${out.title}`, [
        { text: t("commonUi.ok"), onPress: () => router.replace("/(tabs)/dashboard") },
      ]);
    } catch (e: unknown) {
      Alert.alert(t("createAi.devCreateFailTitle"), e instanceof Error ? e.message : String(e));
    } finally {
      setDevEdgeBusy(null);
    }
  }

  async function publishDeal() {
    if (!validateInputs(false)) return;
    if (!businessId) {
      setBanner({ message: t("createAi.errCreateBusinessFirst"), tone: "error" });
      return;
    }
    if (!canPublish) {
      setBanner({ message: t("createAi.errPublishDraft"), tone: "error" });
      return;
    }

    // Pre-flight validations (before setPublishing) so the button doesn't flash
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

    // Validate end_time is in the future for one-time deals (before setPublishing)
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
      const storagePath = path ?? extractDealPhotoStoragePath(posterUrl);
      const maxClaimsNum = Number(maxClaims);
      const cutoffNum = Number(cutoffMins);
      const start = isRecurring ? new Date() : startTime;
      const end = isRecurring ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : endTime;

      // Prefer AI-generated image from selected variant over user's uploaded photo
      const selectedAd = selectedAdIndex != null ? generatedAds?.[selectedAdIndex] : null;
      const aiPosterPath = selectedAd?.poster_storage_path ?? null;
      const finalStoragePath = aiPosterPath ?? storagePath;
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
          .update({
            ...baseRow,
            location_id: publishLocationIds[0] ?? null,
          })
          .eq("id", editingDealId)
          .eq("business_id", businessId);
        if (error) throw error;
        void notifyDealPublished(editingDealId);
        void translateDeal(editingDealId);
      } else {
        const locTargets =
          publishLocationIds.length > 0 ? publishLocationIds : [null as string | null];
        const rows = locTargets.map((lid) => ({
          ...baseRow,
          location_id: lid,
        }));
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
        const pubTag = manualValidationTag.trim().slice(0, 80);
        trackEvent(AiAdsEvents.PUBLISHED_WITH_AI_DRAFT, {
          screen: "create_ai",
          draft_edited: edited,
          ...(pubTag ? { manual_validation_tag: pubTag } : {}),
        });
      }

      router.replace("/(tabs)");
    } catch (err: unknown) {
      if (__DEV__) console.warn("[ai] Publish error:", err);
      // Surface a helpful error message, not just "Publish failed"
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
    } catch (err: unknown) {
      if (__DEV__) console.warn("[ai] Save template error:", err);
      setBanner({
        message: t("createAi.errSaveTemplateFailed"),
        tone: "error",
      });
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
      <View
        style={{
          paddingTop: top,
          paddingHorizontal: horizontal,
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator />
        <Text style={{ marginTop: Spacing.md, opacity: 0.7 }}>{t("createAi.loadingDeal")}</Text>
      </View>
    );
  }

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
        <View
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 14,
            backgroundColor: "#f0f7ff",
            borderWidth: 1,
            borderColor: "#c5daf7",
          }}
        >
          <Text style={{ fontWeight: "700", fontSize: 15, color: "#0d47a1" }}>{t("createAi.demoModeTitle")}</Text>
          <Text style={{ marginTop: 8, fontSize: 14, lineHeight: 21, color: "#1565c0" }}>
            {t("createAi.demoModeBody")}
          </Text>
        </View>
      ) : null}

      {__DEV__ ? (
        <Pressable
          onPress={() => setDevToolsOpen((o) => !o)}
          style={{ marginTop: 8, alignSelf: "flex-start", paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, backgroundColor: "#fff8e1", borderWidth: 1, borderColor: "#e6d29a" }}
        >
          <Text style={{ fontSize: 11, fontWeight: "700", color: "#b45309" }}>DEV ▾</Text>
        </Pressable>
      ) : null}
      {__DEV__ && devToolsOpen ? (
        <View style={{ marginTop: 6, padding: 12, borderRadius: 14, backgroundColor: "#fff8e1", borderWidth: 1, borderColor: "#e6d29a", gap: 8 }}>
          <SecondaryButton title={devEdgeBusy === "copy" ? t("createAi.devBusy") : t("createAi.devTestCopy")} onPress={() => void devTestGenerateDealCopy()} disabled={devEdgeBusy !== null} />
          <SecondaryButton title={devEdgeBusy === "create" ? t("createAi.devBusy") : t("createAi.devTestCreate")} onPress={devPromptAiCreateDeal} disabled={devEdgeBusy !== null} />
        </View>
      ) : null}

      <View style={{ marginTop: 12 }}>
        <Pressable
          onPress={() => setQaPanelOpen((o) => !o)}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 10,
            borderRadius: 10,
            backgroundColor: "#f3f3f3",
            alignSelf: "flex-start",
          }}
        >
          <Text style={{ fontWeight: "700", fontSize: 13 }}>
            {qaPanelOpen ? "▼" : "▶"} {t("createAi.qaToggle")}
          </Text>
        </Pressable>
        {qaPanelOpen ? (
          <View style={{ marginTop: 8, gap: 8 }}>
            <Text style={{ fontSize: 12, opacity: 0.75, lineHeight: 17 }}>{t("createAi.qaHelp")}</Text>
            <TextInput
              value={manualValidationTag}
              onChangeText={(text) => setManualValidationTag(text.slice(0, 80))}
              placeholder={t("createAi.qaPlaceholder")}
              autoCapitalize="characters"
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                borderRadius: 10,
                padding: 10,
                fontSize: 14,
              }}
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {QA_CASE_IDS.map((id) => (
                <Pressable
                  key={id}
                  onPress={() => setManualValidationTag(id)}
                  style={{
                    paddingVertical: 4,
                    paddingHorizontal: 8,
                    borderRadius: 8,
                    backgroundColor: manualValidationTag === id ? "#111" : "#eee",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "600",
                      color: manualValidationTag === id ? "#fff" : "#111",
                    }}
                  >
                    {id}
                  </Text>
                </Pressable>
              ))}
            </View>
            {manualValidationTag.trim() ? (
              <Text style={{ fontSize: 11, opacity: 0.6 }}>
                {t("createAi.qaActiveTag", { tag: manualValidationTag.trim() })}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}
      {dealLoadError ? (
        <Banner message={dealLoadError} tone="error" />
      ) : null}
      {String(params.fromMenuOffer ?? "") === "1" && !editingDealId ? (
        <View
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 14,
            backgroundColor: "rgba(255,159,28,0.12)",
            borderWidth: 1,
            borderColor: "rgba(255,159,28,0.45)",
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: "700", lineHeight: 20 }}>{t("createAi.menuOfferScheduleHint")}</Text>
        </View>
      ) : null}

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
          <View
            style={{
              marginTop: 14,
              borderRadius: 14,
              backgroundColor: "#f6f7fb",
              paddingHorizontal: 12,
              paddingVertical: 8,
              alignSelf: "flex-start",
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "800", letterSpacing: 0.2, opacity: 0.72 }}>
              {t("createAi.sectionPhoto")}
            </Text>
          </View>
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
              <View
                style={{
                  height: 260,
                  borderRadius: 18,
                  backgroundColor: "#f3f6ff",
                  borderWidth: 1.5,
                  borderColor: "#cfd7ff",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 16,
                }}
              >
                <Text style={{ fontSize: 18, fontWeight: "700", color: "#2f3fb2" }}>
                  {t("createAi.takePhoto")} / {t("createAi.pickPhoto")}
                </Text>
                <Text style={{ marginTop: 8, opacity: 0.72, textAlign: "center" }}>{t("createAi.photoHint")}</Text>
              </View>
            </View>
          )}

          <View
            style={{
              marginTop: 16,
              borderRadius: 14,
              backgroundColor: "#fff3e0",
              paddingHorizontal: 12,
              paddingVertical: 8,
              alignSelf: "flex-start",
              borderWidth: 1,
              borderColor: "rgba(255,159,28,0.45)",
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "800", letterSpacing: 0.2, color: "#b45309" }}>
              {t("createAi.sectionOffer")}
            </Text>
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
                style={{
                  position: "absolute",
                  right: 8,
                  bottom: 8,
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: isRecording ? "#e0245e" : "#111",
                  alignItems: "center",
                  justifyContent: "center",
                }}
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
            style={{
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 10,
              padding: 12,
              marginTop: 6,
            }}
          />

          <View
            onLayout={(e) => setScheduleSectionY(e.nativeEvent.layout.y)}
            style={{
              marginTop: 16,
              borderRadius: 14,
              backgroundColor: "#f6f7fb",
              paddingHorizontal: 12,
              paddingVertical: 8,
              alignSelf: "flex-start",
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "800", letterSpacing: 0.2, opacity: 0.72 }}>
              {t("createAi.sectionSchedule")}
            </Text>
          </View>
          <Text style={{ marginTop: 6, opacity: 0.65, fontSize: 12, lineHeight: 17 }}>
            {t("createAi.scheduleDefaultsHint")}
          </Text>
          <Text style={{ marginTop: 10, fontWeight: "700" }}>{t("createAi.validity")}</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Pressable
              onPress={() => setValidityMode("one-time")}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                backgroundColor: validityMode === "one-time" ? "#111" : "#eee",
              }}
            >
              <Text style={{ color: validityMode === "one-time" ? "#fff" : "#111", fontWeight: "700" }}>
                {t("createAi.oneTime")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setValidityMode("recurring")}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                backgroundColor: validityMode === "recurring" ? "#111" : "#eee",
              }}
            >
              <Text style={{ color: validityMode === "recurring" ? "#fff" : "#111", fontWeight: "700" }}>
                {t("createAi.recurring")}
              </Text>
            </Pressable>
          </View>

          {validityMode === "one-time" ? (
            <>
              <Text style={{ marginTop: 12 }}>{t("createAi.startTime")}</Text>
              <Pressable
                onPress={() => setShowStartPicker(true)}
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              >
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
                    onChange={(_event, date) => {
                      setShowStartPicker(false);
                      if (date) setStartTime(date);
                    }}
                  />
                )
              ) : null}

              <Text style={{ marginTop: 12 }}>{t("createAi.endTime")}</Text>
              <Pressable
                onPress={() => setShowEndPicker(true)}
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              >
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
                    onChange={(_event, date) => {
                      setShowEndPicker(false);
                      if (date) setEndTime(date);
                    }}
                  />
                )
              ) : null}
            </>
          ) : (
            <>
              <Text style={{ marginTop: 12 }}>{t("createAi.days")}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {dayOptionsUi.map((day) => {
                  const selected = daysOfWeek.includes(day.value);
                  return (
                    <Pressable
                      key={day.value}
                      onPress={() => {
                        setDaysOfWeek((prev) =>
                          selected ? prev.filter((d) => d !== day.value) : [...prev, day.value]
                        );
                      }}
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderRadius: 999,
                        backgroundColor: selected ? "#111" : "#eee",
                      }}
                    >
                      <Text style={{ color: selected ? "#fff" : "#111", fontWeight: "600" }}>
                        {day.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={{ marginTop: 12 }}>{t("createAi.timeWindow")}</Text>
              <Pressable
                onPress={() => setShowWindowStartPicker(true)}
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              >
                <Text>
                  {t("createAi.windowStart")} {formatMinutes(minutesFromDate(windowStart))}
                </Text>
              </Pressable>
              {showWindowStartPicker ? (
                <DateTimePicker
                  value={windowStart}
                  mode="time"
                  onChange={(_event, date) => {
                    setShowWindowStartPicker(false);
                    if (date) setWindowStart(date);
                  }}
                />
              ) : null}

              <Pressable
                onPress={() => setShowWindowEndPicker(true)}
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              >
                <Text>
                  {t("createAi.windowEnd")} {formatPickerTime(windowEnd)}
                </Text>
              </Pressable>
              {showWindowEndPicker ? (
                <DateTimePicker
                  value={windowEnd}
                  mode="time"
                  onChange={(_event, date) => {
                    setShowWindowEndPicker(false);
                    if (date) setWindowEnd(date);
                  }}
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
            style={{
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 10,
              padding: 12,
              marginTop: 6,
            }}
          />

          <Text style={{ marginTop: 12 }}>{t("createAi.cutoffBuffer")}</Text>
          <TextInput
            value={cutoffMins}
            onChangeText={setCutoffMins}
            keyboardType="number-pad"
            placeholder={t("createAi.placeholderCutoff")}
            style={{
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 10,
              padding: 12,
              marginTop: 6,
            }}
          />

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
              onPress={() => void generateAdVariants("initial")}
              disabled={generating}
              style={{ height: 62, borderRadius: 18 }}
            />
            {generatedAds && generatedAds.length === 3 ? (
              <>
                <SecondaryButton
                  title={generating ? t("createAi.regenerating") : t("createAi.regenerate")}
                  onPress={() => void generateAdVariants("regenerate")}
                  disabled={generating || regenerationsUsed >= MAX_REGENERATIONS_PER_DRAFT}
                />
                <Text style={{ fontSize: 14, opacity: 0.8, fontWeight: "600", textAlign: "center" }}>
                  {regenerationsUsed >= MAX_REGENERATIONS_PER_DRAFT
                    ? t("createAi.refreshLimitReached")
                    : t("createAi.refreshesLeft", {
                        remaining: MAX_REGENERATIONS_PER_DRAFT - regenerationsUsed,
                        total: MAX_REGENERATIONS_PER_DRAFT,
                      })}
                </Text>
              </>
            ) : null}
            {generating ? (
              <View style={{ marginTop: 4, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <ActivityIndicator />
                  <Text style={{ opacity: 0.75, flex: 1 }}>
                    {generatingPhase === 0
                      ? t("createAi.generatingPhaseCopy")
                      : generatingPhase === 1
                        ? t("createAi.generatingPhaseImages")
                        : t("createAi.generatingPhaseFinishing")}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>

          {lastGenerationError && !generating ? (
            <View
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 14,
                backgroundColor: "#fafafa",
                borderWidth: 1,
                borderColor: "#e0e0e0",
                gap: 10,
              }}
            >
              <Text style={{ fontWeight: "700" }}>{t("createAi.fallbackIntro")}</Text>
              <Text style={{ opacity: 0.8, lineHeight: 20 }}>{t("createAi.fallbackBody")}</Text>
              <SecondaryButton
                title={t("createAi.showDraftFields")}
                onPress={() => {
                  setManualDraftUnlocked(true);
                  setBanner({
                    message: t("createAi.manualDraftBanner"),
                    tone: "info",
                  });
                }}
              />
            </View>
          ) : null}

          {generatedAds && generatedAds.length === 3 ? (
            <View style={{ marginTop: 20, gap: 16 }}>
              <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("createAi.pickAdTitle")}</Text>
              <Text style={{ opacity: 0.7, marginBottom: 4 }}>{t("createAi.pickAdHelp")}</Text>
              {generatedAds.map((ad, index) => {
                const selected = selectedAdIndex === index;
                const laneKey = (ad.creative_lane ?? CREATIVE_LANE_ORDER[index]) as CreativeLane;
                const laneTitle = laneUiTitle(laneKey);
                const ls = AD_LANE_STYLES[laneKey] ?? AD_LANE_STYLES.value;
                // AI-generated image takes priority over user's uploaded photo
                const aiImageUri = ad.poster_storage_path
                  ? buildPublicDealPhotoUrl(ad.poster_storage_path)
                  : null;
                const cardImageUri = aiImageUri ?? photoUri ?? posterUrl ?? null;
                return (
                  <Pressable
                    key={`${ad.creative_lane ?? index}-${index}`}
                    onPress={() => {
                      setSelectedAdIndex(index);
                      applyAdToDraft(ad);
                      trackEvent(AiAdsEvents.AD_SELECTED, {
                        screen: "create_ai",
                        creative_lane: ad.creative_lane ?? CREATIVE_LANE_ORDER[index],
                        regeneration_attempt: lastSuccessfulGenAttempt,
                        ...(manualValidationTag.trim()
                          ? { manual_validation_tag: manualValidationTag.trim().slice(0, 80) }
                          : {}),
                      });
                    }}
                    style={{
                      borderRadius: 24,
                      overflow: "hidden",
                      borderWidth: selected ? 3 : 0,
                      borderColor: selected ? ls.accent : "transparent",
                      elevation: selected ? 6 : 3,
                      shadowColor: "#000",
                      shadowOpacity: selected ? 0.15 : 0.08,
                      shadowRadius: selected ? 14 : 8,
                      shadowOffset: { width: 0, height: selected ? 6 : 3 },
                    }}
                  >
                    {/* Hero image with gradient overlay and headline */}
                    <View style={{ height: 260, width: "100%", backgroundColor: "#222" }}>
                      {cardImageUri ? (
                        <Image
                          source={{ uri: cardImageUri }}
                          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
                          contentFit="cover"
                        />
                      ) : null}
                      <LinearGradient
                        colors={ls.gradient}
                        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
                      />
                      {/* Lane badge — top left */}
                      <View style={{ position: "absolute", top: 14, left: 14, flexDirection: "row", gap: 6 }}>
                        <View
                          style={{
                            backgroundColor: ls.badge,
                            paddingHorizontal: 12,
                            paddingVertical: 5,
                            borderRadius: 999,
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: "800", color: ls.badgeText, letterSpacing: 0.4 }}>
                            {laneTitle.toUpperCase()}
                          </Text>
                        </View>
                        <View
                          style={{
                            backgroundColor: "rgba(255,255,255,0.22)",
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: 999,
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: "700", color: "#fff" }}>
                            {ad.style_label}
                          </Text>
                        </View>
                      </View>
                      {/* Headline overlay — bottom of image */}
                      <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 18 }}>
                        <Text
                          style={{
                            fontSize: 22,
                            fontWeight: "900",
                            color: "#fff",
                            letterSpacing: -0.4,
                            lineHeight: 28,
                            textShadowColor: "rgba(0,0,0,0.5)",
                            textShadowOffset: { width: 0, height: 1 },
                            textShadowRadius: 4,
                          }}
                        >
                          {ad.headline}
                        </Text>
                      </View>
                    </View>

                    {/* Ad body section */}
                    <View style={{ backgroundColor: ls.bg, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18 }}>
                      <Text style={{ fontSize: 15, lineHeight: 22, color: "#333", fontWeight: "500" }}>
                        {ad.subheadline}
                      </Text>
                      {/* CTA button */}
                      <View
                        style={{
                          marginTop: 14,
                          backgroundColor: ls.ctaBg,
                          paddingVertical: 12,
                          paddingHorizontal: 20,
                          borderRadius: 14,
                          alignSelf: "flex-start",
                        }}
                      >
                        <Text style={{ fontSize: 15, fontWeight: "800", color: ls.ctaText, letterSpacing: 0.2 }}>
                          {ad.cta}
                        </Text>
                      </View>
                      {/* Business info + deal timing */}
                      <View
                        style={{
                          marginTop: 16,
                          paddingTop: 14,
                          borderTopWidth: 1,
                          borderTopColor: "rgba(0,0,0,0.08)",
                          gap: 6,
                        }}
                      >
                        {businessName ? (
                          <Text style={{ fontSize: 14, fontWeight: "700", color: "#222" }}>
                            {businessName}
                          </Text>
                        ) : null}
                        {businessProfile?.address || businessProfile?.location ? (
                          <Text style={{ fontSize: 13, color: "#555", lineHeight: 18 }}>
                            {businessProfile.address ?? businessProfile.location}
                          </Text>
                        ) : null}
                        <Text style={{ fontSize: 12, color: "#777", lineHeight: 17 }}>
                          {offerScheduleSummary}
                        </Text>
                      </View>
                      {/* Branding line */}
                      <View
                        style={{
                          marginTop: 12,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          opacity: 0.5,
                        }}
                      >
                        <View
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 8,
                            backgroundColor: ls.accent,
                          }}
                        />
                        <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 0.8, color: "#555" }}>
                          TWOFER
                        </Text>
                      </View>
                      {manualValidationTag.trim() ? (
                        <Text
                          style={{ fontSize: 10, color: "#888", marginTop: 8 }}
                          accessibilityLabel={`Creative lane ${ad.creative_lane}`}
                        >
                          {t("createAi.qaMetadata", { lane: ad.creative_lane })}
                        </Text>
                      ) : null}
                    </View>

                    {/* Selection indicator */}
                    <View
                      style={{
                        backgroundColor: selected ? ls.accent : "#f5f5f5",
                        paddingVertical: 14,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: "800",
                          color: selected ? "#fff" : "#555",
                          letterSpacing: 0.3,
                        }}
                      >
                        {selected ? t("createAi.selectedEditBelow") : t("createAi.useThisAd")}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

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
                  // Show AI-generated image from selected variant if available
                  const selectedAd = selectedAdIndex != null ? generatedAds?.[selectedAdIndex] : null;
                  const selectedAiUri = selectedAd?.poster_storage_path
                    ? buildPublicDealPhotoUrl(selectedAd.poster_storage_path)
                    : null;
                  const previewUri = selectedAiUri ?? photoUri ?? posterUrl ?? null;
                  return previewUri ? (
                    <Image
                      source={{ uri: previewUri }}
                      style={{ height: 200, width: "100%" }}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={{ height: 200, backgroundColor: "#eee" }} />
                  );
                })()}
                <View style={{ padding: 12 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700" }}>{title || t("createAi.placeholderDealTitle")}</Text>
                  {promoLine ? (
                    <Text style={{ marginTop: 6, fontWeight: "600" }}>{promoLine}</Text>
                  ) : null}
                  {ctaText ? (
                    <Text style={{ marginTop: 6, fontWeight: "700" }}>{ctaText}</Text>
                  ) : null}
                  <Text style={{ marginTop: 6, opacity: 0.8 }}>{description || t("createAi.placeholderOfferDetails")}</Text>
                  <Text style={{ marginTop: 8, opacity: 0.7 }}>
                    {t("createAi.scheduleLabel")} {offerScheduleSummary}
                  </Text>
                  <Text style={{ marginTop: 4, opacity: 0.7 }}>
                    {t("createAi.maxClaimsLabel")} {maxClaims}
                  </Text>
                </View>
              </View>

              <Text style={{ marginTop: 16 }}>{t("createAi.editHeadline")}</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={t("createAi.headlinePlaceholder")}
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              />
              <Text style={{ marginTop: 12 }}>{t("createAi.editSubheadline")}</Text>
              <TextInput
                value={promoLine}
                onChangeText={setPromoLine}
                placeholder={t("createAi.subheadlinePlaceholder")}
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              />
              <Text style={{ marginTop: 12 }}>{t("createAi.editCta")}</Text>
              <TextInput
                value={ctaText}
                onChangeText={setCtaText}
                placeholder={t("createAi.ctaPlaceholder")}
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              />
              <Text style={{ marginTop: 12 }}>{t("createAi.editDetails")}</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder={t("createAi.detailsPlaceholder")}
                multiline
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                  minHeight: 90,
                }}
              />

              <View style={{ marginTop: 16, gap: 8 }}>
                <PrimaryButton
                  title={
                    publishing
                      ? t("createAi.publishing")
                      : editingDealId
                        ? t("createAi.saveDealChanges")
                        : t("createAi.publishDeal")
                  }
                  onPress={publishDeal}
                  disabled={publishing}
                  style={{ height: 66, borderRadius: 20 }}
                />
                <SecondaryButton
                  title={savingTemplate ? t("createAi.savingTemplate") : t("createAi.saveTemplate")}
                  onPress={saveTemplate}
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
