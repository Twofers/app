import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { dateFnsLocaleFor } from "../../lib/i18n/date-locale";
import { supabase } from "../../lib/supabase";
import { assessDealQuality } from "../../lib/deal-quality";
import { useBusiness } from "../../hooks/use-business";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { aiGenerateDealCopy } from "../../lib/functions";
import { Colors, Radii } from "../../constants/theme";
import {
  resolveDealFlowLanguage,
  translateDealQualityBlock,
} from "../../lib/translate-deal-quality";
import { formatAppDateTime } from "../../lib/i18n/format-datetime";
import { validateStrongDealOnly } from "../../lib/strong-deal-guard";
import { MenuItemPicker } from "../../components/menu-item-picker";
import type { MenuItem } from "../../lib/menu-items";

function minutesFromDate(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

export default function QuickDealScreen() {
  const router = useRouter();
  const prefill = useLocalSearchParams<{
    prefillTitle?: string;
    prefillHint?: string;
    prefillPrice?: string;
    fromAiCompose?: string;
    fromReuse?: string;
  }>();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { t, i18n } = useTranslation();
  const { isLoggedIn, businessId, userId, loading, businessPreferredLocale, businessName } =
    useBusiness();
  const dealLang = resolveDealFlowLanguage(businessPreferredLocale, i18n.language);
  const [title, setTitle] = useState("");
  const [offerHint, setOfferHint] = useState("");
  const [suggestingAi, setSuggestingAi] = useState(false);
  const [price, setPrice] = useState("");
  const [endTime, setEndTime] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [maxClaims, setMaxClaims] = useState("50");
  const [cutoffMins, setCutoffMins] = useState("15");
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [validityMode, setValidityMode] = useState<"one-time" | "recurring">("one-time");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [windowStart, setWindowStart] = useState(new Date());
  const [windowEnd, setWindowEnd] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [showWindowStartPicker, setShowWindowStartPicker] = useState(false);
  const [showWindowEndPicker, setShowWindowEndPicker] = useState(false);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [showMenuPicker, setShowMenuPicker] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [banner, setBanner] = useState<{
    message: string;
    tone: "error" | "success" | "warning";
  } | null>(null);

  const canPublish = useMemo(() => title.trim().length > 0, [title]);

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

  function formatPickerTime(date: Date) {
    return format(date, "p", { locale: dateFnsLocaleFor(i18n.language) });
  }

  function handleMenuItemsSelected(items: MenuItem[]) {
    if (items.length === 2) {
      const [a, b] = items;
      setTitle(`Buy ${a.name}, get ${b.name} free`);
      if (a.price != null) setPrice(String(a.price));
    } else if (items.length === 1) {
      setTitle(`BOGO ${items[0].name}`);
      if (items[0].price != null) setPrice(String(items[0].price));
    }
    setBanner({ message: t("createQuick.menuItemsSelected"), tone: "success" });
  }

  useEffect(() => {
    const g = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
    const t0 = (g(prefill.prefillTitle) ?? "").trim();
    const h0 = (g(prefill.prefillHint) ?? "").trim();
    const p0 = (g(prefill.prefillPrice) ?? "").trim();
    const fromAi = g(prefill.fromAiCompose);
    const fromReuse = g(prefill.fromReuse);
    if (t0) setTitle((prev) => prev || t0);
    if (h0) setOfferHint((prev) => prev || h0);
    if (p0) setPrice((prev) => prev || p0);
    if (fromAi === "1" && (t0 || h0)) {
      setBanner({ message: t("createQuick.prefillFromAiCompose"), tone: "success" });
    }
    if (fromReuse === "1" && (t0 || h0)) {
      setBanner({ message: t("createQuick.prefillFromReuse"), tone: "success" });
    }
  }, [prefill.prefillTitle, prefill.prefillHint, prefill.prefillPrice, prefill.fromAiCompose, prefill.fromReuse, t]);

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
      const priceNum = price.trim() ? Number(price) : null;
      if (price.trim() && Number.isNaN(priceNum)) {
        setBanner({ message: t("createQuick.errPriceNumber"), tone: "error" });
        return;
      }
      const result = await aiGenerateDealCopy({
        hint_text: hint,
        price: priceNum != null && !Number.isNaN(priceNum) ? priceNum : null,
        business_name: businessName ?? null,
      });
      setTitle(result.title.trim());
      const quality = assessDealQuality({
        title: result.title.trim(),
        description: result.description,
        price: priceNum != null && !Number.isNaN(priceNum) ? priceNum : null,
      });
      if (quality.blocked) {
        setBanner({ message: translateDealQualityBlock(quality, dealLang), tone: "error" });
        return;
      }
      setBanner({ message: t("createQuick.successAiTitle"), tone: "success" });
    } catch (err: any) {
      setBanner({ message: err?.message ?? t("createQuick.errAiSuggestFailed"), tone: "error" });
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

    const now = new Date();
    const isRecurring = validityMode === "recurring";
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

    if (isRecurring) {
      if (daysOfWeek.length === 0) {
        setBanner({ message: t("createAi.errRecurringDay"), tone: "error" });
        return;
      }
      if (minutesFromDate(windowStart) >= minutesFromDate(windowEnd)) {
        setBanner({ message: t("createQuick.errWindowOrder"), tone: "error" });
        return;
      }
    } else {
      const end = endTime;
      if (now >= end) {
        setBanner({ message: t("createQuick.errEndFuture"), tone: "error" });
        return;
      }
      const durationMinutes = Math.floor((end.getTime() - now.getTime()) / 60000);
      if (cutoffNum >= durationMinutes) {
        setBanner({ message: t("createQuick.errCutoffDuration"), tone: "error" });
        return;
      }
    }

    setPublishing(true);
    setBanner(null);
    try {
      const priceNum = price.trim() ? Number(price) : null;
      if (price.trim() && Number.isNaN(priceNum)) {
        setBanner({ message: t("createQuick.errPriceNumber"), tone: "error" });
        return;
      }

      const quality = assessDealQuality({
        title: title.trim(),
        description: null,
        price: priceNum,
      });
      if (quality.blocked) {
        setBanner({ message: translateDealQualityBlock(quality, dealLang), tone: "error" });
        return;
      }

      const strongGuard = validateStrongDealOnly({
        title: title.trim(),
        description: offerHint.trim() || null,
      });
      if (!strongGuard.ok) {
        setBanner({ message: strongGuard.message, tone: "warning" });
        return;
      }

      const start = isRecurring ? now : now;
      const end = isRecurring
        ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        : endTime;

      const { error } = await supabase.from("deals").insert({
        business_id: businessId,
        title: title.trim(),
        description: null,
        price: priceNum,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        claim_cutoff_buffer_minutes: cutoffNum,
        max_claims: maxClaimsNum,
        is_active: true,
        poster_url: null,
        quality_tier: quality.tier,
        is_recurring: isRecurring,
        days_of_week: isRecurring ? daysOfWeek : null,
        window_start_minutes: isRecurring ? minutesFromDate(windowStart) : null,
        window_end_minutes: isRecurring ? minutesFromDate(windowEnd) : null,
        timezone: isRecurring ? timezone : null,
      });

      if (error) throw error;
      router.replace("/(tabs)/dashboard");
    } catch (err: any) {
      setBanner({ message: err?.message ?? t("createQuick.errPublishFailed"), tone: "error" });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("createQuick.title")}</Text>
      <Text style={{ marginTop: 6, opacity: 0.7, lineHeight: 20 }}>
        {t("createQuick.subtitle")}
      </Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {!isLoggedIn ? (
        <Text style={{ marginTop: Spacing.lg, opacity: 0.7 }}>{t("createQuick.loginPrompt")}</Text>
      ) : loading ? (
        <Text style={{ marginTop: Spacing.lg, opacity: 0.7 }}>{t("createQuick.loading")}</Text>
      ) : !businessId ? (
        <Text style={{ marginTop: Spacing.lg, opacity: 0.7 }}>{t("createQuick.createBusinessFirst")}</Text>
      ) : (
        <ScrollView
          style={{ flex: 1, marginTop: Spacing.lg }}
          contentContainerStyle={{ gap: Spacing.md, paddingBottom: scrollBottom }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {businessId ? (
            <>
              <Pressable
                onPress={() => setShowMenuPicker(true)}
                style={{
                  borderRadius: Radii.lg,
                  padding: Spacing.md,
                  backgroundColor: "#FFF5E6",
                  borderWidth: 1,
                  borderColor: Colors.light.primary,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: Spacing.sm,
                }}
              >
                <Text style={{ fontSize: 20 }}>📋</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", fontSize: 15, color: Colors.light.primary }}>
                    {t("createQuick.selectFromMenu")}
                  </Text>
                  <Text style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>
                    {t("createQuick.selectFromMenuHint")}
                  </Text>
                </View>
              </Pressable>
              <MenuItemPicker
                businessId={businessId}
                visible={showMenuPicker}
                onClose={() => setShowMenuPicker(false)}
                onSelect={handleMenuItemsSelected}
                maxSelect={2}
              />
            </>
          ) : null}

          <View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.fieldOfferHint")}</Text>
            <TextInput
              value={offerHint}
              onChangeText={setOfferHint}
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
              onChangeText={setTitle}
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
              onChangeText={setPrice}
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

          <View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createAi.validity")}</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Pressable
                onPress={() => setValidityMode("one-time")}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  backgroundColor: validityMode === "one-time" ? Colors.light.primary : "#eee",
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
                  backgroundColor: validityMode === "recurring" ? Colors.light.primary : "#eee",
                }}
              >
                <Text style={{ color: validityMode === "recurring" ? "#fff" : "#111", fontWeight: "700" }}>
                  {t("createAi.recurring")}
                </Text>
              </Pressable>
            </View>
          </View>

          {validityMode === "one-time" ? (
            <View>
              <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.fieldEndTime")}</Text>
              <Pressable
                onPress={() => setShowEndPicker(true)}
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
                <DateTimePicker
                  value={endTime}
                  mode="datetime"
                  onChange={(_event, date) => {
                    setShowEndPicker(false);
                    if (date) setEndTime(date);
                  }}
                />
              ) : null}
            </View>
          ) : (
            <View style={{ gap: Spacing.md }}>
              <View>
                <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createAi.days")}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
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
                          backgroundColor: selected ? Colors.light.primary : "#eee",
                        }}
                      >
                        <Text style={{ color: selected ? "#fff" : "#111", fontWeight: "600" }}>
                          {day.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View>
                <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createAi.timeWindow")}</Text>
                <Pressable
                  onPress={() => setShowWindowStartPicker(true)}
                  style={{
                    borderWidth: 1,
                    borderColor: Colors.light.border,
                    borderRadius: Radii.lg,
                    padding: Spacing.md,
                    marginTop: 6,
                    backgroundColor: Colors.light.surface,
                  }}
                >
                  <Text style={{ fontSize: 16 }}>
                    {t("createAi.windowStart")} {formatPickerTime(windowStart)}
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
                    borderColor: Colors.light.border,
                    borderRadius: Radii.lg,
                    padding: Spacing.md,
                    marginTop: 6,
                    backgroundColor: Colors.light.surface,
                  }}
                >
                  <Text style={{ fontSize: 16 }}>
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
              </View>
            </View>
          )}

          <View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.fieldMaxClaims")}</Text>
            <TextInput
              value={maxClaims}
              onChangeText={setMaxClaims}
              keyboardType="number-pad"
              placeholder={t("createQuick.placeholderMaxClaims")}
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
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.fieldCutoff")}</Text>
            <TextInput
              value={cutoffMins}
              onChangeText={setCutoffMins}
              keyboardType="number-pad"
              placeholder={t("createQuick.placeholderCutoff")}
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

          <PrimaryButton
            title={publishing ? t("createQuick.publishing") : t("createQuick.publish")}
            onPress={publishDeal}
            disabled={publishing || !canPublish}
            style={{ height: 66, borderRadius: 20, marginTop: 4 }}
          />
        </ScrollView>
      )}
    </View>
  );
}
