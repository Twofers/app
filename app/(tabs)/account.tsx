import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, Text, TextInput, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { useRouter, type Href } from "expo-router";
import { requestNotificationPermissionsSafe } from "@/lib/expo-notifications-support";
import { BrandedSwitch } from "@/components/ui/branded-switch";
import {
  PUSH_TOKEN_REGISTRATION_RETRY_MESSAGE,
  registerPushTokenWithResult,
} from "@/lib/push-token";
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
import { clearCachedRole, useTabMode } from "../../lib/tab-mode";
import { LegalExternalLinks } from "../../components/legal-external-links";
import { DELETE_ACCOUNT_BLOCKED_BUSINESS_OWNER, deleteUserAccount } from "../../lib/functions";
import { DELETE_ACCOUNT_URL, SUPPORT_URL, openWebsiteUrl } from "../../lib/legal-urls";
import { translateKnownApiMessage } from "../../lib/i18n/api-messages";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { Colors, Radii } from "@/constants/theme";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getBusinessProfileAccessForCurrentUser } from "@/lib/business-profile-access";
import { signOutAndRedirectToAuthLanding } from "@/lib/auth-app-sign-out";
import { PAID_BILLING_ENABLED } from "@/lib/billing/access";
import { useBrandedConfirm } from "@/hooks/use-branded-confirm";
import { calculateProfileCompleteness } from "@/lib/business-profile-completeness";
import { validateBusinessProfileSaveDraft } from "@/lib/business-profile-save";
import { ProfileCompletenessBar } from "@/components/profile-completeness-bar";
import { aiGenerateDealCopy, aiBusinessLookup, aiBusinessLookupDetails, type BusinessLookupResult } from "@/lib/functions";
import { isVerifiedBusinessLookupResult } from "@/lib/business-lookup";
import { getSupportEmail } from "@/lib/support-contact";

