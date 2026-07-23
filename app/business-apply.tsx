import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { Colors, Radii, Shadows } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import {
  aiBusinessLookup,
  aiBusinessLookupDetails,
  type BusinessLookupResult,
} from "@/lib/functions";
import { submitBusinessApplication } from "@/lib/business-application";
import { isVerifiedBusinessLookupResult } from "@/lib/business-lookup";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";

type Tone = "error" | "success" | "info";

export default function BusinessApplyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { session } = useAuthSession();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  const email = session?.user?.email ?? null;

  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [websiteOrInstagram, setWebsiteOrInstagram] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [promoAuthorized, setPromoAuthorized] = useState(false);

  const [searching, setSearching] = useState(false);
  const [detailsLoadingPlaceId, setDetailsLoadingPlaceId] = useState<string | null>(null);
  const [lookupResults, setLookupResults] = useState<BusinessLookupResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: Tone } | null>(null);

  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current);
    };
  }, []);

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
      if (__DEV__) console.warn("[business-apply] Lookup error:", e);
      setBanner({ message: t("businessSetup.lookupError"), tone: "error" });
    } finally {
      setSearching(false);
    }
  }

  async function applyLookupResult(result: BusinessLookupResult) {
    if (detailsLoadingPlaceId !== null) return;
    if (!isVerifiedBusinessLookupResult(result)) {
      setBanner({ message: t("businessSetup.unverifiedResult"), tone: "info" });
      return;
    }
    setDetailsLoadingPlaceId(result.place_id);
    setBanner(null);
    try {
      const details = await aiBusinessLookupDetails({ place_id: result.place_id });
      if (!isVerifiedBusinessLookupResult(details)) {
        setBanner({ message: t("businessSetup.unverifiedResult"), tone: "info" });
        return;
      }
      setBusinessName(details.name);
      setAddress(details.formatted_address);
      setPhone(details.phone);
      if (details.category) setBusinessType(details.category);
      if (details.website) setWebsiteOrInstagram(details.website);
      setLookupResults(null);
      setBanner({ message: t("businessSetup.infoFilled"), tone: "success" });
    } catch (e: unknown) {
      if (__DEV__) console.warn("[business-apply] Place details error:", e);
      setBanner({ message: t("businessSetup.lookupDetailsError"), tone: "error" });
    } finally {
      setDetailsLoadingPlaceId(null);
    }
  }

  const scheduleReturn = useCallback(() => {
    redirectTimerRef.current = setTimeout(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/business-setup" as Href);
    }, 1000);
  }, [router]);

  async function onSubmit() {
    if (busy) return;
    setBanner(null);
    if (!businessName.trim() || !contactName.trim() || !address.trim() || !agreed) {
      setBanner({ message: t("businessApply.errRequired"), tone: "error" });
      return;
    }
    if (!email) {
      setBanner({ message: t("createHub.errLoginBusiness"), tone: "error" });
      return;
    }
    setBusy(true);
    try {
      await submitBusinessApplication({
        business_name: businessName.trim(),
        contact_name: contactName.trim(),
        address: address.trim(),
        phone: phone.trim() || null,
        business_type: businessType.trim() || null,
        website_or_instagram: websiteOrInstagram.trim() || null,
        terms_accepted: agreed,
        privacy_acknowledged: agreed,
        promo_materials_authorized: promoAuthorized,
      });
      setBanner({ message: t("businessApply.successBanner"), tone: "success" });
      scheduleReturn();
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "";
      const friendly = raw ? translateKnownApiMessage(raw, t) : "";
      setBanner({
        message: friendly && friendly !== raw ? friendly : t("businessApply.errSubmit"),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardScreen>
      <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, backgroundColor: theme.background }}>
        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3, color: theme.text }}>
          {t("businessApply.title")}
        </Text>
        <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, opacity: 0.72, fontSize: 15, lineHeight: 22, color: theme.text }}>
          {t("businessApply.subtitle")}
        </Text>
        {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.md }}
          {...FORM_SCROLL_KEYBOARD_PROPS}
          showsVerticalScrollIndicator={false}
        >
          {email ? (
            <View>
              <Text style={{ fontWeight: "700", marginBottom: 6, color: theme.text }}>
                {t("businessApply.emailLabel")}
              </Text>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: Radii.lg,
                  backgroundColor: theme.surfaceMuted ?? theme.surface,
                  paddingVertical: Spacing.sm,
                  paddingHorizontal: Spacing.md,
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: "700", color: theme.text }}>{email}</Text>
              </View>
            </View>
          ) : null}

          <Field
            label={t("businessSetup.businessName")}
            value={businessName}
            onChangeText={(s) => {
              setBusinessName(s);
              setLookupResults(null);
            }}
            theme={theme}
          />

          <SecondaryButton
            title={searching ? t("businessSetup.searching") : t("businessSetup.lookupButton")}
            onPress={() => void onLookup()}
            disabled={searching || detailsLoadingPlaceId !== null || !businessName.trim()}
          />

          {searching ? (
            <View style={{ alignItems: "center", paddingVertical: Spacing.sm }}>
              <ActivityIndicator color={theme.primary} />
            </View>
          ) : null}

          {lookupResults && lookupResults.length > 0 ? (
            <View style={{ gap: Spacing.sm }}>
              <Text style={{ fontSize: 13, fontWeight: "600", opacity: 0.6, color: theme.text }}>
                {t("businessSetup.selectResult")}
              </Text>
              {lookupResults.map((r, i) => (
                <Pressable key={r.place_id || i} onPress={() => void applyLookupResult(r)}>
                  <View
                    style={{
                      backgroundColor: theme.surface,
                      borderRadius: Radii.lg,
                      padding: Spacing.md,
                      borderWidth: 1,
                      borderColor: theme.border,
                      ...Shadows.soft,
                    }}
                  >
                    <Text style={{ fontWeight: "700", fontSize: 15, color: theme.text }}>{r.name}</Text>
                    <Text style={{ fontSize: 13, opacity: 0.7, marginTop: 2, color: theme.text }}>{r.formatted_address}</Text>
                    {r.phone ? <Text style={{ fontSize: 13, opacity: 0.6, marginTop: 2, color: theme.text }}>{r.phone}</Text> : null}
                    <Text style={{ fontSize: 11, color: theme.accentText, marginTop: 4 }}>
                      {t("businessSetup.verifiedSource")}
                    </Text>
                    {detailsLoadingPlaceId === r.place_id ? (
                      <ActivityIndicator color={theme.primary} style={{ marginTop: Spacing.xs }} />
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Field label={t("businessApply.contactName")} value={contactName} onChangeText={setContactName} theme={theme} />
          <View>
            <Field
              label={t("businessSetup.address")}
              value={address}
              onChangeText={setAddress}
              theme={theme}
            />
            <Text style={{ marginTop: 6, fontSize: 12, opacity: 0.6, color: theme.text }}>
              {t("businessApply.dfwHint")}
            </Text>
          </View>
          <Field label={t("businessSetup.phone")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" theme={theme} />
          <Field label={t("businessApply.businessType")} value={businessType} onChangeText={setBusinessType} theme={theme} />
          <Field
            label={`${t("businessApply.websiteOrInstagram")} · ${t("businessApply.optionalTag")}`}
            value={websiteOrInstagram}
            onChangeText={setWebsiteOrInstagram}
            autoCapitalize="none"
            theme={theme}
          />

          {/* Optional promotional-materials authorization — never gates submit. */}
          <View style={{ gap: Spacing.xs }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: theme.text }}>
              {t("businessSetup.promoAuthOptionalLabel")}
            </Text>
            <Pressable
              onPress={() => setPromoAuthorized((prev) => !prev)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: promoAuthorized }}
              style={{ flexDirection: "row", alignItems: "flex-start", gap: Spacing.xs }}
            >
              <MaterialIcons
                name={promoAuthorized ? "check-box" : "check-box-outline-blank"}
                size={22}
                color={promoAuthorized ? theme.primary : theme.icon}
              />
              <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: theme.text }}>
                {t("businessSetup.promoAuthCheckbox")}
              </Text>
            </Pressable>
          </View>

          {/* Required consent — captured explicitly for the application record. */}
          <Pressable
            onPress={() => setAgreed((prev) => !prev)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            style={{ flexDirection: "row", alignItems: "flex-start", gap: Spacing.xs }}
          >
            <MaterialIcons
              name={agreed ? "check-box" : "check-box-outline-blank"}
              size={22}
              color={agreed ? theme.primary : theme.icon}
            />
            <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: theme.text }}>
              {t("businessApply.agreeCheckbox")}
            </Text>
          </Pressable>
          <LegalExternalLinks />

          <PrimaryButton
            title={busy ? t("businessApply.submitting") : t("businessApply.submit")}
            onPress={() => void onSubmit()}
            disabled={busy}
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
  theme,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "words";
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
        }}
      />
    </View>
  );
}
