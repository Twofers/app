import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useBusiness } from "../../hooks/use-business";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { parseFunctionError } from "../../lib/functions";
import {
  adToDealDraft,
  composeListingDescription,
  CREATIVE_LANE_LABEL,
  CREATIVE_LANE_ORDER,
  type CreativeLane,
  type GeneratedAd,
} from "../../lib/ad-variants";
import { AiAdsEvents, trackEvent } from "../../lib/analytics";
import { assessDealQuality } from "../../lib/deal-quality";

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

const dayOptions = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 7 },
];

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
  const dayLabels = dayOptions
    .filter((d) => daysOfWeek.includes(d.value))
    .map((d) => d.label)
    .join(", ");
  return `Recurring: ${dayLabels} · ${formatMinutes(minutesFromDate(windowStart))}–${formatMinutes(
    minutesFromDate(windowEnd),
  )} (${timezone})`;
}

const MAX_REGENERATIONS_PER_DRAFT = 2;

/** Manual QA tags for validation runs — see docs/ai-ad-validation/ */
const QA_CASE_IDS = Array.from({ length: 12 }, (_, i) => `TC${String(i + 1).padStart(2, "0")}`);

const FALLBACK_INTRO =
  "We couldn’t generate ads right now. You can still finish this offer manually.";

