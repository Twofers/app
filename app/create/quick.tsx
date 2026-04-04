import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { Image } from "expo-image";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { assessDealQuality } from "../../lib/deal-quality";
import { useBusiness } from "../../hooks/use-business";
import { useBusinessLocations } from "../../hooks/use-business-locations";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { DealPreviewModal } from "../../components/deal-preview-modal";
import { aiGenerateDealCopy, notifyDealPublished } from "../../lib/functions";
import { Colors, Radii } from "../../constants/theme";
import {
  resolveDealFlowLanguage,
  translateDealQualityBlock,
} from "../../lib/translate-deal-quality";
import { formatAppDateTime } from "../../lib/i18n/format-datetime";
import { validateStrongDealOnly } from "../../lib/strong-deal-guard";
import { buildPublicDealPhotoUrl } from "../../lib/deal-poster-url";
import { getScheduleSuggestion } from "../../lib/schedule-suggestions";

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

function parseOptionalPrice(rawPrice: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = rawPrice.trim();
  if (!trimmed) return { ok: true, value: null };
  const n = Number(trimmed);
  if (Number.isNaN(n)) return { ok: false };
  return { ok: true, value: n };
}

export default function QuickDealScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const prefill = useLocalSearchParams<{
    prefillTitle?: string;
    prefillHint?: string;
    prefillPrice?: string;
    prefillPosterPath?: string;
    prefillLocationId?: string;
    fromAiCompose?: string;
    fromReuse?: string;
    fromMenuOffer?: string;
    fromCreateHub?: string;
  }>();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { t, i18n } = useTranslation();
  const {
    isLoggedIn,
    businessId,
    userId,
    loading,
    businessPreferredLocale,
    businessName,
    subscriptionTier,
    businessProfile,
  } = useBusiness();
  const { visibleLocations, loading: locLoading } = useBusinessLocations(businessId, subscriptionTier);
  const dealLang = resolveDealFlowLanguage(businessPreferredLocale, i18n.language);
  const [title, setTitle] = useState("");
  const [offerHint, setOfferHint] = useState("");
  const [suggestingAi, setSuggestingAi] = useState(false);
  const [price, setPrice] = useState("");
  const [startTime, setStartTime] = useState(new Date());
  const [endTime, setEndTime] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [maxClaims, setMaxClaims] = useState("50");
  const [cutoffMins, setCutoffMins] = useState("15");
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  /** Android needs two-step datetime: date picker first, then time picker. */
  const [androidStartPickerMode, setAndroidStartPickerMode] = useState<"date" | "time">("date");
  const androidStartDateRef = useRef<Date | null>(null);
  const [androidEndPickerMode, setAndroidEndPickerMode] = useState<"date" | "time">("date");
  const androidEndDateRef = useRef<Date | null>(null);
  // Recurring scheduling
  const [isRecurring, setIsRecurring] = useState(false);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [windowStart, setWindowStart] = useState(new Date());
  const [windowEnd, setWindowEnd] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [showWindowStartPicker, setShowWindowStartPicker] = useState(false);
  const [showWindowEndPicker, setShowWindowEndPicker] = useState(false);
  const [timezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
  );
  const [scheduleSuggestionDismissed, setScheduleSuggestionDismissed] = useState(false);
  const scheduleSuggestion = useMemo(
    () => businessProfile ? getScheduleSuggestion(businessProfile.category) : null,
    [businessProfile],
  );
  const [showPreview, setShowPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [banner, setBanner] = useState<{
    message: string;
    tone: "error" | "success" | "warning";
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);
  const [prefillPosterStoragePath, setPrefillPosterStoragePath] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  useEffect(() => {
    if (visibleLocations.length > 0 && !selectedLocationId) {
      setSelectedLocationId(visibleLocations[0].id);
    }
  }, [visibleLocations, selectedLocationId]);

  const canPublish = useMemo(() => title.trim().length > 0, [title]);
  const showLoginPrompt = !isLoggedIn;
  const showLoadingPrompt = isLoggedIn && (loading || locLoading);
  const showCreateBusinessPrompt = isLoggedIn && !loading && !locLoading && !businessId;
  const showForm = isLoggedIn && !loading && !locLoading && !!businessId;
  const heroPosterUri = prefillPosterStoragePath ? (buildPublicDealPhotoUrl(prefillPosterStoragePath) ?? "") : "";

  useEffect(() => {
    const g = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
    const t0 = (g(prefill.prefillTitle) ?? "").trim();
    const h0 = (g(prefill.prefillHint) ?? "").trim();
    const p0 = (g(prefill.prefillPrice) ?? "").trim();
    const posterPath = (g(prefill.prefillPosterPath) ?? "").trim();
    const locationId = (g(prefill.prefillLocationId) ?? "").trim();
    const fromAi = g(prefill.fromAiCompose);
    const fromReuse = g(prefill.fromReuse);
    const fromMenu = g(prefill.fromMenuOffer);
    const fromHub = g(prefill.fromCreateHub);
    if (t0) setTitle((prev) => prev || t0);
    if (h0) setOfferHint((prev) => prev || h0);
    if (p0) setPrice((prev) => prev || p0);
    if (posterPath) setPrefillPosterStoragePath(posterPath);
    if (locationId) setSelectedLocationId(locationId);
    if (t0 || h0 || p0 || posterPath) setDirty(true);
    if (fromHub === "1" && (t0 || h0)) {
      setBanner({ message: t("createQuick.prefillFromCreateHub"), tone: "success" });
    } else if (fromAi === "1" && (t0 || h0)) {
      setBanner({ message: t("createQuick.prefillFromAiCompose"), tone: "success" });
    } else if (fromReuse === "1" && (t0 || h0)) {
      setBanner({ message: t("createQuick.prefillFromReuse"), tone: "success" });
    } else if (fromMenu === "1" && (t0 || h0)) {
      setBanner({ message: t("createQuick.prefillFromMenuOffer"), tone: "success" });
    }
  }, [
    prefill.prefillTitle,
    prefill.prefillHint,
    prefill.prefillPrice,
    prefill.prefillPosterPath,
    prefill.prefillLocationId,
    prefill.fromAiCompose,
    prefill.fromReuse,
    prefill.fromMenuOffer,
    prefill.fromCreateHub,
    t,
  ]);

  usePreventRemove(
    dirty,
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

  async function suggestTitleFromAi() {
    if (!businessId) {
      setBanner({ message: t("createQuick.errCreateBusiness"), tone: "error" });
      return;
    }
    const hint = offerHint.trim();
    if (!hint) {
      setBanner({ message: t("createQuick.errHintForAi"), tone: "error" });
      return;
    }
    setSuggestingAi(true);
    setBanner(null);
    try {
      const parsedPrice = parseOptionalPrice(price);
      if (!parsedPrice.ok) {
        setBanner({ message: t("createQuick.errPriceNumber"), tone: "error" });
        return;
      }
      const result = await aiGenerateDealCopy({
        hint_text: hint,
        price: parsedPrice.value,
        business_name: businessName ?? null,
        business_id: businessId ?? null,
      });
      const proposed = result.title.trim();
      /** Match publish-time checks: Quick deals store offer text in `description` on save (see publishDeal). */
      const hintTrim = hint.trim();
      const quality = assessDealQuality({
        title: proposed,
        description: hintTrim.length > 0 ? hintTrim : null,
        price: parsedPrice.value,
      });
      if (quality.blocked) {
        setBanner({ message: translateDealQualityBlock(quality, dealLang), tone: "error" });
        return;
      }
      const strongGuard = validateStrongDealOnly({
        title: proposed,
        description: hintTrim.length > 0 ? hintTrim : null,
      });
      if (!strongGuard.ok) {
        // FIX: Use translated message instead of hardcoded English
        setBanner({ message: t("dealQuality.strongDealMessage"), tone: "warning" });
        return;
      }
      setTitle(proposed);
      setBanner({ message: t("createQuick.successAiTitle"), tone: "success" });
    } catch (err: unknown) {
      if (__DEV__) console.warn("[quick] AI suggest error:", err);
      setBanner({ message: t("createQuick.errAiSuggestFailed"), tone: "error" });
    } finally {
      setSuggestingAi(false);
    }
  }

  async function publishDeal() {
    if (!userId || !businessId) {
      setBanner({ message: t("createQuick.errCreateBusiness"), tone: "error" });
      return;
    }
    if (!canPublish) {
      setBanner({ message: t("createQuick.errTitleRequired"), tone: "error" });
      return;
    }

    const maxClaimsNum = Number(maxClaims);
    const cutoffNum = Number(cutoffMins);

    if (Number.isNaN(maxClaimsNum) || maxClaimsNum <= 0) {
      setBanner({ message: t("createQuick.errMaxClaims"), tone: "error" });
      return;
    }
    if (Number.isNaN(cutoffNum) || cutoffNum < 0) {
      setBanner({ message: t("createQuick.errCutoff"), tone: "error" });
      return;
    }
    if (!isRecurring) {
      if (startTime >= endTime) {
        setBanner({ message: t("createQuick.errEndFuture"), tone: "error" });
        return;
      }
      const durationMinutes = Math.floor((endTime.getTime() - startTime.getTime()) / 60000);
      if (cutoffNum >= durationMinutes) {
        setBanner({ message: t("createQuick.errCutoffDuration"), tone: "error" });
        return;
      }
    } else {
      if (daysOfWeek.length === 0) {
        setBanner({ message: t("createQuick.errNoDays"), tone: "error" });
        return;
      }
    }

    setPublishing(true);
    setBanner(null);
    try {
      const parsedPrice = parseOptionalPrice(price);
      if (!parsedPrice.ok) {
        setBanner({ message: t("createQuick.errPriceNumber"), tone: "error" });
        return;
      }

      const offerBody = offerHint.trim();
      const quality = assessDealQuality({
        title: title.trim(),
        description: offerBody.length > 0 ? offerBody : null,
        price: parsedPrice.value,
      });
      if (quality.blocked) {
        setBanner({ message: translateDealQualityBlock(quality, dealLang), tone: "error" });
        return;
      }

      const strongGuard = validateStrongDealOnly({
        title: title.trim(),
        description: offerBody.length > 0 ? offerBody : null,
      });
      if (!strongGuard.ok) {
        const key = `dealQuality.strongGuard.${strongGuard.reason}`;
        setBanner({ message: t(key, { defaultValue: t("dealQuality.strongDealMessage") }), tone: "warning" });
        return;
      }

      const posterPath = prefillPosterStoragePath?.trim() || null;
      const posterPublic = posterPath ? buildPublicDealPhotoUrl(posterPath) : null;

      const { data: deal, error } = await supabase.from("deals").insert({
        business_id: businessId,
        title: title.trim(),
        description: offerBody.length > 0 ? offerBody : null,
        price: parsedPrice.value,
        start_time: isRecurring ? new Date().toISOString() : startTime.toISOString(),
        end_time: isRecurring ? null : endTime.toISOString(),
        claim_cutoff_buffer_minutes: cutoffNum,
        max_claims: maxClaimsNum,
        is_active: true,
        poster_url: posterPublic,
        poster_storage_path: posterPath,
        quality_tier: quality.tier,
        location_id: selectedLocationId,
        is_recurring: isRecurring,
        days_of_week: isRecurring ? [...daysOfWeek].sort((a, b) => a - b) : null,
        window_start_minutes: isRecurring ? minutesFromDate(windowStart) : null,
        window_end_minutes: isRecurring ? minutesFromDate(windowEnd) : null,
        timezone: isRecurring ? timezone : null,
      }).select("id").single();

      if (error) throw error;
      if (deal?.id) void notifyDealPublished(deal.id);
      setDirty(false);
      router.replace("/(tabs)/dashboard");
    } catch (err: unknown) {
      if (__DEV__) console.warn("[quick] Publish error:", err);
      setBanner({ message: t("createQuick.errPublishFailed"), tone: "error" });
    } finally {
      setPublishing(false);
    }
  }

  function confirmAndPublish() {
    const dealTitle = title.trim() || t("createQuick.placeholderTitle");
    Alert.alert(
      t("createQuick.confirmPublishTitle"),
      t("createQuick.confirmPublishBody", { title: dealTitle }),
      [
        { text: t("createQuick.confirmPublishNo"), style: "cancel" },
        { text: t("createQuick.confirmPublishYes"), onPress: () => void publishDeal() },
      ],
    );
  }

  return (
    <KeyboardScreen>
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: Colors.light.background }}>
      <ScreenHeader title={t("createQuick.title")} subtitle={t("createQuick.subtitle")} />
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {showLoginPrompt ? <Text style={{ marginTop: Spacing.lg, opacity: 0.7 }}>{t("createQuick.loginPrompt")}</Text> : null}
      {showLoadingPrompt ? <Text style={{ marginTop: Spacing.lg, opacity: 0.7 }}>{t("createQuick.loading")}</Text> : null}
      {showCreateBusinessPrompt ? (
        <Text style={{ marginTop: Spacing.lg, opacity: 0.7 }}>{t("createQuick.createBusinessFirst")}</Text>
      ) : null}
      {showForm ? (
        <ScrollView
          style={{ flex: 1, marginTop: Spacing.lg }}
          contentContainerStyle={{ gap: Spacing.lg, paddingBottom: scrollBottom }}
          {...FORM_SCROLL_KEYBOARD_PROPS}
          showsVerticalScrollIndicator={false}
        >
          <Text style={{ fontWeight: "800", fontSize: 15, color: Colors.light.text, letterSpacing: -0.2 }}>
            {t("createQuick.sectionBasics")}
          </Text>
          {prefillPosterStoragePath ? (
            <View style={{ marginBottom: Spacing.sm }}>
              <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C", marginBottom: 6 }}>
                {t("createQuick.aiPosterAttached")}
              </Text>
              <Image
                source={{ uri: heroPosterUri }}
                style={{
                  width: "100%",
                  aspectRatio: 1,
                  borderRadius: Radii.lg,
                  backgroundColor: Colors.light.border,
                }}
                contentFit="cover"
              />
            </View>
          ) : null}

          {visibleLocations.length > 0 ? (
            <View style={{ marginBottom: Spacing.sm }}>
              <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C", marginBottom: 6 }}>
                {t("menuOffer.stepLocation")}
              </Text>
              {visibleLocations.map((loc) => (
                <Pressable
                  key={loc.id}
                  onPress={() => {
                    markDirty();
                    setSelectedLocationId(loc.id);
                  }}
                  style={{
                    padding: Spacing.md,
                    borderRadius: Radii.lg,
                    borderWidth: selectedLocationId === loc.id ? 2 : 1,
                    borderColor: selectedLocationId === loc.id ? Colors.light.primary : Colors.light.border,
                    marginBottom: Spacing.sm,
                    backgroundColor: Colors.light.surface,
                  }}
                >
                  <Text style={{ fontWeight: "700" }}>{loc.name}</Text>
                  <Text style={{ opacity: 0.65, marginTop: 4 }}>{loc.address}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.fieldOfferHint")}</Text>
            <TextInput
              value={offerHint}
              onChangeText={(v) => {
                markDirty();
                setOfferHint(v);
              }}
              placeholder={t("createQuick.placeholderOfferHint")}
              multiline
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.lg,
                padding: Spacing.md,
                marginTop: 6,
                minHeight: 72,
                textAlignVertical: "top",
                fontSize: 16,
                backgroundColor: Colors.light.surface,
              }}
            />
            <View style={{ marginTop: Spacing.sm }}>
              <SecondaryButton
                title={suggestingAi ? t("createQuick.suggestingAi") : t("createQuick.suggestTitleAi")}
                onPress={() => void suggestTitleFromAi()}
                disabled={suggestingAi}
              />
            </View>
            <Text style={{ marginTop: 6, fontSize: 12, opacity: 0.55, lineHeight: 17 }}>
              {t("createQuick.aiNeedsOpenAiSecret")}
            </Text>
          </View>

          <View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.fieldTitle")}</Text>
            <TextInput
              value={title}
              onChangeText={(v) => {
                markDirty();
                setTitle(v);
              }}
              placeholder={t("createQuick.placeholderTitle")}
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.lg,
                padding: Spacing.md,
                marginTop: 6,
                fontSize: 16,
                backgroundColor: Colors.light.surface,
              }}
            />
          </View>

          <View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.fieldPrice")}</Text>
            <TextInput
              value={price}
              onChangeText={(v) => {
                markDirty();
                setPrice(v);
              }}
              keyboardType="decimal-pad"
              placeholder={t("createQuick.placeholderPrice")}
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.lg,
                padding: Spacing.md,
                marginTop: 6,
                fontSize: 16,
                backgroundColor: Colors.light.surface,
              }}
            />
          </View>

          {/* ── Schedule ─────────────────────────────────── */}
          <Text
            style={{
              marginTop: Spacing.sm,
              fontWeight: "800",
              fontSize: 15,
              color: Colors.light.text,
              letterSpacing: -0.2,
            }}
          >
            {t("createQuick.sectionSchedule")}
          </Text>

          {/* ── AI schedule suggestion ──────────────────── */}
          {scheduleSuggestion && !scheduleSuggestionDismissed && !prefill.fromReuse ? (
            <View
              style={{
                borderRadius: Radii.lg,
                padding: Spacing.md,
                backgroundColor: "#FFF7ED",
                borderWidth: 1,
                borderColor: Colors.light.primary,
              }}
            >
              <Text style={{ fontWeight: "700", fontSize: 14, color: "#111", marginBottom: 4 }}>
                {scheduleSuggestion.rationale}
              </Text>
              <View style={{ flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.sm }}>
                <Pressable
                  onPress={() => {
                    markDirty();
                    setIsRecurring(true);
                    setDaysOfWeek([...scheduleSuggestion.daysOfWeek]);
                    const wsDate = new Date();
                    wsDate.setHours(Math.floor(scheduleSuggestion.windowStartMinutes / 60), scheduleSuggestion.windowStartMinutes % 60, 0, 0);
                    setWindowStart(wsDate);
                    const weDate = new Date();
                    weDate.setHours(Math.floor(scheduleSuggestion.windowEndMinutes / 60), scheduleSuggestion.windowEndMinutes % 60, 0, 0);
                    setWindowEnd(weDate);
                    setScheduleSuggestionDismissed(true);
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: Spacing.sm,
                    borderRadius: Radii.md,
                    backgroundColor: Colors.light.primary,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>
                    {t("createQuick.scheduleSuggestionUse")}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setScheduleSuggestionDismissed(true)}
                  style={{
                    flex: 1,
                    paddingVertical: Spacing.sm,
                    borderRadius: Radii.md,
                    backgroundColor: Colors.light.surface,
                    borderWidth: 1,
                    borderColor: Colors.light.border,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontWeight: "700", fontSize: 14, color: "#111" }}>
                    {t("createQuick.scheduleSuggestionCustomize")}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {!isRecurring ? (
            <>
              {/* Start time */}
              <View>
                <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.fieldStartTime")}</Text>
                <Pressable
                  onPress={() => { markDirty(); setShowStartPicker(true); }}
                  style={{
                    borderWidth: 1,
                    borderColor: Colors.light.border,
                    borderRadius: Radii.lg,
                    padding: Spacing.md,
                    marginTop: 6,
                    backgroundColor: Colors.light.surface,
                  }}
                >
                  <Text style={{ fontSize: 16 }}>{formatAppDateTime(startTime, i18n.language)}</Text>
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
                          markDirty();
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
                        if (date) { markDirty(); setStartTime(date); }
                      }}
                    />
                  )
                ) : null}
              </View>

              {/* End time */}
              <View>
                <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.fieldEndTime")}</Text>
                <Pressable
                  onPress={() => { markDirty(); setShowEndPicker(true); }}
                  style={{
                    borderWidth: 1,
                    borderColor: Colors.light.border,
                    borderRadius: Radii.lg,
                    padding: Spacing.md,
                    marginTop: 6,
                    backgroundColor: Colors.light.surface,
                  }}
                >
                  <Text style={{ fontSize: 16 }}>{formatAppDateTime(endTime, i18n.language)}</Text>
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
                          markDirty();
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
                        if (date) { markDirty(); setEndTime(date); }
                      }}
                    />
                  )
                ) : null}
              </View>
            </>
          ) : (
            <>
              {/* Recurring: day presets + individual toggles */}
              <View style={{ gap: Spacing.sm }}>
                <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                  <Pressable
                    onPress={() => { markDirty(); setDaysOfWeek([1, 2, 3, 4, 5, 6, 7]); }}
                    style={{
                      paddingHorizontal: Spacing.md,
                      paddingVertical: Spacing.xs,
                      borderRadius: Radii.md,
                      borderWidth: daysOfWeek.length === 7 ? 2 : 1,
                      borderColor: daysOfWeek.length === 7 ? Colors.light.primary : Colors.light.border,
                      backgroundColor: Colors.light.surface,
                    }}
                  >
                    <Text style={{ fontWeight: "700" }}>{t("createQuick.presetEveryDay")}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { markDirty(); setDaysOfWeek([1, 2, 3, 4, 5]); }}
                    style={{
                      paddingHorizontal: Spacing.md,
                      paddingVertical: Spacing.xs,
                      borderRadius: Radii.md,
                      borderWidth: daysOfWeek.length === 5 && !daysOfWeek.includes(6) ? 2 : 1,
                      borderColor: daysOfWeek.length === 5 && !daysOfWeek.includes(6) ? Colors.light.primary : Colors.light.border,
                      backgroundColor: Colors.light.surface,
                    }}
                  >
                    <Text style={{ fontWeight: "700" }}>{t("createQuick.presetWeekdays")}</Text>
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {([
                    { label: t("createQuick.dayMon"), value: 1 },
                    { label: t("createQuick.dayTue"), value: 2 },
                    { label: t("createQuick.dayWed"), value: 3 },
                    { label: t("createQuick.dayThu"), value: 4 },
                    { label: t("createQuick.dayFri"), value: 5 },
                    { label: t("createQuick.daySat"), value: 6 },
                    { label: t("createQuick.daySun"), value: 7 },
                  ] as const).map((day) => {
                    const on = daysOfWeek.includes(day.value);
                    return (
                      <Pressable
                        key={day.value}
                        onPress={() => {
                          markDirty();
                          setDaysOfWeek((prev) =>
                            on ? prev.filter((d) => d !== day.value) : [...prev, day.value],
                          );
                        }}
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: on ? Colors.light.primary : Colors.light.surface,
                          borderWidth: on ? 0 : 1,
                          borderColor: Colors.light.border,
                        }}
                      >
                        <Text style={{ fontWeight: "800", fontSize: 13, color: on ? "#fff" : Colors.light.text }}>
                          {day.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Recurring: daily time window */}
              <View>
                <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.windowStart")}</Text>
                <Pressable
                  onPress={() => { markDirty(); setShowWindowStartPicker(true); }}
                  style={{
                    borderWidth: 1,
                    borderColor: Colors.light.border,
                    borderRadius: Radii.lg,
                    padding: Spacing.md,
                    marginTop: 6,
                    backgroundColor: Colors.light.surface,
                  }}
                >
                  <Text style={{ fontSize: 16 }}>{formatMinutes(minutesFromDate(windowStart))}</Text>
                </Pressable>
                {showWindowStartPicker ? (
                  <DateTimePicker
                    value={windowStart}
                    mode="time"
                    onChange={(_event, date) => {
                      setShowWindowStartPicker(false);
                      if (date) { markDirty(); setWindowStart(date); }
                    }}
                  />
                ) : null}
              </View>
              <View>
                <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.windowEnd")}</Text>
                <Pressable
                  onPress={() => { markDirty(); setShowWindowEndPicker(true); }}
                  style={{
                    borderWidth: 1,
                    borderColor: Colors.light.border,
                    borderRadius: Radii.lg,
                    padding: Spacing.md,
                    marginTop: 6,
                    backgroundColor: Colors.light.surface,
                  }}
                >
                  <Text style={{ fontSize: 16 }}>{formatMinutes(minutesFromDate(windowEnd))}</Text>
                </Pressable>
                {showWindowEndPicker ? (
                  <DateTimePicker
                    value={windowEnd}
                    mode="time"
                    onChange={(_event, date) => {
                      setShowWindowEndPicker(false);
                      if (date) { markDirty(); setWindowEnd(date); }
                    }}
                  />
                ) : null}
              </View>
            </>
          )}

          {/* Recurring toggle */}
          <Pressable
            onPress={() => { markDirty(); setIsRecurring((v) => !v); }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: Spacing.sm,
              paddingVertical: Spacing.sm,
            }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                borderWidth: 2,
                borderColor: isRecurring ? Colors.light.primary : Colors.light.border,
                backgroundColor: isRecurring ? Colors.light.primary : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {isRecurring ? <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>✓</Text> : null}
            </View>
            <Text style={{ fontWeight: "700", fontSize: 15, color: Colors.light.text }}>
              {t("createQuick.recurringToggle")}
            </Text>
          </Pressable>

          {/* ── Limits ───────────────────────────────────── */}
          <Text
            style={{
              marginTop: Spacing.sm,
              fontWeight: "800",
              fontSize: 15,
              color: Colors.light.text,
              letterSpacing: -0.2,
            }}
          >
            {t("createQuick.sectionLimits")}
          </Text>

          <View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.fieldMaxClaims")}</Text>
            <View style={{ flexDirection: "row", gap: Spacing.sm, marginTop: 6, marginBottom: 6 }}>
              {[25, 50, 100].map((count) => (
                <Pressable
                  key={count}
                  onPress={() => { markDirty(); setMaxClaims(String(count)); }}
                  style={{
                    paddingHorizontal: Spacing.md,
                    paddingVertical: Spacing.xs,
                    borderRadius: Radii.md,
                    borderWidth: maxClaims === String(count) ? 2 : 1,
                    borderColor: maxClaims === String(count) ? Colors.light.primary : Colors.light.border,
                    backgroundColor: Colors.light.surface,
                  }}
                >
                  <Text style={{ fontWeight: "700" }}>{count}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={maxClaims}
              onChangeText={(v) => { markDirty(); setMaxClaims(v); }}
              keyboardType="number-pad"
              placeholder={t("createQuick.placeholderMaxClaims")}
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.lg,
                padding: Spacing.md,
                fontSize: 16,
                backgroundColor: Colors.light.surface,
              }}
            />
          </View>

          <View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.fieldCutoff")}</Text>
            <View style={{ flexDirection: "row", gap: Spacing.sm, marginTop: 6, marginBottom: 6 }}>
              {[10, 15, 30].map((mins) => (
                <Pressable
                  key={mins}
                  onPress={() => { markDirty(); setCutoffMins(String(mins)); }}
                  style={{
                    paddingHorizontal: Spacing.md,
                    paddingVertical: Spacing.xs,
                    borderRadius: Radii.md,
                    borderWidth: cutoffMins === String(mins) ? 2 : 1,
                    borderColor: cutoffMins === String(mins) ? Colors.light.primary : Colors.light.border,
                    backgroundColor: Colors.light.surface,
                  }}
                >
                  <Text style={{ fontWeight: "700" }}>{mins}m</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={cutoffMins}
              onChangeText={(v) => { markDirty(); setCutoffMins(v); }}
              keyboardType="number-pad"
              placeholder={t("createQuick.placeholderCutoff")}
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.lg,
                padding: Spacing.md,
                fontSize: 16,
                backgroundColor: Colors.light.surface,
              }}
            />
          </View>

          <PrimaryButton
            title={publishing ? t("createQuick.publishing") : t("createQuick.previewAsCustomer")}
            onPress={() => setShowPreview(true)}
            disabled={publishing || !canPublish}
            style={{ height: 66, borderRadius: 20, marginTop: 4 }}
          />
        </ScrollView>
      ) : null}

      <DealPreviewModal
        visible={showPreview}
        onDismiss={() => setShowPreview(false)}
        onPublish={() => {
          setShowPreview(false);
          confirmAndPublish();
        }}
        publishing={publishing}
        title={title}
        description={offerHint}
        businessName={businessName ?? null}
        posterUrl={heroPosterUri || null}
        price={(() => { const p = parseOptionalPrice(price); return p.ok ? p.value : null; })()}
        endTime={isRecurring ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : endTime.toISOString()}
        remainingClaims={Number(maxClaims) || null}
      />
    </View>
    </KeyboardScreen>
  );
}
