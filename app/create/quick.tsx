import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { assessDealQuality } from "../../lib/deal-quality";
import { useBusiness } from "../../hooks/use-business";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { aiGenerateDealCopy, notifyDealPublished } from "../../lib/functions";
import { Colors, Radii } from "../../constants/theme";
import {
  resolveDealFlowLanguage,
  translateDealQualityBlock,
} from "../../lib/translate-deal-quality";
import { formatAppDateTime } from "../../lib/i18n/format-datetime";
import { validateStrongDealOnly } from "../../lib/strong-deal-guard";

export default function QuickDealScreen() {
  const router = useRouter();
  const navigation = useNavigation();
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
  const [publishing, setPublishing] = useState(false);
  const [banner, setBanner] = useState<{
    message: string;
    tone: "error" | "success" | "warning";
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);

  const canPublish = useMemo(() => title.trim().length > 0, [title]);

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
    if (t0 || h0 || p0) setDirty(true);
    if (fromAi === "1" && (t0 || h0)) {
      setBanner({ message: t("createQuick.prefillFromAiCompose"), tone: "success" });
    }
    if (fromReuse === "1" && (t0 || h0)) {
      setBanner({ message: t("createQuick.prefillFromReuse"), tone: "success" });
    }
  }, [prefill.prefillTitle, prefill.prefillHint, prefill.prefillPrice, prefill.fromAiCompose, prefill.fromReuse, t]);

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
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err);
      setBanner({ message: m || t("createQuick.errAiSuggestFailed"), tone: "error" });
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

    const end = endTime;
    const now = new Date();
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
    if (now >= end) {
      setBanner({ message: t("createQuick.errEndFuture"), tone: "error" });
      return;
    }
    const durationMinutes = Math.floor((end.getTime() - now.getTime()) / 60000);
    if (cutoffNum >= durationMinutes) {
      setBanner({ message: t("createQuick.errCutoffDuration"), tone: "error" });
      return;
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

      const { data: deal, error } = await supabase.from("deals").insert({
        business_id: businessId,
        title: title.trim(),
        description: null,
        price: priceNum,
        start_time: now.toISOString(),
        end_time: end.toISOString(),
        claim_cutoff_buffer_minutes: cutoffNum,
        max_claims: maxClaimsNum,
        is_active: true,
        poster_url: null,
        quality_tier: quality.tier,
      }).select("id").single();

      if (error) throw error;
      if (deal?.id) void notifyDealPublished(deal.id);
      setDirty(false);
      router.replace("/(tabs)/dashboard");
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err);
      setBanner({ message: m || t("createQuick.errPublishFailed"), tone: "error" });
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

          <View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.fieldEndTime")}</Text>
            <Pressable
              onPress={() => {
                markDirty();
                setShowEndPicker(true);
              }}
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
                  if (date) {
                    markDirty();
                    setEndTime(date);
                  }
                }}
              />
            ) : null}
          </View>

          <View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("createQuick.fieldMaxClaims")}</Text>
            <TextInput
              value={maxClaims}
              onChangeText={(v) => {
                markDirty();
                setMaxClaims(v);
              }}
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
              onChangeText={(v) => {
                markDirty();
                setCutoffMins(v);
              }}
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
