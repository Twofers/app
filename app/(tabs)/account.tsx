import { useEffect, useState } from "react";
import { Alert, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { useRouter, type Href } from "expo-router";
import { requestNotificationPermissionsSafe } from "@/lib/expo-notifications-support";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { getAlertsEnabled, setAlertsEnabled } from "../../lib/notifications";
import { useBusiness } from "../../hooks/use-business";
import { Banner } from "../../components/ui/banner";
import { CardShell } from "@/components/ui/card-shell";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import type { AppLocale } from "../../lib/i18n/config";
import { setUiLocalePreference } from "../../lib/locale/ui-locale-storage";
import { useTabMode } from "../../lib/tab-mode";
import { LegalExternalLinks } from "../../components/legal-external-links";
import { DELETE_ACCOUNT_BLOCKED_BUSINESS_OWNER, deleteUserAccount } from "../../lib/functions";
import { DELETE_ACCOUNT_URL, SUPPORT_URL, openWebsiteUrl } from "../../lib/legal-urls";
import { DEMO_PREVIEW_EMAIL } from "../../lib/demo-account";
import { ensureDemoCoffeePreview } from "../../lib/demo-preview-seed";
import { signInDemoPreviewUser } from "../../lib/demo-auth-signin";
import { friendlyAuthError, friendlyAuthMessage, friendlyDemoAuthMessage } from "../../lib/auth-error-messages";
import { logAuthPath } from "../../lib/auth-path-log";
import { isDemoAuthHelperEnabled } from "../../lib/runtime-env";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { Colors, Radii } from "@/constants/theme";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getBusinessProfileAccessForCurrentUser } from "@/lib/business-profile-access";
import { signOutAndRedirectToAuthLanding } from "@/lib/auth-app-sign-out";

