import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { useBusiness } from "../../hooks/use-business";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { aiCreateDeal, aiGenerateDealCopy, parseFunctionError } from "../../lib/functions";
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

const MAX_REGENERATIONS_PER_DRAFT = 2;

/** Manual QA tags for validation runs — see docs/ai-ad-validation/ */
const QA_CASE_IDS = Array.from({ length: 12 }, (_, i) => `TC${String(i + 1).padStart(2, "0")}`);

export default function AiDealScreen() {
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { templateId } = useLocalSearchParams<{ templateId?: string }>();
  const { t, i18n } = useTranslation();
  const {
    isLoggedIn,
    businessId,
    businessContextForAi,
    businessPreferredLocale,
    sessionEmail,
    businessName,
  } = useBusiness();
  const isDemoAiAccount = isDemoPreviewAccountEmail(sessionEmail);
  const dealOutputLang = resolveDealFlowLanguage(businessPreferredLocale, i18n.language);

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
  const [showWindowStartPicker, setShowWindowStartPicker] = useState(false);
  const [showWindowEndPicker, setShowWindowEndPicker] = useState(false);
  const [windowStart, setWindowStart] = useState(new Date());
  const [windowEnd, setWindowEnd] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [timezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago"
  );
  const [banner, setBanner] = useState<{
    message: string;
    tone?: "error" | "success" | "info" | "warning";
  } | null>(null);
  const [generating, setGenerating] = useState(false);
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
  const [publishing, setPublishing] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  /** Tags generation in Supabase logs; see docs/ai-ad-validation/README.md */
  const [manualValidationTag, setManualValidationTag] = useState("");
  const [qaPanelOpen, setQaPanelOpen] = useState(false);
  const [devEdgeBusy, setDevEdgeBusy] = useState<"copy" | "create" | null>(null);

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
    selectedAdIndex !== null ||
    title.trim().length > 0 ||
    promoLine.trim().length > 0 ||
    ctaText.trim().length > 0 ||
    description.trim().length > 0 ||
    manualDraftUnlocked;

  useEffect(() => {
    if (!templateId || !businessId) return;
    (async () => {
      const { data, error } = await supabase
        .from("deal_templates")
        .select("*")
        .eq("id", templateId)
        .eq("business_id", businessId)
        .single();
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
        setTemplateLoaded(true);
        setGeneratedAds(null);
        setSelectedAdIndex(null);
        aiDraftBaselineRef.current = null;
        setManualDraftUnlocked(false);
        setLastGenerationError(null);
      }
    })();
  }, [templateId, businessId]);

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
    if (validityMode === "one-time") {
      if (endTime <= startTime) {
        setBanner({ message: t("createAi.errEndAfterStart"), tone: "error" });
        return false;
      }
    } else {
      if (daysOfWeek.length === 0) {
        setBanner({ message: t("createAi.errRecurringDay"), tone: "error" });
        return false;
      }
      if (minutesFromDate(windowStart) >= minutesFromDate(windowEnd)) {
        setBanner({ message: t("createAi.errRecurringWindow"), tone: "error" });
        return false;
      }
    }
    if (forGenerate) {
      if (!photoUri && !posterUrl) {
        setBanner({ message: t("createAi.errAddPhoto"), tone: "error" });
        return false;
      }
      if (!hintText.trim()) {
        setBanner({ message: t("createAi.errAddHint"), tone: "error" });
        return false;
      }
    }
    return true;
  }

  async function ensureUploadedPhoto() {
    if (photoPath) return photoPath;
    if (!photoUri || !businessId) return null;
    const path = `${businessId}/${Date.now()}.jpg`;
    const response = await fetch(photoUri);
    const blob = await response.blob();
    const { error: uploadError } = await supabase.storage
      .from("deal-photos")
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
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
    if (lower.includes("openai_api_key") || lower.includes("not set")) {
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
    if (lower.includes("rate limit") || lower.includes("429")) {
      return t("createAi.friendlyGenerationRateLimit");
    }
    if (raw.length > 120) {
      return t("createAi.friendlyGenerationLongError");
    }
    return t("createAi.fallbackIntro");
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
      if (!path) {
        throw new Error(t("createAi.errUploadPhotoBeforeGenerate"));
      }
      await ensurePosterUrl(path);
      const priceNum = price.trim() ? Number(price) : null;
      if (price.trim() && (priceNum === null || Number.isNaN(priceNum))) {
        setBanner({ message: t("createAi.errPriceNumber"), tone: "error" });
        return;
      }
      const { data, error } = await supabase.functions.invoke("ai-generate-ad-variants", {
        body: {
          business_id: businessId,
          photo_path: path,
          hint_text: hintText.trim(),
          price: priceNum,
          business_context: businessContextForAi,
          regeneration_attempt: attemptForApi,
          offer_schedule_summary: offerScheduleSummary,
          output_language: dealOutputLang,
          ...(tagForLog ? { manual_validation_tag: tagForLog } : {}),
        },
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
    } catch (err: any) {
      const raw = err?.message ?? t("createAi.errAiGenerationFailed");
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
      const priceNum = price.trim() ? Number(price) : null;
      const out = await aiGenerateDealCopy({
        hint_text: hintText.trim(),
        price: priceNum != null && !Number.isNaN(priceNum) ? priceNum : null,
        business_name: businessName ?? null,
      });
      const body = [`title: ${out.title}`, `promo_line: ${out.promo_line}`, `description: ${out.description}`].join(
        "\n\n",
      );
      Alert.alert(t("createAi.devCopyOkTitle"), body.length > 1600 ? `${body.slice(0, 1600)}…` : body);
    } catch (e: any) {
      Alert.alert(t("createAi.devCopyFailTitle"), e?.message ?? String(e));
    } finally {
      setDevEdgeBusy(null);
    }
  }

  function devPromptAiCreateDeal() {
    if (!validateInputs(true)) return;
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
      const priceNum = price.trim() ? Number(price) : null;
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
      Alert.alert(t("createAi.devCreateOkTitle"), `deal_id: ${out.deal_id}\n\n${out.title}`, [
        { text: t("commonUi.ok"), onPress: () => router.replace("/(tabs)/dashboard") },
      ]);
    } catch (e: any) {
      Alert.alert(t("createAi.devCreateFailTitle"), e?.message ?? String(e));
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
    setPublishing(true);
    setBanner(null);
    try {
      const path = await ensureUploadedPhoto();
      const signedPoster = await ensurePosterUrl(path);
      const storagePath = path ?? extractDealPhotoStoragePath(posterUrl);
      const publicPoster = storagePath ? buildPublicDealPhotoUrl(storagePath) : null;
      const priceNum = price.trim() ? Number(price) : null;
      if (price.trim() && Number.isNaN(priceNum)) {
        setBanner({ message: t("createAi.errPriceNumber"), tone: "error" });
        return;
      }
      const maxClaimsNum = Number(maxClaims);
      const cutoffNum = Number(cutoffMins);
      const isRecurring = validityMode === "recurring";
      const start = isRecurring ? new Date() : startTime;
      const end = isRecurring ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : endTime;

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
        setBanner({ message: strongGuard.message, tone: "warning" });
        return;
      }

      const { error } = await supabase.from("deals").insert({
        business_id: businessId,
        title: title.trim(),
        description: composedDescription.trim(),
        price: priceNum,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        claim_cutoff_buffer_minutes: cutoffNum,
        max_claims: maxClaimsNum,
        is_active: true,
        poster_url: publicPoster ?? signedPoster ?? posterUrl ?? null,
        poster_storage_path: storagePath ?? null,
        is_recurring: isRecurring,
        days_of_week: isRecurring ? daysOfWeek : null,
        window_start_minutes: isRecurring ? minutesFromDate(windowStart) : null,
        window_end_minutes: isRecurring ? minutesFromDate(windowEnd) : null,
        timezone: isRecurring ? timezone : null,
        quality_tier: quality.tier,
      });
      if (error) throw error;

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
    } catch (err: any) {
      setBanner({ message: err?.message ?? t("createAi.errPublishFailed"), tone: "error" });
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
    setSavingTemplate(true);
    setBanner(null);
    try {
      const path = await ensureUploadedPhoto();
      const signedPoster = await ensurePosterUrl(path);
      const priceNum = price.trim() ? Number(price) : null;
      if (price.trim() && Number.isNaN(priceNum)) {
        setBanner({ message: t("createAi.errPriceNumber"), tone: "error" });
        return;
      }
      const maxClaimsNum = Number(maxClaims);
      const cutoffNum = Number(cutoffMins);
      const isRecurring = validityMode === "recurring";

      const composedDescription = composeListingDescription(promoLine, ctaText, description);

      const { error } = await supabase.from("deal_templates").insert({
        business_id: businessId,
        title: title.trim(),
        description: composedDescription.trim(),
        price: priceNum,
        poster_url: signedPoster,
        max_claims: maxClaimsNum,
        claim_cutoff_buffer_minutes: cutoffNum,
        is_recurring: isRecurring,
        days_of_week: isRecurring ? daysOfWeek : null,
        window_start_minutes: isRecurring ? minutesFromDate(windowStart) : null,
        window_end_minutes: isRecurring ? minutesFromDate(windowEnd) : null,
      });
      if (error) throw error;
      setBanner({ message: t("createAi.templateSaved"), tone: "success" });
    } catch (err: any) {
      setBanner({ message: err?.message ?? t("createAi.errSaveTemplateFailed"), tone: "error" });
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

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingTop: top,
        paddingHorizontal: horizontal,
        paddingBottom: scrollBottom,
      }}
    >
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("createAi.titleMain")}</Text>
      <Text style={{ marginTop: 10, opacity: 0.75, lineHeight: 20 }}>{t("createAi.intro")}</Text>

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
        <View
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 14,
            backgroundColor: "#fff8e1",
            borderWidth: 1,
            borderColor: "#e6d29a",
            gap: 10,
          }}
        >
          <Text style={{ fontWeight: "700", fontSize: 15 }}>{t("createAi.devToolsTitle")}</Text>
          <Text style={{ fontSize: 12, opacity: 0.78, lineHeight: 18 }}>{t("createAi.devToolsIntro")}</Text>
          <SecondaryButton
            title={devEdgeBusy === "copy" ? t("createAi.devBusy") : t("createAi.devTestCopy")}
            onPress={() => void devTestGenerateDealCopy()}
            disabled={devEdgeBusy !== null}
          />
          <SecondaryButton
            title={devEdgeBusy === "create" ? t("createAi.devBusy") : t("createAi.devTestCreate")}
            onPress={devPromptAiCreateDeal}
            disabled={devEdgeBusy !== null}
          />
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
            <Text style={{ fontSize: 12, fontWeight: "800", letterSpacing: 0.2, opacity: 0.72 }}>Step 1</Text>
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
              backgroundColor: "#f6f7fb",
              paddingHorizontal: 12,
              paddingVertical: 8,
              alignSelf: "flex-start",
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "800", letterSpacing: 0.2, opacity: 0.72 }}>Step 2</Text>
          </View>
          <Text style={{ marginTop: 10, fontWeight: "700" }}>{t("createAi.fewWords")}</Text>
          <TextInput
            value={hintText}
            onChangeText={setHintText}
            placeholder={t("createAi.hintPlaceholder")}
            style={{
              borderWidth: 1,
              borderColor: "#cfd3de",
              borderRadius: 14,
              padding: 14,
              marginTop: 6,
              backgroundColor: "#fff",
            }}
          />

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
            style={{
              marginTop: 16,
              borderRadius: 14,
              backgroundColor: "#f6f7fb",
              paddingHorizontal: 12,
              paddingVertical: 8,
              alignSelf: "flex-start",
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "800", letterSpacing: 0.2, opacity: 0.72 }}>Step 3</Text>
          </View>
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
                <Text>{startTime.toLocaleString()}</Text>
              </Pressable>
              {showStartPicker ? (
                <DateTimePicker
                  value={startTime}
                  mode="datetime"
                  onChange={(_event, date) => {
                    setShowStartPicker(false);
                    if (date) setStartTime(date);
                  }}
                />
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
                <DateTimePicker
                  value={endTime}
                  mode="datetime"
                  onChange={(_event, date) => {
                    setShowEndPicker(false);
                    if (date) setEndTime(date);
                  }}
                />
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

          <View style={{ marginTop: 16, gap: 10 }}>
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
                <Text style={{ fontSize: 12, opacity: 0.6 }}>
                  {regenerationsUsed >= MAX_REGENERATIONS_PER_DRAFT
                    ? t("createAi.refreshLimitReached")
                    : t("createAi.refreshesLeft", {
                        count: MAX_REGENERATIONS_PER_DRAFT - regenerationsUsed,
                      })}
                </Text>
              </>
            ) : null}
            {generating ? (
              <View style={{ marginTop: 4, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <ActivityIndicator />
                  <Text style={{ opacity: 0.75, flex: 1 }}>{t("createAi.generatingHint")}</Text>
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
            <View style={{ marginTop: 20, gap: 12 }}>
              <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("createAi.pickAdTitle")}</Text>
              <Text style={{ opacity: 0.7, marginBottom: 4 }}>{t("createAi.pickAdHelp")}</Text>
              {generatedAds.map((ad, index) => {
                const selected = selectedAdIndex === index;
                const laneKey = (ad.creative_lane ?? CREATIVE_LANE_ORDER[index]) as CreativeLane;
                const laneTitle = laneUiTitle(laneKey);
                return (
                  <View
                    key={`${ad.creative_lane ?? index}-${index}`}
                    style={{
                      borderRadius: 16,
                      padding: 14,
                      backgroundColor: "#fff",
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? "#111" : "#e5e5e5",
                      boxShadow: "0px 2px 8px rgba(0,0,0,0.06)",
                      elevation: 2,
                    }}
                  >
                    {photoUri || posterUrl ? (
                      <Image
                        source={{ uri: photoUri ?? posterUrl ?? "" }}
                        style={{ height: 128, width: "100%", borderRadius: 12, marginBottom: 10 }}
                        contentFit="cover"
                      />
                    ) : null}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                      <Text
                        style={{
                          alignSelf: "flex-start",
                          fontSize: 11,
                          fontWeight: "800",
                          color: "#fff",
                          backgroundColor: "#111",
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 999,
                          overflow: "hidden",
                        }}
                      >
                        {laneTitle}
                      </Text>
                      <Text
                        style={{
                          alignSelf: "flex-start",
                          fontSize: 12,
                          fontWeight: "700",
                          color: "#444",
                          backgroundColor: "#f0f0f0",
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 999,
                        }}
                      >
                        {ad.style_label}
                      </Text>
                    </View>
                    {manualValidationTag.trim() ? (
                      <Text
                        style={{ fontSize: 10, color: "#888", marginBottom: 6 }}
                        accessibilityLabel={`Creative lane ${ad.creative_lane}`}
                      >
                        {t("createAi.qaMetadata", { lane: ad.creative_lane })}
                      </Text>
                    ) : null}
                    <Text style={{ fontSize: 17, fontWeight: "800" }}>{ad.headline}</Text>
                    <Text style={{ marginTop: 6, opacity: 0.85 }}>{ad.subheadline}</Text>
                    <Text style={{ marginTop: 8, fontWeight: "700" }}>{ad.cta}</Text>
                    <Text style={{ marginTop: 10, fontSize: 13, opacity: 0.65, fontStyle: "italic" }}>
                      {ad.rationale}
                    </Text>
                    {ad.visual_direction?.trim() ? (
                      <Text style={{ marginTop: 6, fontSize: 12, opacity: 0.55 }}>
                        {t("createAi.visualNote", { note: ad.visual_direction })}
                      </Text>
                    ) : null}
                    <View style={{ marginTop: 12 }}>
                      <SecondaryButton
                        title={selected ? t("createAi.selectedEditBelow") : t("createAi.useThisAd")}
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
                      />
                    </View>
                  </View>
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
                {photoUri || posterUrl ? (
                  <Image
                    source={{ uri: photoUri ?? posterUrl ?? "" }}
                    style={{ height: 200, width: "100%" }}
                    contentFit="cover"
                  />
                ) : (
                  <View style={{ height: 200, backgroundColor: "#eee" }} />
                )}
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
                  title={publishing ? t("createAi.publishing") : t("createAi.publishDeal")}
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
  );
}
