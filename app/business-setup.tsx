import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import * as ImagePicker from "expo-image-picker";

import { Banner } from "@/components/ui/banner";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { consumePendingDeepLink } from "@/lib/post-auth-route";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { supabase } from "@/lib/supabase";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { isAuthBypassEnabled } from "@/lib/auth-bypass";
import { aiBusinessLookup, type BusinessLookupResult } from "@/lib/functions";

type Tone = "error" | "success" | "info";

const CATEGORY_KEYS = [
  "restaurant",
  "cafe",
  "bakery",
  "retail",
  "salon",
  "gym",
  "services",
  "other",
] as const;

const HOURS_PRESET_KEYS = [
  "weekday_9_5",
  "daily_8_8",
  "weekends",
  "late_night",
  "custom_prompt",
] as const;

export default function BusinessSetupScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { session, isInitialLoading: authLoading } = useAuthSession();
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme];
  const primary = Colors.light.primary;

  const [businessName, setBusinessName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [category, setCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [hoursPreset, setHoursPreset] = useState("");
  const [customHours, setCustomHours] = useState("");
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: Tone } | null>(null);
  const [searching, setSearching] = useState(false);
  const [lookupResults, setLookupResults] = useState<BusinessLookupResult[] | null>(null);

  const trimmed = useMemo(
    () => ({
      businessName: businessName.trim(),
      address: address.trim(),
      phone: phone.trim(),
      shortDescription: shortDescription.trim(),
    }),
    [businessName, address, phone, shortDescription],
  );

  const resolvedCategory = category === "other" ? customCategory.trim() : category;
  const resolvedHours = hoursPreset === "custom_prompt" ? customHours.trim() : hoursPreset ? t(`businessSetup.hoursPreset.${hoursPreset}`) : "";

  useEffect(() => {
    if (authLoading) return;
    const bypass = isAuthBypassEnabled({
      skipSetup: String(params.skipSetup ?? ""),
      e2e: String(params.e2e ?? ""),
      isDev: __DEV__,
    });
    if (!bypass && !session?.user?.id) router.replace("/auth-landing");
  }, [router, params.skipSetup, params.e2e, session?.user?.id, authLoading]);

  async function pickLogo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setBanner({ message: t("businessSetup.errPhotoPermission", "Photo library permission is needed to upload a logo."), tone: "error" });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.65,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled && result.assets[0]) {
      setLogoUri(result.assets[0].uri);
    }
  }

  async function uploadLogo(businessId: string): Promise<string | null> {
    if (!logoUri) return null;
    setLogoUploading(true);
    try {
      const ext = logoUri.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${businessId}/logo_${Date.now()}.${ext}`;
      const response = await fetch(logoUri);
      const blob = await response.blob();
      const { error } = await supabase.storage
        .from("business-logos")
        .upload(path, blob, { contentType: `image/${ext === "png" ? "png" : "jpeg"}`, upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("business-logos").getPublicUrl(path);
      return urlData.publicUrl;
    } catch {
      setBanner({ message: t("businessSetup.errLogoUpload", "Could not upload logo. Try again."), tone: "error" });
      return null;
    } finally {
      setLogoUploading(false);
    }
  }

  async function onLookup() {
    if (!businessName.trim()) {
      setBanner({ message: t("businessSetup.errEnterName"), tone: "error" });
      return;
    }
    setSearching(true);
    setLookupResults(null);
    setBanner(null);
    try {
      const results = await aiBusinessLookup({ business_name: businessName.trim() });
      if (results.length === 0) {
        setBanner({ message: t("businessSetup.noResults"), tone: "info" });
      }
      setLookupResults(results.length > 0 ? results : null);
    } catch (e: unknown) {
      if (__DEV__) console.warn("[business-setup] Lookup error:", e);
      setBanner({ message: t("businessSetup.lookupError"), tone: "error" });
    } finally {
      setSearching(false);
    }
  }

  function applyLookupResult(result: BusinessLookupResult) {
    setBusinessName(result.name);
    setAddress(result.formatted_address);
    if (result.phone) setPhone(result.phone);
    if (result.category) setShortDescription(result.category);
    setLookupResults(null);
    const isEstimate = result.source === "ai_estimate";
    setBanner({
      message: isEstimate
        ? t("businessSetup.estimatedInfo")
        : t("businessSetup.infoFilled"),
      tone: isEstimate ? "info" : "success",
    });
  }

  async function onSubmit() {
    setBanner(null);
    if (!trimmed.businessName || !trimmed.address) {
      setBanner({ message: t("businessSetup.errNameAddress"), tone: "error" });
      return;
    }

    const uid = session?.user?.id;
    if (!uid) {
      setBanner({ message: t("createHub.errLoginBusiness"), tone: "error" });
      return;
    }

    setBusy(true);
    try {
      const addr = trimmed.address;
      const trialEndsIso = new Date(Date.now() + 30 * 86400000).toISOString();

      const { data: bizData, error } = await supabase
        .from("businesses")
        .upsert(
          {
            owner_id: uid,
            name: trimmed.businessName,
            phone: trimmed.phone || null,
            address: addr,
            location: addr,
            short_description: trimmed.shortDescription || null,
            category: resolvedCategory || null,
            hours_text: resolvedHours || null,
          },
          { onConflict: "owner_id" },
        )
        .select("id")
        .single();
      if (error) throw error;

      // Upload logo if picked
      if (logoUri && bizData?.id) {
        const logoUrl = await uploadLogo(bizData.id);
        if (logoUrl) {
          await supabase
            .from("businesses")
            .update({ logo_url: logoUrl })
            .eq("id", bizData.id);
        }
      }

      const selectCols =
        "id,user_id,owner_id,subscription_status,subscription_tier,trial_ends_at,current_period_ends_at";
      const { data: profileByUser } = await supabase
        .from("business_profiles")
        .select(selectCols)
        .eq("user_id", uid)
        .maybeSingle();
      const { data: profileByOwner } = await supabase
        .from("business_profiles")
        .select(selectCols)
        .eq("owner_id", uid)
        .maybeSingle();

      const existingProfile = profileByUser ?? profileByOwner ?? null;
      const billingDefaults: Record<string, unknown> = {};
      if (!existingProfile?.subscription_status) billingDefaults.subscription_status = "trial";
      if (!existingProfile?.subscription_tier) billingDefaults.subscription_tier = "pro";
      if (!existingProfile?.trial_ends_at) billingDefaults.trial_ends_at = trialEndsIso;
      if (!existingProfile?.current_period_ends_at) {
        billingDefaults.current_period_ends_at = String(existingProfile?.trial_ends_at ?? trialEndsIso);
      }

      const profilePayloadByUser = {
        user_id: uid,
        name: trimmed.businessName,
        address: addr,
        category: resolvedCategory || trimmed.businessName || null,
        setup_completed: true,
        ...billingDefaults,
      };
      const upsertByUser = await supabase
        .from("business_profiles")
        .upsert(profilePayloadByUser, { onConflict: "user_id" });
      if (upsertByUser.error) {
        const profilePayloadByOwner = {
          owner_id: uid,
          name: trimmed.businessName,
          address: addr,
          category: resolvedCategory || trimmed.businessName || null,
          setup_completed: true,
          ...billingDefaults,
        };
        const upsertByOwner = await supabase
          .from("business_profiles")
          .upsert(profilePayloadByOwner, { onConflict: "owner_id" });
        if (upsertByOwner.error) throw upsertByOwner.error;
      }

      setBanner({ message: t("businessSetup.setupComplete"), tone: "success" });
      setTimeout(async () => {
        const pending = await consumePendingDeepLink();
        router.replace((pending ?? "/(tabs)/dashboard") as Href);
      }, 250);
    } catch (e: unknown) {
      if (__DEV__) console.warn("[business-setup] Save error:", e);
      setBanner({
        message: t("businessSetup.errSave"),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardScreen>
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, backgroundColor: theme.background }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3, color: theme.text }}>{t("businessSetup.title")}</Text>
      <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, opacity: 0.72, fontSize: 15, lineHeight: 22, color: theme.text }}>
        {t("businessSetup.subtitle")}
      </Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.md }}
        {...FORM_SCROLL_KEYBOARD_PROPS}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo upload */}
        <View style={{ alignItems: "center", marginBottom: Spacing.xs }}>
          <Pressable onPress={pickLogo} style={{ alignItems: "center" }}>
            {logoUri ? (
              <Image
                source={{ uri: logoUri }}
                style={{ width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: primary }}
              />
            ) : (
              <View
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: 44,
                  borderWidth: 2,
                  borderColor: theme.border,
                  borderStyle: "dashed",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.surface,
                }}
              >
                {logoUploading ? (
                  <ActivityIndicator color={primary} />
                ) : (
                  <Text style={{ fontSize: 28, opacity: 0.4 }}>+</Text>
                )}
              </View>
            )}
            <Text style={{ marginTop: Spacing.xs, fontSize: 13, opacity: 0.6, color: theme.text }}>
              {t("businessSetup.logoUploadHint", "Tap to upload your logo")}
            </Text>
          </Pressable>
        </View>

        <Field label={t("businessSetup.businessName")} value={businessName} onChangeText={setBusinessName} theme={theme} />
        <Field label={t("businessSetup.address")} value={address} onChangeText={setAddress} theme={theme} />
        <Field label={t("businessSetup.phone")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" theme={theme} />
        <Field
          label={t("businessSetup.shortDescription")}
          value={shortDescription}
          onChangeText={setShortDescription}
          multiline
          placeholder={t("businessSetup.shortDescriptionPh")}
          theme={theme}
        />

        {/* Category picker */}
        <View>
          <Text style={{ fontWeight: "700", marginBottom: 6, color: theme.text }}>{t("businessSetup.categoryLabel")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs }}>
            {CATEGORY_KEYS.map((key) => {
              const active = category === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setCategory(active ? "" : key)}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 14,
                    borderRadius: Radii.xl,
                    borderWidth: 1.5,
                    borderColor: active ? primary : theme.border,
                    backgroundColor: active ? "rgba(255,159,28,0.12)" : theme.surface,
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: active ? "800" : "600", color: active ? primary : theme.text }}>
                    {t(`businessSetup.cat.${key}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {category === "other" ? (
            <TextInput
              value={customCategory}
              onChangeText={setCustomCategory}
              placeholder={t("businessSetup.categoryOtherPh")}
              placeholderTextColor={theme.icon}
              style={{
                marginTop: Spacing.sm,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: Radii.lg,
                backgroundColor: theme.surface,
                paddingVertical: Spacing.sm,
                paddingHorizontal: Spacing.md,
                fontSize: 16,
                color: theme.text,
              }}
            />
          ) : null}
        </View>

        {/* Hours picker */}
        <View>
          <Text style={{ fontWeight: "700", marginBottom: 6, color: theme.text }}>{t("businessSetup.hoursLabel")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs }}>
            {HOURS_PRESET_KEYS.map((key) => {
              const active = hoursPreset === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setHoursPreset(active ? "" : key)}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 14,
                    borderRadius: Radii.xl,
                    borderWidth: 1.5,
                    borderColor: active ? primary : theme.border,
                    backgroundColor: active ? "rgba(255,159,28,0.12)" : theme.surface,
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: active ? "800" : "600", color: active ? primary : theme.text }}>
                    {t(`businessSetup.hoursPreset.${key}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {hoursPreset === "custom_prompt" ? (
            <TextInput
              value={customHours}
              onChangeText={setCustomHours}
              placeholder={t("businessSetup.hoursCustomPh")}
              placeholderTextColor={theme.icon}
              multiline
              style={{
                marginTop: Spacing.sm,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: Radii.lg,
                backgroundColor: theme.surface,
                paddingVertical: Spacing.sm,
                paddingHorizontal: Spacing.md,
                fontSize: 16,
                color: theme.text,
                minHeight: 60,
                textAlignVertical: "top",
              }}
            />
          ) : null}
        </View>

        <View style={{ gap: Spacing.sm }}>
          <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.68, color: theme.text }}>{t("legal.businessSetupHint")}</Text>
          <LegalExternalLinks />
        </View>

        <PrimaryButton
          title={busy ? t("businessSetup.creating") : t("businessSetup.continue")}
          onPress={() => void onSubmit()}
          disabled={busy || logoUploading}
        />
      </ScrollView>
    </View>
    </KeyboardScreen>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  autoCapitalize,
  multiline,
  placeholder,
  theme,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "words";
  multiline?: boolean;
  placeholder?: string;
  theme: typeof Colors.light;
}) {
  return (
    <View>
      <Text style={{ fontWeight: "700", marginBottom: 6, color: theme.text }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "words"}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={theme.icon}
        style={{
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: Radii.lg,
          backgroundColor: theme.surface,
          paddingVertical: Spacing.sm,
          paddingHorizontal: Spacing.md,
          fontSize: 16,
          color: theme.text,
          minHeight: multiline ? 92 : undefined,
          textAlignVertical: multiline ? "top" : "auto",
        }}
      />
    </View>
  );
}