export default function AccountScreen() {
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const { mode: tabMode, setMode: setTabMode } = useTabMode();
  const { t, i18n } = useTranslation();
  const {
    isLoggedIn,
    userId,
    sessionEmail,
    businessId,
    businessOwnershipAmbiguous,
    businessProfile,
    businessName,
    loading,
    refresh,
  } = useBusiness();
  const blockInAppSelfDelete = Boolean(businessId || businessOwnershipAmbiguous);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone?: "error" | "success" | "info" } | null>(null);
  const [alertsEnabled, setAlertsEnabledState] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [profileBusinessName, setProfileBusinessName] = useState("");
  const [profileContactName, setProfileContactName] = useState("");
  const [profileBusinessEmail, setProfileBusinessEmail] = useState("");
  const [profileAddress, setProfileAddress] = useState("");
  const [profileCategory, setProfileCategory] = useState("");
  const [profileTone, setProfileTone] = useState("");
  const [profileLocation, setProfileLocation] = useState("");
  const [profileLatitude, setProfileLatitude] = useState("");
  const [profileLongitude, setProfileLongitude] = useState("");
  const [profileShortDescription, setProfileShortDescription] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  /** null = follow app language for AI / deal-quality */
  const [profilePreferredLocale, setProfilePreferredLocale] = useState<string | null>(null);
  const [profilePhone, setProfilePhone] = useState("");
  const [profileHours, setProfileHours] = useState("");
  const [businessProfileCheckLoading, setBusinessProfileCheckLoading] = useState(false);
  const [businessProfileComplete, setBusinessProfileComplete] = useState(false);
  const [businessSetupMessage, setBusinessSetupMessage] = useState<string | null>(null);
  const [businessProfileSnapshot, setBusinessProfileSnapshot] = useState<{
    name: string | null;
    address: string | null;
    category: string | null;
  } | null>(null);
  const [bizProfileExpanded, setBizProfileExpanded] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  useEffect(() => {
    if (!isLoggedIn || tabMode !== "business") {
      setBusinessProfileComplete(false);
      setBusinessProfileSnapshot(null);
      setBusinessProfileCheckLoading(false);
      return;
    }
    let cancelled = false;
    setBusinessProfileCheckLoading(true);
    void getBusinessProfileAccessForCurrentUser()
      .then((access) => {
        if (cancelled) return;
        setBusinessProfileComplete(access.isComplete);
        setBusinessProfileSnapshot(
          access.profile
            ? {
                name: access.profile.name ?? null,
                address: access.profile.address ?? null,
                category: access.profile.category ?? null,
              }
            : null,
        );
        if (access.isComplete) {
          setBusinessSetupMessage(t("account.bizSetupComplete"));
        } else if (access.hasProfileRow) {
          setBusinessSetupMessage(t("account.bizSetupFinish"));
        } else {
          setBusinessSetupMessage(t("account.bizSetupStart"));
        }
      })
      .finally(() => {
        if (!cancelled) setBusinessProfileCheckLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, tabMode, t]);

  useEffect(() => {
    if (!businessProfile) {
      setProfileBusinessName("");
      setProfileContactName("");
      setProfileBusinessEmail("");
      setProfileAddress("");
      setProfileCategory("");
      setProfileTone("");
      setProfileLocation("");
      setProfileLatitude("");
      setProfileLongitude("");
      setProfileShortDescription("");
      setProfilePreferredLocale(null);
      setProfilePhone("");
      setProfileHours("");
      return;
    }
    setProfileBusinessName(businessProfile.name ?? "");
    setProfileContactName(businessProfile.contact_name ?? "");
    setProfileBusinessEmail(businessProfile.business_email ?? "");
    setProfileAddress(businessProfile.address ?? "");
    setProfileCategory(businessProfile.category ?? "");
    setProfileTone(businessProfile.tone ?? "");
    setProfileLocation(businessProfile.location ?? "");
    setProfileLatitude(
      businessProfile.latitude != null && Number.isFinite(businessProfile.latitude)
        ? String(businessProfile.latitude)
        : "",
    );
    setProfileLongitude(
      businessProfile.longitude != null && Number.isFinite(businessProfile.longitude)
        ? String(businessProfile.longitude)
        : "",
    );
    setProfileShortDescription(businessProfile.short_description ?? "");
    setProfilePreferredLocale(businessProfile.preferred_locale ?? null);
    setProfilePhone(businessProfile.phone ?? "");
    setProfileHours(businessProfile.hours_text ?? "");
  }, [businessProfile]);

  useEffect(() => {
    (async () => {
      const enabled = await getAlertsEnabled();
      setAlertsEnabledState(enabled);
      setAlertsLoading(false);
    })();
  }, []);

  async function toggleAlerts(next: boolean) {
    if (next) {
      const { status, skippedBecauseExpoGo } = await requestNotificationPermissionsSafe();
      if (skippedBecauseExpoGo) {
        setBanner({ message: t("settingsScreen.alertsExpoGoBody"), tone: "info" });
        return;
      }
      if (status !== "granted") {
        setBanner({ message: t("account.alertsEnableHint"), tone: "info" });
        return;
      }
    }
    await setAlertsEnabled(next);
    setAlertsEnabledState(next);
    setBanner({ message: next ? t("account.alertsOn") : t("account.alertsOff"), tone: "success" });
  }

  async function signUp() {
    setBusy(true);
    setBanner(null);
    logAuthPath("signup");
    try {
      const trimmed = email.trim();
      if (!trimmed || !pw) {
        setBanner({ message: t("auth.errFieldsRequired"), tone: "error" });
        return;
      }
      const { error } = await supabase.auth.signUp({
        email: trimmed,
        password: pw,
      });
      if (error) throw error;
      setBanner({ message: t("auth.alertSignUpSuccessMsg"), tone: "success" });
    } catch (e: unknown) {
      const raw = e && typeof e === "object" && "message" in e ? String((e as { message?: string }).message) : String(e);
      setBanner({ message: friendlyAuthMessage(raw, t), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    setBusy(true);
    setBanner(null);
    try {
      const emailToUse = email.trim();
      const pwToUse = pw;
      if (!emailToUse || !pwToUse) {
        setBanner({ message: t("auth.errFieldsRequired"), tone: "error" });
        return;
      }
      logAuthPath("normal_login", emailToUse);
      const isDemoEmail = emailToUse.toLowerCase() === DEMO_PREVIEW_EMAIL;

      const { error } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password: pwToUse,
      });

      if (error) {
        setBanner({ message: friendlyAuthError(error, t), tone: "error" });
        return;
      }

      if (isDemoEmail) {
        await ensureDemoCoffeePreview(supabase);
      }

      await refresh();
      setBanner({ message: t("auth.alertLoggedInMsg"), tone: "success" });
    } catch (e: unknown) {
      const raw = e && typeof e === "object" && "message" in e ? String((e as { message?: string }).message) : String(e);
      setBanner({ message: friendlyAuthMessage(raw, t), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function demoLoginFromAccount() {
    if (busy || !isDemoAuthHelperEnabled()) return;
    setBusy(true);
    setBanner(null);
    logAuthPath("demo_login");
    try {
      const result = await signInDemoPreviewUser();
      if (!result.ok) {
        setBanner({ message: friendlyDemoAuthMessage(result.message, t), tone: "error" });
        return;
      }
      await refresh();
      setBanner({ message: t("auth.alertLoggedInMsg"), tone: "success" });
    } catch (e: unknown) {
      const raw = e && typeof e === "object" && "message" in e ? String((e as { message?: string }).message) : String(e);
      setBanner({ message: friendlyDemoAuthMessage(raw, t), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function performSignOut() {
    setBusy(true);
    setBanner(null);
    try {
      const result = await signOutAndRedirectToAuthLanding({
        userId,
        setTabMode,
        replace: router.replace,
      });
      if (!result.ok) {
        setBanner({
          message: result.message || t("account.errLogoutFailed"),
          tone: "error",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  function confirmLogout() {
    Alert.alert(t("account.logoutConfirmTitle"), t("account.logoutConfirmBody"), [
      { text: t("commonUi.cancel"), style: "cancel" },
      {
        text: t("account.logoutConfirmCta"),
        style: "destructive",
        onPress: () => void performSignOut(),
      },
    ]);
  }

  function confirmDeleteAccount() {
    Alert.alert(t("deleteAccount.title"), t("deleteAccount.bodyConsumer"), [
      { text: t("commonUi.cancel"), style: "cancel" },
      {
        text: t("deleteAccount.confirmDestructive"),
        style: "destructive",
        onPress: () => void runDeleteAccount(),
      },
    ]);
  }

  async function runDeleteAccount() {
    setBusy(true);
    setBanner(null);
    try {
      await deleteUserAccount();
      await supabase.auth.signOut();
      router.replace("/auth-landing" as Href);
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : undefined;
      if (code === DELETE_ACCOUNT_BLOCKED_BUSINESS_OWNER) {
        setBanner({ message: t("deleteAccount.businessOwnerBlockedShort"), tone: "info" });
        Alert.alert(t("deleteAccount.businessOwnerBlockedTitle"), t("deleteAccount.businessOwnerBlockedBody"), [
          { text: t("deleteAccount.alertDismiss"), style: "cancel" },
          { text: t("deleteAccount.contactSupportCta"), onPress: () => void openWebsiteUrl(SUPPORT_URL) },
        ]);
        return;
      }
      const msg = e instanceof Error ? e.message : t("deleteAccount.errFailed");
      setBanner({ message: msg, tone: "error" });
      Alert.alert(t("deleteAccount.errFailed"), t("deleteAccount.fallbackWebBody"), [
        { text: t("deleteAccount.alertDismiss"), style: "cancel" },
        {
          text: t("deleteAccount.openWebsiteFallbackCta"),
          onPress: () => void openWebsiteUrl(DELETE_ACCOUNT_URL),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function parseOptionalCoord(raw: string, kind: "lat" | "lng", tr: TFunction): number | null {
    const s = raw.trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) {
      throw new Error(kind === "lat" ? tr("account.errLatNumber") : tr("account.errLngNumber"));
    }
    if (kind === "lat" && (n < -90 || n > 90)) {
      throw new Error(tr("account.errLatRange"));
    }
    if (kind === "lng" && (n < -180 || n > 180)) {
      throw new Error(tr("account.errLngRange"));
    }
    return n;
  }

  async function saveBusinessProfile() {
    if (!businessId) return;
    setSavingProfile(true);
    setBanner(null);
    try {
      let latitude: number | null;
      let longitude: number | null;
      try {
        latitude = parseOptionalCoord(profileLatitude, "lat", t);
        longitude = parseOptionalCoord(profileLongitude, "lng", t);
      } catch (e: unknown) {
        setBanner({
          message: (e instanceof Error ? e.message : String(e)) || t("account.errCoordsInvalid"),
          tone: "error",
        });
        return;
      }
      if ((latitude == null) !== (longitude == null)) {
        setBanner({
          message: t("account.errCoordsBoth"),
          tone: "error",
        });
        return;
      }
      const nm = profileBusinessName.trim();
      const cn = profileContactName.trim();
      const em = profileBusinessEmail.trim();
      const ph = profilePhone.trim();
      const ad = profileAddress.trim();
      const cat = profileCategory.trim();
      const hrs = profileHours.trim();
      if (!nm || !cn || !em || !ph || !ad || !cat || !hrs) {
        setBanner({ message: t("account.errBizCoreRequired"), tone: "error" });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        setBanner({ message: t("account.errBizEmailInvalid"), tone: "error" });
        return;
      }
      const addr = ad;
      const { error } = await supabase
        .from("businesses")
        .update({
          name: nm,
          contact_name: cn || null,
          business_email: em || null,
          address: addr,
          category: cat || null,
          tone: profileTone.trim() || null,
          location: profileLocation.trim() || addr,
          latitude,
          longitude,
          short_description: profileShortDescription.trim() || null,
          preferred_locale: profilePreferredLocale,
          phone: ph || null,
          hours_text: hrs || null,
        })
        .eq("id", businessId);
      if (error) throw error;
      await refresh();
      setBanner({ message: t("account.profileSaved"), tone: "success" });
    } catch (e: unknown) {
      setBanner({
        message:
          (e instanceof Error ? e.message : String(e)) || t("account.errSaveProfileFailed"),
        tone: "error",
      });
    } finally {
      setSavingProfile(false);
    }
  }

  function goToBusinessSetup() {
    if (!sessionEmail) {
      setBanner({ message: t("account.errLoginForBiz"), tone: "error" });
      return;
    }
    router.push("/business-setup" as Href);
  }

  function goToCreateDeal() {
    router.push("/create/quick");
  }

  async function chooseAppLocale(locale: AppLocale) {
    setBanner(null);
    await setUiLocalePreference(locale, { manual: true });
    await i18n.changeLanguage(locale);
    setBanner({ message: t("account.languageSaved"), tone: "success" });
  }

  function localeChip(label: string, locale: AppLocale, active: boolean, onPress: () => void) {
    return (
      <Pressable
        key={locale}
        onPress={onPress}
        style={{
          paddingVertical: Spacing.sm,
          paddingHorizontal: Spacing.md,
          borderRadius: Radii.pill,
          backgroundColor: active ? "rgba(255,159,28,0.16)" : Colors.light.surfaceMuted,
          borderWidth: 1,
          borderColor: active ? "rgba(255,159,28,0.4)" : Colors.light.border,
          marginRight: Spacing.sm,
          marginBottom: Spacing.sm,
        }}
      >
        <Text style={{ color: active ? Colors.light.primary : "#333", fontWeight: "700", fontSize: 13 }}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <KeyboardScreen>
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title={t("account.title")} />
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {!isLoggedIn ? (
        tabMode === "business" ? (
          <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
            <View
              style={{
                borderRadius: Radii.lg,
                padding: Spacing.md,
                backgroundColor: Colors.light.surface,
                borderWidth: 1,
                borderColor: Colors.light.border,
                gap: Spacing.sm,
              }}
            >
              <Text style={{ fontWeight: "700", fontSize: 18 }}>{t("account.bizCardTitle")}</Text>
              <Text style={{ opacity: 0.8, lineHeight: 20 }}>
                {t("account.bizSignInToContinue")}
              </Text>
              <SecondaryButton
                title={t("account.switchToConsumer")}
                onPress={async () => {
                  await setTabMode("customer");
                  router.replace("/(tabs)");
                }}
              />
            </View>
          </View>
        ) : (
        <ScrollView
          style={{ marginTop: Spacing.lg, flex: 1 }}
          contentContainerStyle={{ gap: Spacing.md, paddingBottom: scrollBottom }}
          {...FORM_SCROLL_KEYBOARD_PROPS}
          showsVerticalScrollIndicator={false}
        >
        <View style={{ gap: Spacing.md }}>
          <View>
            <Text>{t("auth.email")}</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                borderRadius: 10,
                padding: 12,
                marginTop: 6,
              }}
            />
          </View>

          <View>
            <Text>{t("auth.password")}</Text>
            <TextInput
              value={pw}
              onChangeText={setPw}
              secureTextEntry
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                borderRadius: 10,
                padding: 12,
                marginTop: 6,
              }}
            />
          </View>

          <Pressable
            onPress={() => {
              logAuthPath("forgot_password");
              router.push("/forgot-password" as Href);
            }}
            style={{ alignSelf: "flex-start", paddingVertical: 4 }}
          >
            <Text style={{ fontSize: 15, fontWeight: "600", color: "#2563eb" }}>{t("passwordRecovery.forgotLink")}</Text>
          </Pressable>

          <PrimaryButton title={busy ? t("auth.loggingIn") : t("auth.logIn")} onPress={() => void signIn()} disabled={busy} />
          <SecondaryButton title={t("auth.createAccountCta")} onPress={() => void signUp()} disabled={busy} />
          {isDemoAuthHelperEnabled() ? (
            <SecondaryButton
              title={busy ? t("auth.loggingIn") : t("auth.demoLogin")}
              onPress={() => void demoLoginFromAccount()}
              disabled={busy}
              style={{
                backgroundColor: busy ? "#e5e7eb" : "#eef2ff",
                borderWidth: 1,
                borderColor: busy ? "#d4d4d8" : "#6366f1",
              }}
            />
          ) : null}
          <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
            <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.68 }}>{t("legal.authFooterHint")}</Text>
            <LegalExternalLinks />
          </View>
        </View>
        </ScrollView>
        )
      ) : (
        <ScrollView
          style={{ marginTop: Spacing.lg, flex: 1 }}
          contentContainerStyle={{ gap: Spacing.md, paddingBottom: scrollBottom }}
          {...FORM_SCROLL_KEYBOARD_PROPS}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              flexDirection: "row",
              borderRadius: Radii.pill,
              backgroundColor: theme.surfaceMuted,
              padding: 4,
              gap: 4,
            }}
          >
            <Pressable
              onPress={async () => {
                await setTabMode("customer");
                router.replace("/(tabs)");
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: tabMode === "customer" }}
              style={{
                flex: 1,
                paddingVertical: Spacing.sm + 2,
                borderRadius: Radii.md,
                backgroundColor: tabMode === "customer" ? theme.primary : "transparent",
              }}
            >
              <Text
                style={{
                  textAlign: "center",
                  fontWeight: "800",
                  fontSize: 14,
                  color: tabMode === "customer" ? theme.primaryText : theme.text,
                }}
              >
                {t("tabMode.customer")}
              </Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                await setTabMode("business");
                router.replace("/(tabs)/create");
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: tabMode === "business" }}
              style={{
                flex: 1,
                paddingVertical: Spacing.sm + 2,
                borderRadius: Radii.md,
                backgroundColor: tabMode === "business" ? theme.primary : "transparent",
              }}
            >
              <Text
                style={{
                  textAlign: "center",
                  fontWeight: "800",
                  fontSize: 14,
                  color: tabMode === "business" ? theme.primaryText : theme.text,
                }}
              >
                {t("tabMode.business")}
              </Text>
            </Pressable>
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: Radii.lg,
              padding: Spacing.md,
            }}
          >
            <Text style={{ opacity: 0.7, fontSize: 13 }}>{t("account.loggedInAsLabel")}</Text>
            <Text style={{ fontWeight: "700", marginTop: 4, color: theme.text }}>{sessionEmail}</Text>
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: Radii.lg,
              padding: Spacing.md,
              gap: Spacing.sm,
            }}
          >
            <Text style={{ fontWeight: "700", fontSize: 17, color: theme.text }}>{t("account.sessionSectionTitle")}</Text>
            <SecondaryButton title={t("account.logOut")} onPress={confirmLogout} disabled={busy || loading} />
          </View>

          {tabMode === "business" ? (
            <View
              style={{
                borderRadius: Radii.lg,
                padding: Spacing.md,
                backgroundColor: theme.surface,
                borderWidth: 1,
                borderColor: theme.border,
                gap: Spacing.sm,
              }}
            >
              <Text style={{ fontWeight: "700", fontSize: 18, color: theme.text }}>{t("account.bizCardTitle")}</Text>
              {businessProfileCheckLoading ? (
                <Text style={{ opacity: 0.7, color: theme.text }}>{t("createHub.loading")}</Text>
              ) : (
                <>
                  <Text style={{ opacity: 0.8, lineHeight: 20, color: theme.text }}>
                    {businessProfileSnapshot?.name ?? businessName ?? t("account.bizYourBusiness")}
                  </Text>
                  <Text style={{ opacity: 0.7, lineHeight: 20, color: theme.text }}>
                    {businessProfileSnapshot?.address ?? t("account.bizNoAddress")}
                  </Text>
                  {businessProfileSnapshot?.category ? (
                    <Text style={{ opacity: 0.7, lineHeight: 20, color: theme.text }}>
                      {t("account.bizCategory")}: {businessProfileSnapshot.category}
                    </Text>
                  ) : null}
                  <Text style={{ opacity: 0.75, lineHeight: 20, color: theme.text }}>
                    {businessSetupMessage ?? t("account.bizSetupComplete")}
                  </Text>
                  <PrimaryButton title={t("account.createNewDeal")} onPress={goToCreateDeal} />
                  {!businessProfileComplete ? (
                    <SecondaryButton title={t("account.startBusinessSetup")} onPress={goToBusinessSetup} />
                  ) : (
                    <Pressable onPress={goToBusinessSetup} style={{ paddingVertical: Spacing.sm, alignItems: "center" }}>
                      <Text style={{ color: theme.primary, fontWeight: "700", fontSize: 15 }}>{t("account.editProfile")}</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={async () => {
                      await setTabMode("customer");
                      router.replace("/(tabs)");
                    }}
                    style={{ paddingVertical: Spacing.sm, alignItems: "center" }}
                  >
                    <Text style={{ color: theme.mutedText, fontWeight: "600", fontSize: 14 }}>{t("account.switchToConsumerShort")}</Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : null}

          {tabMode === "business" && businessId ? (
            <Pressable
              onPress={() => router.push("/(tabs)/billing" as Href)}
              accessibilityRole="button"
            >
              <CardShell variant="elevated">
                <Text style={{ fontWeight: "800", fontSize: 16, color: theme.text }}>{t("account.billingRowTitle")}</Text>
                <Text style={{ marginTop: 6, opacity: 0.7, fontSize: 14, lineHeight: 20, color: theme.text }}>
                  {t("account.billingRowSubtitle")}
                </Text>
                <Text style={{ marginTop: Spacing.sm, fontWeight: "800", fontSize: 14, color: theme.primary }}>
                  {t("billing.goToBilling", { defaultValue: "Go to Billing" })} →
                </Text>
              </CardShell>
            </Pressable>
          ) : null}

          <View
            style={{
              borderWidth: 1,
              borderColor: "#eee",
              borderRadius: 12,
              padding: 12,
              gap: 8,
            }}
          >
            <Text style={{ fontWeight: "700" }}>{t("language.sectionApp")}</Text>
            <Text style={{ opacity: 0.7, fontSize: 13, lineHeight: 18 }}>{t("language.sectionAppHelp")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
              {localeChip(t("language.english"), "en", i18n.language === "en", () => chooseAppLocale("en"))}
              {localeChip(t("language.spanish"), "es", i18n.language === "es", () => chooseAppLocale("es"))}
              {localeChip(t("language.korean"), "ko", i18n.language === "ko", () => chooseAppLocale("ko"))}
            </View>
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: Radii.lg,
              padding: Spacing.md,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <View>
              <Text style={{ fontWeight: "700" }}>{t("account.dealAlertsTitle")}</Text>
              <Text style={{ opacity: 0.7, marginTop: 4 }}>{t("account.dealAlertsSubtitle")}</Text>
            </View>
            <Switch value={alertsEnabled} onValueChange={toggleAlerts} disabled={alertsLoading} />
          </View>

          {businessId ? (
            <View
              style={{
                backgroundColor: "#fafafa",
                borderRadius: 12,
                padding: 12,
                borderWidth: 1,
                borderColor: "#eee",
                gap: 10,
              }}
            >
              <Text style={{ fontWeight: "700" }}>{t("language.sectionBusiness")}</Text>
              <Text style={{ opacity: 0.7, fontSize: 13, lineHeight: 18 }}>
                {t("language.sectionBusinessHelp")}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <Pressable
                  onPress={() => setProfilePreferredLocale(null)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    backgroundColor: profilePreferredLocale == null ? "#111" : "#e8e8e8",
                    marginRight: 8,
                    marginBottom: 8,
                  }}
                >
                  <Text
                    style={{
                      color: profilePreferredLocale == null ? "#fff" : "#111",
                      fontWeight: "600",
                      fontSize: 13,
                    }}
                  >
                    {t("language.useAppLanguage")}
                  </Text>
                </Pressable>
                {(["en", "es", "ko"] as const).map((loc) => (
                  <Pressable
                    key={loc}
                    onPress={() => setProfilePreferredLocale(loc)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 10,
                      backgroundColor: profilePreferredLocale === loc ? "#111" : "#e8e8e8",
                      marginRight: 8,
                      marginBottom: 8,
                    }}
                  >
                    <Text
                      style={{
                        color: profilePreferredLocale === loc ? "#fff" : "#111",
                        fontWeight: "600",
                        fontSize: 13,
                      }}
                    >
                      {loc === "en"
                        ? t("language.english")
                        : loc === "es"
                          ? t("language.spanish")
                          : t("language.korean")}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={{ fontWeight: "700", marginTop: 8 }}>{t("account.bizProfileHeader")}</Text>
              <Text style={{ opacity: 0.7, fontSize: 13, lineHeight: 18 }}>{t("account.bizProfileHelp")}</Text>
              <Pressable onPress={() => setBizProfileExpanded((v) => !v)} style={{ paddingVertical: Spacing.sm }}>
                <Text style={{ color: theme.primary, fontWeight: "800" }}>
                  {bizProfileExpanded ? t("account.collapseBizProfile") : t("account.expandBizProfile")}
                </Text>
              </Pressable>
              {bizProfileExpanded ? (
                <>
                  <View>
                    <Text style={{ fontSize: 13 }}>{t("account.fieldBusinessName")}</Text>
                <TextInput
                  value={profileBusinessName}
                  onChangeText={setProfileBusinessName}
                  placeholder={t("account.phBusinessName")}
                  autoCapitalize="words"
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldContactName")}</Text>
                <TextInput
                  value={profileContactName}
                  onChangeText={setProfileContactName}
                  placeholder={t("account.phContactName")}
                  autoCapitalize="words"
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldBusinessEmail")}</Text>
                <TextInput
                  value={profileBusinessEmail}
                  onChangeText={setProfileBusinessEmail}
                  placeholder={t("account.phBusinessEmail")}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldAddress")}</Text>
                <TextInput
                  value={profileAddress}
                  onChangeText={setProfileAddress}
                  placeholder={t("account.phAddress")}
                  autoCapitalize="words"
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldPhoneRequired")}</Text>
                <TextInput
                  value={profilePhone}
                  onChangeText={setProfilePhone}
                  placeholder={t("account.phPhone")}
                  keyboardType="phone-pad"
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldCategory")}</Text>
                <TextInput
                  value={profileCategory}
                  onChangeText={setProfileCategory}
                  placeholder={t("account.phCategory")}
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldHoursRequired")}</Text>
                <TextInput
                  value={profileHours}
                  onChangeText={setProfileHours}
                  placeholder={t("account.phHours")}
                  multiline
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                    minHeight: 56,
                    textAlignVertical: "top",
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldTone")}</Text>
                <TextInput
                  value={profileTone}
                  onChangeText={setProfileTone}
                  placeholder={t("account.phTone")}
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldLocation")}</Text>
                <TextInput
                  value={profileLocation}
                  onChangeText={setProfileLocation}
                  placeholder={t("account.phLocation")}
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldLatLng")}</Text>
                <Text style={{ opacity: 0.65, fontSize: 12, marginTop: 4, lineHeight: 16 }}>
                  {t("account.fieldLatLngHelp")}
                </Text>
                <TextInput
                  value={profileLatitude}
                  onChangeText={setProfileLatitude}
                  placeholder={t("account.phLat")}
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 6,
                  }}
                />
                <TextInput
                  value={profileLongitude}
                  onChangeText={setProfileLongitude}
                  placeholder={t("account.phLng")}
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 8,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldShortDescription")}</Text>
                <TextInput
                  value={profileShortDescription}
                  onChangeText={setProfileShortDescription}
                  placeholder={t("account.phShortDescription")}
                  multiline
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                    minHeight: 72,
                    textAlignVertical: "top",
                  }}
                />
              </View>
                  <PrimaryButton
                    title={savingProfile ? t("account.savingProfile") : t("account.saveBizProfile")}
                    onPress={saveBusinessProfile}
                    disabled={savingProfile}
                  />
                </>
              ) : null}
            </View>
          ) : null}

          {businessId ? (
            <PrimaryButton title={t("account.businessDashboard")} onPress={() => router.push("/(tabs)/dashboard")} />
          ) : (
            <View
              style={{
                backgroundColor: "#f8f8f8",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <Text style={{ fontWeight: "700" }}>{t("account.createBizCardTitle")}</Text>
              <Text style={{ marginTop: 6, opacity: 0.7 }}>{t("account.createBizCardBody")}</Text>
              <View style={{ marginTop: 10 }}>
                <PrimaryButton title={t("account.startBusinessSetup")} onPress={goToBusinessSetup} />
              </View>
            </View>
          )}

          <Pressable
            onPress={() => setAdvancedOpen((v) => !v)}
            style={{ paddingVertical: Spacing.sm, alignSelf: "flex-start" }}
          >
            <Text style={{ fontWeight: "800", color: theme.primary, fontSize: 15 }}>
              {advancedOpen ? "− " : "+ "}
              {t("account.advancedOptions")}
            </Text>
          </Pressable>

          {advancedOpen ? (
            <>
          <View
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: Radii.lg,
              padding: Spacing.md,
              gap: Spacing.sm,
            }}
          >
            <Text style={{ fontWeight: "700", color: theme.text }}>{t("legal.sectionTitle")}</Text>
            <LegalExternalLinks />
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: blockInAppSelfDelete ? "#e5e5e5" : "#f3d4d4",
              borderRadius: Radii.lg,
              padding: Spacing.md,
              gap: Spacing.sm,
              backgroundColor: blockInAppSelfDelete ? "#fafafa" : "#fffafa",
            }}
          >
            <Text
              style={{
                fontWeight: "700",
                color: blockInAppSelfDelete ? "#444" : "#7f1d1d",
              }}
            >
              {t("deleteAccount.sectionTitle")}
            </Text>
            {blockInAppSelfDelete ? (
              <>
                <Text style={{ fontSize: 14, lineHeight: 20, opacity: 0.88, color: "#333" }}>
                  {businessId
                    ? t("deleteAccount.businessOwnerBlockedBody")
                    : t("deleteAccount.ownershipAmbiguousBlockedBody")}
                </Text>
                <Pressable
                  onPress={() => void openWebsiteUrl(SUPPORT_URL)}
                  style={{ alignSelf: "flex-start", paddingVertical: 4 }}
                >
                  <Text style={{ fontSize: 14, fontWeight: "600", color: "#2563eb" }}>
                    {t("deleteAccount.contactSupportCta")}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 14, lineHeight: 20, opacity: 0.85, color: "#444" }}>
                  {t("deleteAccount.sectionBodyConsumer")}
                </Text>
                <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.75, color: "#444" }}>
                  {t("deleteAccount.fallbackWebHint")}
                </Text>
                <Pressable
                  onPress={() => void openWebsiteUrl(DELETE_ACCOUNT_URL)}
                  style={{ alignSelf: "flex-start", paddingVertical: 4 }}
                >
                  <Text style={{ fontSize: 14, fontWeight: "600", color: "#2563eb" }}>
                    {t("legal.deleteAccount")}
                  </Text>
                </Pressable>
                <PrimaryButton
                  title={t("deleteAccount.cta")}
                  onPress={confirmDeleteAccount}
                  disabled={busy || loading}
                  style={{ backgroundColor: "#b91c1c" }}
                />
              </>
            )}
          </View>
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
    </KeyboardScreen>
  );
}