export default function AiDealScreen() {
  const router = useRouter();
  const { templateId } = useLocalSearchParams<{ templateId?: string }>();
  const { isLoggedIn, businessId, businessContextForAi } = useBusiness();
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
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago"
  );
  const [banner, setBanner] = useState<{ message: string; tone?: "error" | "success" | "info" } | null>(null);
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
        const t = data as TemplateRow;
        setTitle(t.title ?? "");
        setDescription(t.description ?? "");
        setPromoLine("");
        setCtaText("");
        setPrice(t.price != null ? String(t.price) : "");
        setPosterUrl(t.poster_url ?? null);
        setMaxClaims(String(t.max_claims ?? 50));
        setCutoffMins(String(t.claim_cutoff_buffer_minutes ?? 15));
        setValidityMode(t.is_recurring ? "recurring" : "one-time");
        setDaysOfWeek(t.days_of_week ?? [1, 2, 3, 4, 5]);
        if (t.window_start_minutes != null) {
          const d = new Date();
          d.setHours(Math.floor(t.window_start_minutes / 60), t.window_start_minutes % 60, 0, 0);
          setWindowStart(d);
        }
        if (t.window_end_minutes != null) {
          const d = new Date();
          d.setHours(Math.floor(t.window_end_minutes / 60), t.window_end_minutes % 60, 0, 0);
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
      setBanner({ message: "Please allow photo access.", tone: "error" });
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
      setBanner({ message: "Camera permission is required.", tone: "error" });
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
      setBanner({ message: "Max claims must be greater than 0.", tone: "error" });
      return false;
    }
    if (Number.isNaN(cutoffNum) || cutoffNum < 0) {
      setBanner({ message: "Cutoff buffer must be 0 or more.", tone: "error" });
      return false;
    }
    if (validityMode === "one-time") {
      if (endTime <= startTime) {
        setBanner({ message: "End time must be after start time.", tone: "error" });
        return false;
      }
    } else {
      if (daysOfWeek.length === 0) {
        setBanner({ message: "Select at least one day for recurring deals.", tone: "error" });
        return false;
      }
      if (minutesFromDate(windowStart) >= minutesFromDate(windowEnd)) {
        setBanner({ message: "Recurring window start must be before end.", tone: "error" });
        return false;
      }
    }
    if (forGenerate) {
      if (!photoUri && !posterUrl) {
        setBanner({ message: "Please add a photo.", tone: "error" });
        return false;
      }
      if (!hintText.trim()) {
        setBanner({ message: "Please add a few words about the deal.", tone: "error" });
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
    const t = raw.toLowerCase();
    if (t.includes("openai_api_key") || t.includes("not set")) {
      return "AI isn’t configured on the server yet. You can still write your deal below.";
    }
    if (t.includes("unauthorized") || t.includes("log in")) {
      return "Session expired. Log in again, then try generating.";
    }
    if (t.includes("photo") || t.includes("access the photo")) {
      return "We couldn’t use that photo. Try taking or picking a new one.";
    }
    if (t.includes("regeneration limit")) {
      return "You’ve used the free refreshes for this draft. Tap Generate 3 ad ideas for a new batch, or edit below.";
    }
    if (t.includes("rate limit") || t.includes("429")) {
      return `${FALLBACK_INTRO} The service may be busy — try again shortly or fill in the fields below.`;
    }
    if (raw.length > 120) {
      return `${FALLBACK_INTRO} Try again in a moment, or fill in the fields below.`;
    }
    return FALLBACK_INTRO;
  }

  async function generateAdVariants(mode: "initial" | "regenerate") {
    if (!validateInputs(true)) return;
    if (!businessId) {
      setBanner({ message: "Create a business first.", tone: "error" });
      return;
    }

    if (mode === "regenerate" && regenerationsUsed >= MAX_REGENERATIONS_PER_DRAFT) {
      const limTag = manualValidationTag.trim().slice(0, 80);
      trackEvent(AiAdsEvents.REGENERATE_LIMIT_HIT, {
        screen: "create_ai",
        ...(limTag ? { manual_validation_tag: limTag } : {}),
      });
      setBanner({
        message:
          "You’ve used both free refreshes for this draft. Tap “Generate 3 ad ideas” for a new batch, or edit the text below.",
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
        throw new Error("Upload the photo before generating.");
      }
      await ensurePosterUrl(path);
      const priceNum = price.trim() ? Number(price) : null;
      if (price.trim() && (priceNum === null || Number.isNaN(priceNum))) {
        setBanner({ message: "Price must be a number.", tone: "error" });
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
          ...(tagForLog ? { manual_validation_tag: tagForLog } : {}),
        },
      });
      if (error) {
        throw new Error(parseFunctionError(error));
      }
      if (data && typeof data === "object" && "error" in data) {
        throw new Error(String((data as { error?: string }).error ?? "Generation failed"));
      }
      const ads = (data as { ads?: GeneratedAd[] })?.ads;
      if (!Array.isArray(ads) || ads.length !== 3) {
        throw new Error("Unexpected response from AI. Try again.");
      }
      setGeneratedAds(ads);
      setLastSuccessfulGenAttempt(attemptForApi);
      if (mode === "regenerate") {
        setRegenerationsUsed((u) => u + 1);
      }
      setLastGenerationError(null);
      setBanner({
        message:
          attemptForApi > 0
            ? "New batch ready — value, neighborhood, and quality angles. Pick one to load into your draft."
            : "Three angles: value, neighborhood, and premium. Pick one—you can edit before publishing.",
        tone: "success",
      });
      trackEvent(AiAdsEvents.GENERATION_SUCCEEDED, {
        screen: "create_ai",
        regeneration_attempt: attemptForApi,
        ...(tagForLog ? { manual_validation_tag: tagForLog } : {}),
      });
    } catch (err: any) {
      const raw = err?.message ?? "AI generation failed.";
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

  async function publishDeal() {
    if (!validateInputs(false)) return;
    if (!businessId) {
      setBanner({ message: "Create a business first.", tone: "error" });
      return;
    }
    if (!canPublish) {
      setBanner({ message: "Please generate or enter title and description.", tone: "error" });
      return;
    }
    setPublishing(true);
    setBanner(null);
    try {
      const path = await ensureUploadedPhoto();
      const signedPoster = await ensurePosterUrl(path);
      const priceNum = price.trim() ? Number(price) : null;
      if (price.trim() && Number.isNaN(priceNum)) {
        setBanner({ message: "Price must be a number.", tone: "error" });
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
        setBanner({ message: quality.message, tone: "error" });
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
        poster_url: signedPoster,
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
      setBanner({ message: err?.message ?? "Publish failed.", tone: "error" });
    } finally {
      setPublishing(false);
    }
  }

  async function saveTemplate() {
    if (!businessId) {
      setBanner({ message: "Create a business first.", tone: "error" });
      return;
    }
    if (!canPublish) {
      setBanner({ message: "Please generate or enter title and description first.", tone: "error" });
      return;
    }
    setSavingTemplate(true);
    setBanner(null);
    try {
      const path = await ensureUploadedPhoto();
      const signedPoster = await ensurePosterUrl(path);
      const priceNum = price.trim() ? Number(price) : null;
      if (price.trim() && Number.isNaN(priceNum)) {
        setBanner({ message: "Price must be a number.", tone: "error" });
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
      setBanner({ message: "Template saved.", tone: "success" });
    } catch (err: any) {
      setBanner({ message: err?.message ?? "Saving template failed.", tone: "error" });
    } finally {
      setSavingTemplate(false);
    }
  }

  if (!isLoggedIn) {
    return (
      <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
        <Text style={{ fontSize: 22, fontWeight: "700" }}>AI ads</Text>
        <Text style={{ marginTop: 12, opacity: 0.7 }}>Please log in to create deals.</Text>
      </View>
    );
  }

  if (!businessId) {
    return (
      <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
        <Text style={{ fontSize: 22, fontWeight: "700" }}>AI ads</Text>
        <Text style={{ marginTop: 12, opacity: 0.7 }}>Create a business to use AI ad ideas.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 70, paddingHorizontal: 16, paddingBottom: 40 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>AI ads for your deal</Text>
      <Text style={{ marginTop: 10, opacity: 0.75, lineHeight: 20 }}>
        Upload a photo of the product or menu item, describe the offer in your own words, then get three
        different ad angles. Choose one, tweak the text, and publish when you’re ready.
      </Text>

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
            {qaPanelOpen ? "▼" : "▶"} Manual QA (validation)
          </Text>
        </Pressable>
        {qaPanelOpen ? (
          <View style={{ marginTop: 8, gap: 8 }}>
            <Text style={{ fontSize: 12, opacity: 0.75, lineHeight: 17 }}>
              Tag runs for the 12 test cases (see docs/ai-ad-validation). Appears in Supabase function logs
              and dev analytics. Optional — leave blank for normal use.
            </Text>
            <TextInput
              value={manualValidationTag}
              onChangeText={(t) => setManualValidationTag(t.slice(0, 80))}
              placeholder="e.g. TC01"
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
                Active tag: {manualValidationTag.trim()} — cards will show QA lane_id for screenshots.
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
            <PrimaryButton title="Capture Photo" onPress={capturePhoto} />
            <View style={{ marginTop: 8 }}>
              <SecondaryButton title="Cancel" onPress={() => setShowCamera(false)} />
            </View>
          </View>
        </View>
      ) : (
        <>
          <Text style={{ marginTop: 16, fontWeight: "700" }}>Photo</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <PrimaryButton title="Take Photo" onPress={takePhoto} />
            <SecondaryButton title="Pick Photo" onPress={pickPhotoFromLibrary} />
          </View>

          {photoUri || posterUrl ? (
            <Image
              source={{ uri: photoUri ?? posterUrl ?? "" }}
              style={{ height: 200, width: "100%", borderRadius: 16, marginTop: 12 }}
              contentFit="cover"
            />
          ) : (
            <View style={{ marginTop: 12 }}>
              <View style={{ height: 200, borderRadius: 16, backgroundColor: "#eee" }} />
              <Text style={{ marginTop: 8, opacity: 0.65, fontSize: 13 }}>
                Add a clear photo of the dish, drink, or item—AI uses it to stay accurate.
              </Text>
            </View>
          )}

          <Text style={{ marginTop: 16 }}>A few words</Text>
          <TextInput
            value={hintText}
            onChangeText={setHintText}
            placeholder="2-for-1 latte, today only"
            style={{
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 10,
              padding: 12,
              marginTop: 6,
            }}
          />

          <Text style={{ marginTop: 12 }}>Price (optional)</Text>
          <TextInput
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
            placeholder="5.99"
            style={{
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 10,
              padding: 12,
              marginTop: 6,
            }}
          />

          <Text style={{ marginTop: 12, fontWeight: "700" }}>Validity</Text>
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
                One-time
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
                Recurring
              </Text>
            </Pressable>
          </View>

          {validityMode === "one-time" ? (
            <>
              <Text style={{ marginTop: 12 }}>Start time</Text>
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

              <Text style={{ marginTop: 12 }}>End time</Text>
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
                <Text>{endTime.toLocaleString()}</Text>
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
              <Text style={{ marginTop: 12 }}>Days</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {dayOptions.map((day) => {
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

              <Text style={{ marginTop: 12 }}>Time window</Text>
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
                <Text>Start: {formatMinutes(minutesFromDate(windowStart))}</Text>
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
                <Text>End: {formatMinutes(minutesFromDate(windowEnd))}</Text>
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

          <Text style={{ marginTop: 12 }}>Max claims</Text>
          <TextInput
            value={maxClaims}
            onChangeText={setMaxClaims}
            keyboardType="number-pad"
            placeholder="50"
            style={{
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 10,
              padding: 12,
              marginTop: 6,
            }}
          />

          <Text style={{ marginTop: 12 }}>Claim cutoff buffer (minutes)</Text>
          <TextInput
            value={cutoffMins}
            onChangeText={setCutoffMins}
            keyboardType="number-pad"
            placeholder="15"
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
              title={generating ? "Working on your 3 ads…" : "Generate 3 ad ideas"}
              onPress={() => void generateAdVariants("initial")}
              disabled={generating}
            />
            {generatedAds && generatedAds.length === 3 ? (
              <>
                <SecondaryButton
                  title={generating ? "Regenerating…" : "Regenerate (new wording)"}
                  onPress={() => void generateAdVariants("regenerate")}
                  disabled={generating || regenerationsUsed >= MAX_REGENERATIONS_PER_DRAFT}
                />
                <Text style={{ fontSize: 12, opacity: 0.6 }}>
                  {regenerationsUsed >= MAX_REGENERATIONS_PER_DRAFT
                    ? "Refresh limit reached — tap Generate 3 ad ideas for a new batch."
                    : `Free refreshes left: ${MAX_REGENERATIONS_PER_DRAFT - regenerationsUsed}`}
                </Text>
              </>
            ) : null}
            {generating ? (
              <View style={{ marginTop: 4, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <ActivityIndicator />
                  <Text style={{ opacity: 0.75, flex: 1 }}>
                    Creating three different angles: value, neighborhood, and premium. Usually under half a
                    minute.
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
              <Text style={{ fontWeight: "700" }}>{FALLBACK_INTRO}</Text>
              <Text style={{ opacity: 0.8, lineHeight: 20 }}>
                Your photo and offer note stay put. Open the title, subheadline, CTA, and details below, then
                publish — or adjust the note and tap Generate again.
              </Text>
              <SecondaryButton
                title="Show title & description fields"
                onPress={() => {
                  setManualDraftUnlocked(true);
                  setBanner({
                    message: "Fill in title and description yourself, then publish when ready.",
                    tone: "info",
                  });
                }}
              />
            </View>
          ) : null}

          {generatedAds && generatedAds.length === 3 ? (
            <View style={{ marginTop: 20, gap: 12 }}>
              <Text style={{ fontWeight: "700", fontSize: 16 }}>Pick an ad</Text>
              <Text style={{ opacity: 0.7, marginBottom: 4 }}>
                Value = savings clarity · Neighborhood = local & regulars · Premium = quality & craft. Tap
                &quot;Use this ad&quot; to load one into your draft.
              </Text>
              {generatedAds.map((ad, index) => {
                const selected = selectedAdIndex === index;
                const laneKey = (ad.creative_lane ?? CREATIVE_LANE_ORDER[index]) as CreativeLane;
                const laneTitle = CREATIVE_LANE_LABEL[laneKey] ?? "Option";
                return (
                  <View
                    key={`${ad.creative_lane ?? index}-${index}`}
                    style={{
                      borderRadius: 16,
                      padding: 14,
                      backgroundColor: "#fff",
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? "#111" : "#e5e5e5",
                      shadowColor: "#000",
                      shadowOpacity: 0.06,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: 2,
                    }}
                  >
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
                        QA metadata · lane_id: {ad.creative_lane}
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
                        Visual note: {ad.visual_direction}
                      </Text>
                    ) : null}
                    <View style={{ marginTop: 12 }}>
                      <SecondaryButton
                        title={selected ? "Selected — edit below" : "Use this ad"}
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
              <Text style={{ marginTop: 22, fontWeight: "700" }}>Deal preview</Text>
              <View
                style={{
                  borderRadius: 18,
                  backgroundColor: "#fff",
                  overflow: "hidden",
                  marginTop: 10,
                  shadowColor: "#000",
                  shadowOpacity: 0.08,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 4 },
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
                  <Text style={{ fontSize: 16, fontWeight: "700" }}>{title || "Deal title"}</Text>
                  {promoLine ? (
                    <Text style={{ marginTop: 6, fontWeight: "600" }}>{promoLine}</Text>
                  ) : null}
                  {ctaText ? (
                    <Text style={{ marginTop: 6, fontWeight: "700" }}>{ctaText}</Text>
                  ) : null}
                  <Text style={{ marginTop: 6, opacity: 0.8 }}>{description || "Offer details"}</Text>
                  <Text style={{ marginTop: 8, opacity: 0.7 }}>Schedule: {offerScheduleSummary}</Text>
                  <Text style={{ marginTop: 4, opacity: 0.7 }}>Max claims: {maxClaims}</Text>
                </View>
              </View>

              <Text style={{ marginTop: 16 }}>Edit headline</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Headline"
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              />
              <Text style={{ marginTop: 12 }}>Edit subheadline</Text>
              <TextInput
                value={promoLine}
                onChangeText={setPromoLine}
                placeholder="Supporting line under the headline"
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              />
              <Text style={{ marginTop: 12 }}>Edit CTA</Text>
              <TextInput
                value={ctaText}
                onChangeText={setCtaText}
                placeholder="e.g. Stop in this afternoon"
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              />
              <Text style={{ marginTop: 12 }}>Edit offer details</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What’s included, times, fine print"
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
                <PrimaryButton title={publishing ? "Publishing..." : "Publish Deal"} onPress={publishDeal} disabled={publishing} />
                <SecondaryButton
                  title={savingTemplate ? "Saving..." : "Save as Template"}
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