export default function AccountScreen() {
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const { mode: tabMode } = useTabMode();
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
  const deleteMayIncludeBusinessData = Boolean(businessId || businessOwnershipAmbiguous);
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
  const [businessProfileSnapshot, setBusinessProfileSnapshot] = useState<{
    name: string | null;
    address: string | null;
    category: string | null;
  } | null>(null);
  const [bizProfileExpanded, setBizProfileExpanded] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [lookupSearching, setLookupSearching] = useState(false);
  const [lookupDetailsPlaceId, setLookupDetailsPlaceId] = useState<string | null>(null);
  const [lookupResults, setLookupResults] = useState<BusinessLookupResult[] | null>(null);
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const { confirm, confirmModal } = useBrandedConfirm();
  const supportEmail = getSupportEmail();
  const visibleBusinessContactName = businessProfile?.contact_name?.trim() || null;
  const visibleBusinessEmail = businessProfile?.business_email?.trim() || null;

  const completeness = useMemo(
    () => calculateProfileCompleteness(businessProfile),
    [businessProfile],
  );

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
        // Business setup state is derived from access.isComplete / access.hasProfileRow;
        // no separate message state needed.
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
      const registration = await registerPushTokenWithResult(userId);
      if (!registration.ok) {
        setBanner({
          message: t("settingsScreen.alertsRegistrationFailed", {
            defaultValue: PUSH_TOKEN_REGISTRATION_RETRY_MESSAGE,
          }),
          tone: "error",
        });
        return;
      }
    }
    await setAlertsEnabled(next);
    setAlertsEnabledState(next);
    setBanner({ message: next ? t("account.alertsOn") : t("account.alertsOff"), tone: "success" });
  }

  async function performSignOut() {
    setBusy(true);
    setBanner(null);
    try {
      const result = await signOutAndRedirectToAuthLanding({
        userId,
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
    confirm({
      iconName: "logout",
      title: t("account.logoutConfirmTitle"),
      message: t("account.logoutConfirmBody"),
      confirmLabel: t("account.logoutConfirmCta"),
      onConfirm: () => void performSignOut(),
      cancelLabel: t("commonUi.cancel"),
    });
  }

  function confirmDeleteAccount() {
    // Owners see the explicit cascade warning ("…your business, its deals, and
    // claim history will also be removed"). Consumers see the simpler copy.
    // Apple/Google both require the dialog to make the cascade consequences
    // clear before destruction; the deleteAccount.body string already does that.
    const message = deleteMayIncludeBusinessData
      ? t("deleteAccount.body")
      : t("deleteAccount.bodyConsumer");
    confirm({
      iconName: "delete-forever",
      title: t("deleteAccount.title"),
      message,
      confirmLabel: t("deleteAccount.confirmDestructive"),
      onConfirm: () => void runDeleteAccount(),
      cancelLabel: t("commonUi.cancel"),
    });
  }

  async function runDeleteAccount() {
    setBusy(true);
    setBanner(null);
    try {
      await deleteUserAccount();
      await supabase.auth.signOut();
      await clearCachedRole();
      router.replace("/auth-landing" as Href);
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : undefined;
      if (code === DELETE_ACCOUNT_BLOCKED_BUSINESS_OWNER) {
        setBanner({ message: t("deleteAccount.businessOwnerBlockedShort"), tone: "info" });
        confirm({
          iconName: "info-outline",
          title: t("deleteAccount.businessOwnerBlockedTitle"),
          message: t("deleteAccount.businessOwnerBlockedBody"),
          confirmLabel: t("deleteAccount.contactSupportCta"),
          onConfirm: () => void openWebsiteUrl(SUPPORT_URL),
          cancelLabel: t("deleteAccount.alertDismiss"),
        });
        return;
      }
      // Don't surface raw Postgres / RLS / network errors in a top-of-screen banner
      // during a sensitive flow. Pass through translateKnownApiMessage so technical
      // messages get a localized friendly equivalent; fall back to the generic copy.
      const raw = e instanceof Error ? e.message : "";
      const msg = raw ? translateKnownApiMessage(raw, t) : t("deleteAccount.errFailed");
      setBanner({ message: msg, tone: "error" });
      confirm({
        iconName: "error-outline",
        title: t("deleteAccount.errFailed"),
        message: t("deleteAccount.fallbackWebBody"),
        confirmLabel: t("deleteAccount.openWebsiteFallbackCta"),
        onConfirm: () => void openWebsiteUrl(DELETE_ACCOUNT_URL),
        cancelLabel: t("deleteAccount.alertDismiss"),
      });
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

  async function generateAiDescription() {
    if (!businessId || generatingDescription) return;
    const name = profileBusinessName.trim();
    const cat = profileCategory.trim();
    if (!name || !cat) {
      setBanner({ message: t("account.aiDescNeedsNameCategory"), tone: "error" });
      return;
    }
    setGeneratingDescription(true);
    setBanner(null);
    try {
      const result = await aiGenerateDealCopy({
        hint_text: `Write a 1-2 sentence description for a ${cat} called "${name}". Focus on what makes it appealing to local customers.`,
        business_name: name,
        business_id: businessId,
      });
      setProfileShortDescription(result.description);
      setBanner({ message: t("account.aiDescGenerated"), tone: "success" });
    } catch (err) {
      if (__DEV__) console.warn("[account] AI description error:", err);
      setBanner({ message: t("account.aiDescFailed"), tone: "error" });
    } finally {
      setGeneratingDescription(false);
    }
  }

  async function lookupBusinessProfileByName() {
    const name = profileBusinessName.trim();
    if (!name) {
      setBanner({ message: t("businessSetup.errEnterName"), tone: "error" });
      return;
    }
    setLookupSearching(true);
    setLookupResults(null);
    setBanner(null);
    try {
      const results = await aiBusinessLookup({ business_name: name });
      if (results.length === 0) setBanner({ message: t("businessSetup.noResults"), tone: "info" });
      setLookupResults(results.length > 0 ? results : null);
    } catch (err) {
      if (__DEV__) console.warn("[account] Business lookup error:", err);
      setBanner({ message: t("businessSetup.lookupError"), tone: "error" });
    } finally {
      setLookupSearching(false);
    }
  }

  async function applyBusinessLookupResult(result: BusinessLookupResult) {
    if (lookupDetailsPlaceId !== null) return;
    if (!isVerifiedBusinessLookupResult(result)) {
      setBanner({ message: t("businessSetup.unverifiedResult"), tone: "info" });
      return;
    }

    setLookupDetailsPlaceId(result.place_id);
    setBanner(null);
    try {
      const details = await aiBusinessLookupDetails({ place_id: result.place_id });
      if (!isVerifiedBusinessLookupResult(details)) {
        setBanner({ message: t("businessSetup.unverifiedResult"), tone: "info" });
        return;
      }

      setProfileBusinessName(details.name);
      setProfileAddress(details.formatted_address);
      setProfileLocation(details.formatted_address);
      setProfilePhone(details.phone);
      if (details.category) setProfileCategory(details.category);
      if (details.hours_text) setProfileHours(details.hours_text);
      setProfileLatitude(details.lat != null ? String(details.lat) : "");
      setProfileLongitude(details.lng != null ? String(details.lng) : "");
      setLookupResults(null);
      setBanner({ message: t("businessSetup.infoFilled"), tone: "success" });
    } catch (err) {
      if (__DEV__) console.warn("[account] Place details error:", err);
      setBanner({ message: t("businessSetup.lookupDetailsError"), tone: "error" });
    } finally {
      setLookupDetailsPlaceId(null);
    }
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
      const profileValidation = validateBusinessProfileSaveDraft({
        name: profileBusinessName,
        contactName: profileContactName,
        businessEmail: profileBusinessEmail,
        phone: profilePhone,
        address: profileAddress,
        category: profileCategory,
        hours: profileHours,
      });
      if (!profileValidation.ok) {
        setBanner({
          message:
            profileValidation.reason === "email"
              ? t("account.errBizEmailInvalid")
              : t("account.errBizNameAddress"),
          tone: "error",
        });
        return;
      }
      const {
        name: nm,
        contactName: cn,
        businessEmail: em,
        phone: ph,
        address: ad,
        category: cat,
        hours: hrs,
      } = profileValidation.values;
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
      // Raw Postgres / RLS errors don't help an owner who's editing their business
      // profile (RLS denials, JWT expired, constraint violations). Route through
      // the api-messages translator; fall back to the generic save-failed copy.
      const raw = e instanceof Error ? e.message : "";
      setBanner({
        message: raw ? translateKnownApiMessage(raw, t) : t("account.errSaveProfileFailed"),
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
          backgroundColor: active ? "rgba(255,159,28,0.16)" : theme.surfaceMuted,
          borderWidth: 1,
          borderColor: active ? "rgba(255,159,28,0.4)" : theme.border,
          marginRight: Spacing.sm,
          marginBottom: Spacing.sm,
          maxWidth: "100%",
        }}
      >
        <Text
          style={{ color: active ? theme.primary : theme.text, fontWeight: "700", fontSize: 13 }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          maxFontSizeMultiplier={1.15}
        >
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <KeyboardScreen>
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title={t("account.title")} />
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {!isLoggedIn ? (
        // Hard role split: auth-landing is the only sign-in/sign-up surface.
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
              title={t("auth.logIn")}
              onPress={() => {
                router.replace("/auth-landing" as Href);
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

          <View
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: Radii.lg,
              padding: Spacing.md,
              gap: Spacing.sm,
            }}
          >
            <Text style={{ fontWeight: "700", fontSize: 17, color: theme.text }}>{t("supportContact.sectionTitle")}</Text>
            <Text style={{ opacity: 0.7, color: theme.text, fontSize: 14, lineHeight: 20 }}>
              {t("supportContact.sectionHelp")}
            </Text>
            <SecondaryButton
              title={t("supportContact.contactSupportCta")}
              onPress={() => void Linking.openURL(`mailto:${supportEmail}`)}
              accessibilityLabel={t("supportContact.emailA11y")}
            />
            <Text style={{ color: theme.accentText, fontWeight: "700", fontSize: 15 }}>{supportEmail}</Text>
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
                  {visibleBusinessContactName ? (
                    <Text style={{ opacity: 0.7, lineHeight: 20, color: theme.text }}>
                      {t("account.fieldContactName")}: {visibleBusinessContactName}
                    </Text>
                  ) : null}
                  {visibleBusinessEmail ? (
                    <Text style={{ opacity: 0.7, lineHeight: 20, color: theme.text }}>
                      {t("account.fieldBusinessEmail")}: {visibleBusinessEmail}
                    </Text>
                  ) : null}
                  <ProfileCompletenessBar
                    percentage={completeness.percentage}
                    hint={completeness.nextHint ? t(completeness.nextHint) : null}
                  />
                  {!businessProfileComplete ? (
                    <SecondaryButton title={t("account.startBusinessSetup")} onPress={goToBusinessSetup} />
                  ) : (
                    <Pressable onPress={goToBusinessSetup} style={{ paddingVertical: Spacing.sm, alignItems: "center" }}>
                      <Text style={{ color: theme.accentText, fontWeight: "700", fontSize: 15 }}>{t("account.editProfile")}</Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          ) : null}

          {PAID_BILLING_ENABLED && tabMode === "business" && businessId ? (
            <Pressable
              onPress={() => router.push("/(tabs)/billing" as Href)}
              accessibilityRole="button"
            >
              <CardShell variant="elevated">
                <Text style={{ fontWeight: "800", fontSize: 16, color: theme.text }}>{t("account.billingRowTitle")}</Text>
                <Text style={{ marginTop: 6, opacity: 0.7, fontSize: 14, lineHeight: 20, color: theme.text }}>
                  {t("account.billingRowSubtitle")}
                </Text>
                <Text style={{ marginTop: Spacing.sm, fontWeight: "800", fontSize: 14, color: theme.accentText }}>
                  {t("billing.goToBilling", { defaultValue: "Go to Billing" })} →
                </Text>
              </CardShell>
            </Pressable>
          ) : null}

          <View
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: Radii.lg,
              padding: Spacing.md,
              gap: Spacing.sm,
            }}
          >
            <Text style={{ fontWeight: "700", color: theme.text }}>{t("language.sectionApp")}</Text>
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
            <BrandedSwitch value={alertsEnabled} onValueChange={toggleAlerts} disabled={alertsLoading} />
          </View>

          {businessId ? (
            <View
              style={{
                backgroundColor: theme.surface,
                borderRadius: Radii.lg,
                padding: Spacing.md,
                borderWidth: 1,
                borderColor: theme.border,
                gap: Spacing.sm,
              }}
            >
              <Text style={{ fontWeight: "700" }}>{t("language.sectionBusiness")}</Text>
              <Text style={{ opacity: 0.7, fontSize: 13, lineHeight: 18 }}>
                {t("language.sectionBusinessHelp")}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <Pressable
                  onPress={() => setProfilePreferredLocale(null)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityLabel={t("language.useAppLanguage")}
                  accessibilityRole="button"
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    backgroundColor: profilePreferredLocale == null ? theme.text : theme.surfaceMuted,
                    marginRight: 8,
                    marginBottom: 8,
                  }}
                >
                  <Text
                    style={{
                      color: profilePreferredLocale == null ? theme.background : theme.text,
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
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityLabel={loc === "en" ? t("language.english") : loc === "es" ? t("language.spanish") : t("language.korean")}
                    accessibilityRole="button"
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 10,
                      backgroundColor: profilePreferredLocale === loc ? theme.text : theme.surfaceMuted,
                      marginRight: 8,
                      marginBottom: 8,
                    }}
                  >
                    <Text
                      style={{
                        color: profilePreferredLocale === loc ? theme.background : theme.text,
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
                <Text style={{ color: theme.accentText, fontWeight: "800" }}>
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
                  editable={!savingProfile}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                    backgroundColor: savingProfile ? theme.surfaceMuted : undefined,
                  }}
                />
              </View>

              <SecondaryButton
                title={lookupSearching ? t("businessSetup.searching") : t("businessSetup.lookupButton")}
                onPress={() => void lookupBusinessProfileByName()}
                disabled={lookupSearching || lookupDetailsPlaceId !== null || !profileBusinessName.trim()}
              />

              {lookupResults && lookupResults.length > 0 && (
                <View style={{ gap: Spacing.sm }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", opacity: 0.6 }}>
                    {t("businessSetup.selectResult")}
                  </Text>
                  {lookupResults.map((r, i) => (
                    <Pressable
                      key={r.place_id || i}
                      onPress={() => void applyBusinessLookupResult(r)}
                    >
                      <View
                        style={{
                          backgroundColor: theme.surface,
                          borderRadius: Radii.lg,
                          padding: Spacing.md,
                          borderWidth: 1,
                          borderColor: theme.border,
                        }}
                      >
                        <Text style={{ fontWeight: "700", fontSize: 15, color: theme.text }}>{r.name}</Text>
                        <Text style={{ fontSize: 13, opacity: 0.7, marginTop: 2, color: theme.text }}>{r.formatted_address}</Text>
                        {r.phone ? <Text style={{ fontSize: 13, opacity: 0.6, marginTop: 2, color: theme.text }}>{r.phone}</Text> : null}
                        <Text style={{ fontSize: 11, color: Colors.light.accentText, marginTop: 4 }}>
                          {t("businessSetup.verifiedSource")}
                        </Text>
                        {lookupDetailsPlaceId === r.place_id ? (
                          <ActivityIndicator color={Colors.light.primary} style={{ marginTop: Spacing.xs }} />
                        ) : null}
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}

              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldContactName")}</Text>
                <TextInput
                  value={profileContactName}
                  onChangeText={setProfileContactName}
                  placeholder={t("account.phContactName")}
                  autoCapitalize="words"
                  editable={!savingProfile}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                    backgroundColor: savingProfile ? theme.surfaceMuted : undefined,
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
                  autoCorrect={false}
                  textContentType="emailAddress"
                  autoComplete="email"
                  editable={!savingProfile}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                    backgroundColor: savingProfile ? theme.surfaceMuted : undefined,
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
                  editable={!savingProfile}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                    backgroundColor: savingProfile ? theme.surfaceMuted : undefined,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldPhone")}</Text>
                <TextInput
                  value={profilePhone}
                  onChangeText={setProfilePhone}
                  placeholder={t("account.phPhone")}
                  keyboardType="phone-pad"
                  editable={!savingProfile}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                    backgroundColor: savingProfile ? theme.surfaceMuted : undefined,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldCategory")}</Text>
                <TextInput
                  value={profileCategory}
                  onChangeText={setProfileCategory}
                  placeholder={t("account.phCategory")}
                  editable={!savingProfile}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                    backgroundColor: savingProfile ? theme.surfaceMuted : undefined,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldHours")}</Text>
                <TextInput
                  value={profileHours}
                  onChangeText={setProfileHours}
                  placeholder={t("account.phHours")}
                  multiline
                  editable={!savingProfile}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                    minHeight: 56,
                    textAlignVertical: "top",
                    backgroundColor: savingProfile ? theme.surfaceMuted : undefined,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldTone")}</Text>
                <TextInput
                  value={profileTone}
                  onChangeText={setProfileTone}
                  placeholder={t("account.phTone")}
                  editable={!savingProfile}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                    backgroundColor: savingProfile ? theme.surfaceMuted : undefined,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldLocation")}</Text>
                <TextInput
                  value={profileLocation}
                  onChangeText={setProfileLocation}
                  placeholder={t("account.phLocation")}
                  editable={!savingProfile}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                    backgroundColor: savingProfile ? theme.surfaceMuted : undefined,
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
                  editable={!savingProfile}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 6,
                    backgroundColor: savingProfile ? theme.surfaceMuted : undefined,
                  }}
                />
                <TextInput
                  value={profileLongitude}
                  onChangeText={setProfileLongitude}
                  placeholder={t("account.phLng")}
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!savingProfile}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 8,
                    backgroundColor: savingProfile ? theme.surfaceMuted : undefined,
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
                  editable={!savingProfile}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                    minHeight: 72,
                    textAlignVertical: "top",
                    backgroundColor: savingProfile ? theme.surfaceMuted : undefined,
                  }}
                />
                <SecondaryButton
                  title={generatingDescription ? t("account.aiDescGenerating") : t("account.aiDescGenerate")}
                  onPress={() => void generateAiDescription()}
                  disabled={generatingDescription}
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
                backgroundColor: theme.surface,
                borderRadius: Radii.lg,
                padding: Spacing.md,
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
            <Text style={{ fontWeight: "800", color: theme.accentText, fontSize: 15 }}>
              {advancedOpen ? "− " : "+ "}
              {t("account.advancedOptions")}
            </Text>
          </Pressable>

          {advancedOpen ? (
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
          ) : null}

          <View
            style={{
              borderWidth: 1,
              borderColor: "#f3d4d4",
              borderRadius: Radii.lg,
              padding: Spacing.md,
              gap: Spacing.sm,
              backgroundColor: "#fffafa",
            }}
          >
            <Text
              style={{
                fontWeight: "700",
                color: "#7f1d1d",
              }}
            >
              {t("deleteAccount.sectionTitle")}
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 20, opacity: 0.85, color: "#444" }}>
              {deleteMayIncludeBusinessData ? t("deleteAccount.body") : t("deleteAccount.sectionBodyConsumer")}
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
          </View>
        </ScrollView>
      )}
      {confirmModal}
    </View>
    </KeyboardScreen>
  );
}
