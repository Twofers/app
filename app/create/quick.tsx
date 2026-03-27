import { useEffect, useMemo, useState } from "react";
import { Image, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import * as ImagePicker from "expo-image-picker";
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
import { validateStrongDealOnly, type DealType } from "../../lib/strong-deal-guard";

const DEAL_TYPE_OPTIONS: { key: DealType; label: string }[] = [
  { key: "bogo", label: "BOGO" },
  { key: "buy2get1", label: "Buy 2 Get 1" },
  { key: "free_item", label: "Free Item" },
  { key: "percentage_off", label: "% Off" },
];

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

  const [dealType, setDealType] = useState<DealType>("bogo");
  const [discountPercent, setDiscountPercent] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [suggestingAi, setSuggestingAi] = useState(false);
  const [price, setPrice] = useState("");
  const [startTime, setStartTime] = useState(new Date());
  const [endTime, setEndTime] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [photo, setPhoto] = useState<{ uri: string; type: string } | null>(null);
  const [maxClaims, setMaxClaims] = useState("50");
  const [cutoffMins, setCutoffMins] = useState("15");
  const [publishing, setPublishing] = useState(false);
  const [banner, setBanner] = useState<{
    message: string;
    tone: "error" | "success" | "warning";
  } | null>(null);

  const canPublish = useMemo(() => title.trim().length > 0, [title]);

  useEffect(() => {
    const g = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
    const t0 = (g(prefill.prefillTitle) ?? "").trim();
    const h0 = (g(prefill.prefillHint) ?? "").trim();
    const p0 = (g(prefill.prefillPrice) ?? "").trim();
    const fromAi = g(prefill.fromAiCompose);
    const fromReuse = g(prefill.fromReuse);
    if (t0) setTitle((prev) => prev || t0);
    if (h0) setDescription((prev) => prev || h0);
    if (p0) setPrice((prev) => prev || p0);
    if (fromAi === "1" && (t0 || h0)) {
      setBanner({ message: t("createQuick.prefillFromAiCompose"), tone: "success" });
    }
    if (fromReuse === "1" && (t0 || h0)) {
      setBanner({ message: t("createQuick.prefillFromReuse"), tone: "success" });
    }
  }, [prefill.prefillTitle, prefill.prefillHint, prefill.prefillPrice, prefill.fromAiCompose, prefill.fromReuse, t]);

  async function pickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setBanner({ message: "Photo library permission is required to add a photo.", tone: "error" });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPhoto({ uri: asset.uri, type: asset.mimeType ?? "image/jpeg" });
    }
  }

  async function uploadPhoto(bizId: string): Promise<string | null> {
    if (!photo) return null;
    const ext = photo.type === "image/png" ? "png" : "jpg";
    const path = `${bizId}/${Date.now()}.${ext}`;
    const response = await fetch(photo.uri);
    const blob = await response.blob();
    const { data, error } = await supabase.storage
      .from("deal-photos")
      .upload(path, blob, { contentType: photo.type, upsert: false });
    if (error) throw error;
    return data.path;
  }

  async function suggestTitleFromAi() {
    if (!businessId) {
      setBanner({ message: t("createQuick.errCreateBusiness"), tone: "error" });
      return;
    }
    const hint = description.trim();
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

    // Validate discount percent for percentage_off deals
    let discountPctNum: number | null = null;
    if (dealType === "percentage_off") {
      discountPctNum = Number(discountPercent);
      if (!discountPercent.trim() || Number.isNaN(discountPctNum)) {
        setBanner({ message: "Enter a valid discount percentage.", tone: "error" });
        return;
      }
      if (discountPctNum < 40 || discountPctNum > 100) {
        setBanner({ message: "Percentage discounts must be between 40% and 100%.", tone: "error" });
        return;
      }
    }

    const end = endTime;
    const start = startTime;
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
    if (start >= end) {
      setBanner({ message: "Start time must be before end time.", tone: "error" });
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
        description: description.trim() || null,
        price: priceNum,
      });
      if (quality.blocked) {
        setBanner({ message: translateDealQualityBlock(quality, dealLang), tone: "error" });
        return;
      }

      const strongGuard = validateStrongDealOnly({
        title: title.trim(),
        description: description.trim() || null,
        dealType,
        discountPercent: discountPctNum,
      });
      if (!strongGuard.ok) {
        setBanner({ message: strongGuard.message, tone: "warning" });
        return;
      }

      // Upload photo if selected
      let posterStoragePath: string | null = null;
      if (photo) {
        posterStoragePath = await uploadPhoto(businessId);
      }

      const { error } = await supabase.from("deals").insert({
        business_id: businessId,
        title: title.trim(),
        description: description.trim() || null,
        price: priceNum,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        claim_cutoff_buffer_minutes: cutoffNum,
        max_claims: maxClaimsNum,
        is_active: true,
        deal_type: dealType,
        poster_url: null,
        poster_storage_path: posterStoragePath,
        quality_tier: quality.tier,
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
        Built for speed: complete this flow in under a minute.
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
          {/* Deal Type */}
          <View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C", marginBottom: 8 }}>
              Deal Type *
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {DEAL_TYPE_OPTIONS.map((opt) => {
                const selected = dealType === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => setDealType(opt.key)}
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderRadius: Radii.pill,
                      borderWidth: 1.5,
                      borderColor: selected ? Colors.light.primary : Colors.light.border,
                      backgroundColor: selected ? "#FFF3E0" : Colors.light.surface,
                    }}
                  >
                    <Text
                      style={{
                        color: selected ? Colors.light.primary : "#11181C",
                        fontWeight: selected ? "700" : "400",
                        fontSize: 14,
                      }}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Discount % — only for percentage_off */}
          {dealType === "percentage_off" ? (
            <View>
              <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>
                Discount % (minimum 40%)
              </Text>
              <TextInput
                value={discountPercent}
                onChangeText={setDiscountPercent}
                keyboardType="number-pad"
                placeholder="e.g. 40"
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
              <Text style={{ marginTop: 4, fontSize: 12, opacity: 0.55 }}>
                Discounts under 40% are not allowed on TWOFER.
              </Text>
            </View>
          ) : null}

          {/* Title */}
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

          {/* Description / AI hint */}
          <View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>Description</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Describe your deal or add details for customers…"
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

          {/* Photo upload */}
          <View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C", marginBottom: 8 }}>
              Photo (optional)
            </Text>
            {photo ? (
              <View>
                <Image
                  source={{ uri: photo.uri }}
                  style={{ width: "100%", height: 160, borderRadius: Radii.lg, backgroundColor: "#eee" }}
                  resizeMode="cover"
                />
                <TouchableOpacity
                  onPress={() => setPhoto(null)}
                  style={{ marginTop: 6 }}
                >
                  <Text style={{ color: Colors.light.primary, fontWeight: "600", fontSize: 14 }}>
                    Remove photo
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => void pickPhoto()}
                style={{
                  borderWidth: 1.5,
                  borderColor: Colors.light.border,
                  borderRadius: Radii.lg,
                  borderStyle: "dashed",
                  padding: Spacing.lg,
                  alignItems: "center",
                  backgroundColor: Colors.light.surface,
                }}
              >
                <Text style={{ color: Colors.light.primary, fontWeight: "600", fontSize: 15 }}>
                  + Add Photo
                </Text>
                <Text style={{ color: "#888", fontSize: 12, marginTop: 4 }}>16:9 recommended</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Price */}
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

          {/* Start Time */}
          <View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>Start Time</Text>
            <Pressable
              onPress={() => setShowStartPicker(true)}
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
              <DateTimePicker
                value={startTime}
                mode="datetime"
                onChange={(_event, date) => {
                  setShowStartPicker(false);
                  if (date) setStartTime(date);
                }}
              />
            ) : null}
          </View>

          {/* End Time */}
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

          {/* Max Claims */}
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

          {/* Cutoff Buffer */}
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
