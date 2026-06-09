import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { requestNotificationPermissionsSafe } from "@/lib/expo-notifications-support";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { BrandedSwitch } from "@/components/ui/branded-switch";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { getAlertsEnabled, setAlertsEnabled } from "@/lib/notifications";
import {
  CONSUMER_RADIUS_MILES_OPTIONS,
  type ConsumerLocationMode,
  type ConsumerNotificationMode,
  type ConsumerRadiusMiles,
  DEFAULT_RADIUS_MILES,
  getConsumerPreferences,
  setConsumerLocationMode,
  setConsumerNotificationPrefs,
  setConsumerRadiusMiles,
  setConsumerZipCode,
  setLastKnownConsumerCoords,
} from "@/lib/consumer-preferences";
import { resolveConsumerCoordinates } from "@/lib/consumer-location";
import { geocodeUsZip } from "@/lib/us-zip-geocode";
import { isValidUsZipFormat, normalizeUsZipInput, sanitizeUsZipInput, US_ZIP_MAX_LENGTH } from "@/lib/us-zip";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { updateConsumerProfileZip } from "@/lib/consumer-profile";
import { syncConsumerPrefsToServer } from "@/lib/sync-consumer-prefs";
import {
  PUSH_TOKEN_REGISTRATION_RETRY_MESSAGE,
  registerPushTokenWithResult,
} from "@/lib/push-token";
import type { AppLocale } from "@/lib/i18n/config";
import { setUiLocalePreference } from "@/lib/locale/ui-locale-storage";
import { PrimaryButton } from "@/components/ui/primary-button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  FORM_SCROLL_KEYBOARD_PROPS,
  IOS_DONE_INPUT_ACCESSORY_ID,
  IosDoneInputAccessory,
  KeyboardScreen,
} from "@/components/ui/keyboard-screen";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { isDebugPanelEnabled } from "@/lib/runtime-env";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useTabMode } from "@/lib/tab-mode";
import { signOutAndRedirectToAuthLanding } from "@/lib/auth-app-sign-out";
import { useBrandedConfirm } from "@/hooks/use-branded-confirm";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";
import { deleteUserAccount } from "@/lib/functions";
import { DELETE_ACCOUNT_URL, openWebsiteUrl } from "@/lib/legal-urls";
import { getSupportEmail, getSupportPhone } from "@/lib/support-contact";
import { supabase } from "@/lib/supabase";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { devWarn } from "@/lib/dev-log";

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { session } = useAuthSession();
  const { setMode: setTabMode } = useTabMode();
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const { confirm, confirmModal } = useBrandedConfirm();
  const [alertsEnabled, setAlertsEnabledState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [locationMode, setLocationModeState] = useState<ConsumerLocationMode>("gps");
  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState<ConsumerRadiusMiles>(DEFAULT_RADIUS_MILES);
  const [notifMode, setNotifModeState] = useState<ConsumerNotificationMode>("all_nearby");
  const [consumerSession, setConsumerSession] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [a, p] = await Promise.all([getAlertsEnabled(), getConsumerPreferences()]);
      setAlertsEnabledState(a);
      setLocationModeState(p.locationMode);
      setZip(sanitizeUsZipInput(p.zipCode));
      setRadius(p.radiusMiles);
      setNotifModeState(p.notificationPrefs.mode);
      setConsumerSession(!!session?.user);
    } catch (err: unknown) {
      devWarn("[settings] reload failed", err);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [session?.user]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function persistCoords(nextLocationMode: ConsumerLocationMode = locationMode) {
    const prefs = await getConsumerPreferences();
    const coords = await resolveConsumerCoordinates({ ...prefs, zipCode: zip, locationMode: nextLocationMode });
    if (coords) {
      await setLastKnownConsumerCoords(coords.lat, coords.lng);
    }
  }

  function showSettingsSaveError() {
    confirm({
      iconName: "error-outline",
      title: t("settingsScreen.saveErrorTitle", { defaultValue: "Couldn't save settings" }),
      message: t("settingsScreen.saveErrorBody", { defaultValue: "Check your connection and try again." }),
      confirmLabel: t("commonUi.ok"),
    });
  }

  function showPushRegistrationError() {
    confirm({
      iconName: "notifications-off",
      title: t("settingsScreen.alertsPermissionTitle"),
      message: t("settingsScreen.alertsRegistrationFailed", {
        defaultValue: PUSH_TOKEN_REGISTRATION_RETRY_MESSAGE,
      }),
      confirmLabel: t("commonUi.ok"),
    });
  }

  async function toggleAlerts(next: boolean) {
    try {
      if (next) {
        const { status, skippedBecauseExpoGo } = await requestNotificationPermissionsSafe();
        if (skippedBecauseExpoGo) {
          confirm({
            iconName: "notifications-off",
            title: t("settingsScreen.alertsPermissionTitle"),
            message: t("settingsScreen.alertsExpoGoBody"),
            confirmLabel: t("commonUi.ok"),
          });
          return;
        }
        if (status !== "granted") {
          confirm({
            iconName: "notifications-off",
            title: t("settingsScreen.alertsPermissionTitle"),
            message: t("settingsScreen.alertsPermissionBody"),
            confirmLabel: t("commonUi.ok"),
          });
          return;
        }
        const registration = await registerPushTokenWithResult(session?.user?.id ?? null);
        if (!registration.ok) {
          showPushRegistrationError();
          return;
        }
      }
      await setAlertsEnabled(next);
      setAlertsEnabledState(next);
    } catch (err: unknown) {
      devWarn("[settings] deal alerts update failed", err);
      showSettingsSaveError();
    }
  }

  async function applyLocationMode(mode: ConsumerLocationMode) {
    try {
      if (mode === "gps") {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          await setConsumerLocationMode("zip");
          setLocationModeState("zip");
          confirm({
            iconName: "location-off",
            title: t("consumerSettings.gpsErrorTitle"),
            message: t("consumerSettings.gpsErrorBody"),
            confirmLabel: t("commonUi.ok"),
          });
          await persistCoords("zip");
          return;
        }
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
            mayShowUserSettingsDialog: false,
          });
          const coords = pos?.coords;
          if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
            throw new Error("GPS lookup returned no usable coordinates");
          }
          await setLastKnownConsumerCoords(coords.latitude, coords.longitude);
        } catch (err: unknown) {
          devWarn("[settings] GPS lookup failed", err);
          await setConsumerLocationMode("zip");
          setLocationModeState("zip");
          confirm({
            iconName: "location-off",
            title: t("consumerSettings.gpsErrorTitle"),
            message: t("consumerSettings.gpsErrorBody"),
            confirmLabel: t("commonUi.ok"),
          });
          await persistCoords("zip");
          return;
        }
      }
      await setConsumerLocationMode(mode);
      setLocationModeState(mode);
      await persistCoords(mode);
    } catch (err: unknown) {
      devWarn("[settings] location mode update failed", err);
      showSettingsSaveError();
    }
  }

  async function saveZip() {
    const normalized = normalizeUsZipInput(zip);
    if (!normalized) {
      confirm({
        iconName: "error-outline",
        title: t("consumerSettings.zipSaveFailTitle"),
        message: t("consumerSettings.zipEmpty"),
        confirmLabel: t("commonUi.ok"),
      });
      return;
    }
    if (!isValidUsZipFormat(normalized)) {
      confirm({
        iconName: "error-outline",
        title: t("consumerSettings.zipSaveFailTitle"),
        message: t("consumerSettings.zipInvalid"),
        confirmLabel: t("commonUi.ok"),
      });
      return;
    }
    try {
      const geo = await geocodeUsZip(normalized);
      if (!geo.ok) {
        confirm({
          iconName: "error-outline",
          title: t("consumerSettings.zipSaveFailTitle"),
          message: geo.failure === "invalid_format" ? t("consumerSettings.zipInvalid") : t("consumerSettings.zipLookupFail"),
          confirmLabel: t("commonUi.ok"),
        });
        return;
      }
      setZip(normalized);
      await setConsumerZipCode(normalized);
      if (session?.user?.id) {
        await updateConsumerProfileZip(session.user.id, normalized);
      }
      await setLastKnownConsumerCoords(geo.lat, geo.lng);
    } catch (err: unknown) {
      devWarn("[settings] ZIP save failed", err);
      confirm({
        iconName: "error-outline",
        title: t("consumerSettings.zipSaveFailTitle"),
        message: t("consumerSettings.zipLookupFail"),
        confirmLabel: t("commonUi.ok"),
      });
    }
  }

  async function applyRadius(m: ConsumerRadiusMiles) {
    const previous = radius;
    setRadius(m);
    try {
      await setConsumerRadiusMiles(m);
      void syncConsumerPrefsToServer(session?.user?.id ?? null);
    } catch (err: unknown) {
      devWarn("[settings] radius update failed", err);
      setRadius(previous);
      showSettingsSaveError();
    }
  }

  async function applyNotifMode(m: ConsumerNotificationMode) {
    const previous = notifMode;
    setNotifModeState(m);
    try {
      await setConsumerNotificationPrefs({ v: 1, mode: m });
      void syncConsumerPrefsToServer(session?.user?.id ?? null);
    } catch (err: unknown) {
      devWarn("[settings] notification mode update failed", err);
      setNotifModeState(previous);
      showSettingsSaveError();
    }
  }

  async function chooseAppLocale(locale: AppLocale) {
    try {
      await setUiLocalePreference(locale, { manual: true });
      await i18n.changeLanguage(locale);
    } catch (err: unknown) {
      devWarn("[settings] locale update failed", err);
      showSettingsSaveError();
    }
  }

  async function performSignOut() {
    setLogoutBusy(true);
    try {
      const result = await signOutAndRedirectToAuthLanding({
        userId: session?.user?.id,
        setTabMode,
        replace: router.replace,
      });
      if (!result.ok) {
        // result.message can come straight from supabase.auth.signOut() — translate
        // through the api-messages layer so JWT/network errors render as friendly text.
        confirm({
          iconName: "error-outline",
          title: t("account.errLogoutFailed"),
          message: translateKnownApiMessage(result.message, t),
          confirmLabel: t("commonUi.ok"),
        });
      }
    } catch (err: unknown) {
      devWarn("[settings] logout failed", err);
      confirm({
        iconName: "error-outline",
        title: t("account.errLogoutFailed"),
        message: t("settingsScreen.saveErrorBody", { defaultValue: "Check your connection and try again." }),
        confirmLabel: t("commonUi.ok"),
      });
    } finally {
      setLogoutBusy(false);
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

  async function performDeleteAccount() {
    setDeleteBusy(true);
    try {
      await deleteUserAccount();
      await supabase.auth.signOut();
      await setTabMode("customer");
      router.replace("/auth-landing" as Href);
    } catch (err: unknown) {
      devWarn("[settings] delete account failed", err);
      const raw = err instanceof Error ? err.message : "";
      const friendly = raw ? translateKnownApiMessage(raw, t) : "";
      confirm({
        iconName: "error-outline",
        title: t("deleteAccount.errFailed"),
        message: friendly && friendly !== raw ? friendly : t("deleteAccount.fallbackWebBody"),
        confirmLabel: t("deleteAccount.openWebsiteFallbackCta"),
        onConfirm: () => void openWebsiteUrl(DELETE_ACCOUNT_URL),
        cancelLabel: t("deleteAccount.alertDismiss"),
      });
    } finally {
      setDeleteBusy(false);
    }
  }

  function confirmDeleteAccount() {
    confirm({
      iconName: "delete-forever",
      title: t("deleteAccount.title"),
      message: t("deleteAccount.bodyConsumer"),
      confirmLabel: t("deleteAccount.confirmDestructive"),
      onConfirm: () => void performDeleteAccount(),
      cancelLabel: t("commonUi.cancel"),
    });
  }

  // FIX: Added key parameter to fix React "unique key" warning on radius pills
  function chip(active: boolean, label: string, onPress: () => void, key?: string) {
    return (
      <Pressable
        key={key}
        onPress={onPress}
        style={{
          paddingVertical: Spacing.sm,
          paddingHorizontal: Spacing.md,
          borderRadius: Radii.md,
          backgroundColor: active ? theme.text : theme.surfaceMuted,
          marginRight: Spacing.sm,
          marginBottom: Spacing.sm,
          maxWidth: "100%",
        }}
      >
        <Text
          style={{ fontWeight: "700", color: active ? theme.background : theme.text }}
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
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text
        style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.78}
        maxFontSizeMultiplier={1.15}
      >
        {t("settingsScreen.title")}
      </Text>

      <ScrollView
        style={{ flex: 1, marginTop: Spacing.lg }}
        contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.lg }}
        showsVerticalScrollIndicator={false}
        {...FORM_SCROLL_KEYBOARD_PROPS}
      >
        {loading ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: Radii.lg,
              padding: Spacing.xxl,
              alignItems: "center",
              gap: Spacing.md,
              backgroundColor: theme.surface,
            }}
          >
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16 }}>
              {t("settingsScreen.loading", { defaultValue: "Loading settings..." })}
            </Text>
          </View>
        ) : loadFailed ? (
          <EmptyState
            title={t("settingsScreen.loadErrorTitle", { defaultValue: "Couldn't load settings" })}
            message={t("settingsScreen.loadErrorBody", { defaultValue: "Check your connection and try again." })}
            actionLabel={t("commonUi.tryAgain")}
            onAction={() => void reload()}
          />
        ) : (
        <>
        {consumerSession ? (
          <Pressable
            onPress={() => router.push("/consumer-profile-setup?edit=1" as Href)}
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: Radii.lg,
              padding: Spacing.lg,
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 17 }}>{t("settingsConsumer.editTitle")}</Text>
            <Text style={{ opacity: 0.7, marginTop: Spacing.xs, fontSize: 14, lineHeight: 20 }}>
              {t("settingsConsumer.editSub")}
            </Text>
          </Pressable>
        ) : null}

        <View
          style={{
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: Radii.lg,
            padding: Spacing.lg,
            gap: Spacing.md,
          }}
        >
          <Text style={{ fontWeight: "800", fontSize: 17 }}>{t("consumerSettings.locationSection")}</Text>
          <Text style={{ opacity: 0.7, fontSize: 14, lineHeight: 20 }}>{t("consumerSettings.locationHelp")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {chip(locationMode === "gps", t("consumerSettings.locationGps"), () => void applyLocationMode("gps"))}
            {chip(locationMode === "zip", t("consumerSettings.locationZip"), () => void applyLocationMode("zip"))}
          </View>
          {locationMode === "zip" ? (
            <View>
              <Text style={{ fontWeight: "600", marginBottom: Spacing.xs }}>{t("consumerSettings.zipLabel")}</Text>
              <TextInput
                value={zip}
                onChangeText={(value) => setZip(sanitizeUsZipInput(value))}
                placeholder={t("onboarding.zipPlaceholder")}
                autoCapitalize="none"
                autoComplete="postal-code"
                autoCorrect={false}
                inputAccessoryViewID={IOS_DONE_INPUT_ACCESSORY_ID}
                keyboardType="number-pad"
                maxLength={US_ZIP_MAX_LENGTH}
                placeholderTextColor={theme.mutedText}
                returnKeyType="done"
                textContentType="postalCode"
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: Radii.md,
                  padding: Spacing.md,
                  fontSize: 16,
                }}
              />
              <IosDoneInputAccessory />
              <View style={{ marginTop: Spacing.sm }}>
                <PrimaryButton title={t("consumerSettings.saveZip")} onPress={() => void saveZip()} />
              </View>
            </View>
          ) : null}
        </View>

        <View
          style={{
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: Radii.lg,
            padding: Spacing.lg,
            gap: Spacing.md,
          }}
        >
          <Text style={{ fontWeight: "800", fontSize: 17 }}>{t("consumerSettings.radiusSection")}</Text>
          <Text style={{ opacity: 0.7, fontSize: 14, lineHeight: 20 }}>{t("consumerSettings.radiusHelp")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {CONSUMER_RADIUS_MILES_OPTIONS.map((m) =>
              chip(radius === m, t("onboarding.radiusMiles", { miles: m }), () => void applyRadius(m), String(m)),
            )}
          </View>
        </View>

        <View
          style={{
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: Radii.lg,
            padding: Spacing.lg,
            gap: Spacing.md,
          }}
        >
          <Text style={{ fontWeight: "800", fontSize: 17 }}>{t("consumerSettings.notificationsSection")}</Text>
          <Text style={{ opacity: 0.7, fontSize: 14, lineHeight: 20 }}>{t("consumerSettings.notificationsHelp")}</Text>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              gap: Spacing.md,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700" }}>{t("account.dealAlertsTitle")}</Text>
              <Text style={{ opacity: 0.65, marginTop: Spacing.xs, fontSize: 14 }}>{t("account.dealAlertsSubtitle")}</Text>
            </View>
            <BrandedSwitch value={alertsEnabled} onValueChange={toggleAlerts} disabled={loading} />
          </View>
          <Text style={{ fontWeight: "700", marginTop: Spacing.md }}>{t("consumerSettings.notificationModeTitle")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {chip(
              notifMode === "all_nearby",
              t("consumerSettings.notifAllNearby"),
              () => void applyNotifMode("all_nearby"),
            )}
            {chip(
              notifMode === "favorites_only",
              t("consumerSettings.notifFavoritesOnly"),
              () => void applyNotifMode("favorites_only"),
            )}
          </View>
          <Text style={{ fontSize: 12, opacity: 0.55, lineHeight: 18 }}>{t("consumerSettings.notifFavoritesOverride")}</Text>
        </View>

        <View
          style={{
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: Radii.lg,
            padding: Spacing.lg,
            gap: Spacing.sm,
          }}
        >
          <Text style={{ fontWeight: "800", fontSize: 17 }}>{t("language.sectionApp")}</Text>
          <Text style={{ opacity: 0.7, fontSize: 14, lineHeight: 20 }}>{t("language.sectionAppHelp")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: Spacing.sm }}>
            {(["en", "es", "ko"] as const).map((loc) => {
              const active = i18n.language === loc;
              return (
                <Pressable
                  key={loc}
                  onPress={() => chooseAppLocale(loc)}
                  style={{
                    paddingVertical: Spacing.sm,
                    paddingHorizontal: Spacing.md,
                    borderRadius: Radii.pill,
                    backgroundColor: active ? "rgba(255,159,28,0.16)" : theme.surfaceMuted,
                    borderWidth: 1,
                    borderColor: active ? "rgba(255,159,28,0.4)" : theme.border,
                    marginRight: Spacing.sm,
                    marginBottom: Spacing.sm,
                  }}
                >
                  <Text style={{ color: active ? theme.primary : "#333", fontWeight: "700", fontSize: 13 }}>
                    {loc === "en" ? t("language.english") : loc === "es" ? t("language.spanish") : t("language.korean")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View
          style={{
            borderWidth: 1,
            borderColor: Colors.light.border,
            borderRadius: Radii.lg,
            padding: Spacing.lg,
            gap: Spacing.sm,
          }}
        >
          <Text style={{ fontWeight: "800", fontSize: 17 }}>{t("consumerSettings.switchModeTitle")}</Text>
          <Text style={{ opacity: 0.7, fontSize: 14, lineHeight: 20 }}>{t("consumerSettings.switchModeHelp")}</Text>
          <SecondaryButton
            title={t("consumerSettings.switchToBusiness")}
            onPress={async () => {
              await setTabMode("business");
              router.replace("/(tabs)/dashboard" as Href);
            }}
            style={{ minHeight: 66, paddingVertical: Spacing.md, marginTop: Spacing.xs }}
          />
        </View>

        {consumerSession ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: Radii.lg,
              padding: Spacing.lg,
              gap: Spacing.sm,
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 17 }}>{t("account.sessionSectionTitle")}</Text>
            <SecondaryButton
              title={t("account.logOut")}
              onPress={confirmLogout}
              disabled={loading || logoutBusy || deleteBusy}
            />
          </View>
        ) : null}

        {consumerSession ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: "#f3d4d4",
              borderRadius: Radii.lg,
              padding: Spacing.lg,
              gap: Spacing.sm,
              backgroundColor: "#fffafa",
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 17, color: "#7f1d1d" }}>
              {t("deleteAccount.sectionTitle")}
            </Text>
            <Text style={{ opacity: 0.78, fontSize: 14, lineHeight: 20, color: "#444" }}>
              {t("deleteAccount.sectionBodyConsumer")}
            </Text>
            <Pressable
              onPress={() => void openWebsiteUrl(DELETE_ACCOUNT_URL)}
              accessibilityRole="link"
              style={{ alignSelf: "flex-start", paddingVertical: Spacing.xs }}
            >
              <Text style={{ fontSize: 14, fontWeight: "700", color: "#2563eb" }}>
                {t("legal.deleteAccount")}
              </Text>
            </Pressable>
            <PrimaryButton
              title={t("deleteAccount.cta")}
              onPress={confirmDeleteAccount}
              disabled={loading || logoutBusy || deleteBusy}
              style={{ backgroundColor: "#b91c1c" }}
            />
          </View>
        ) : null}

        {(() => {
          // Hide the entire Help & Contact card only when all configured contact
          // channels are absent. Email is always present via getSupportEmail().
          const supportEmail = getSupportEmail();
          const supportPhone = getSupportPhone();
          if (!supportEmail && !supportPhone) return null;
          return (
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: Radii.lg,
                padding: Spacing.lg,
                gap: Spacing.sm,
              }}
            >
              <Text style={{ fontWeight: "800", fontSize: 17 }}>{t("supportContact.sectionTitle")}</Text>
              <Text style={{ opacity: 0.7, fontSize: 14, lineHeight: 20 }}>{t("supportContact.sectionHelp")}</Text>
              {supportEmail ? (
                <>
                  <SecondaryButton
                    title={t("supportContact.contactSupportCta")}
                    onPress={() => void Linking.openURL(`mailto:${supportEmail}`)}
                    accessibilityLabel={t("supportContact.emailA11y")}
                  />
                  <Text style={{ color: theme.accentText, fontWeight: "700", fontSize: 15 }}>{supportEmail}</Text>
                </>
              ) : null}
              {supportPhone ? (
                <Pressable
                  onPress={() => void Linking.openURL(`tel:${supportPhone}`)}
                  accessibilityRole="link"
                  accessibilityLabel={t("supportContact.phoneA11y")}
                  style={{ paddingVertical: Spacing.xs }}
                >
                  <Text style={{ color: theme.accentText, fontWeight: "700", fontSize: 15 }}>{supportPhone}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })()}

        <View
          style={{
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: Radii.lg,
            padding: Spacing.lg,
            gap: Spacing.sm,
          }}
        >
          <Text style={{ fontWeight: "800", fontSize: 17 }}>{t("legal.sectionTitle")}</Text>
          <LegalExternalLinks />
        </View>

        {isDebugPanelEnabled() ? (
          <SecondaryButton
            title={t("settingsScreen.checkStatus")}
            onPress={async () => {
              const enabled = await getAlertsEnabled();
              confirm({
                iconName: "notifications",
                title: t("settingsScreen.statusAlertTitle"),
                message: enabled ? t("settingsScreen.statusOn") : t("settingsScreen.statusOff"),
                confirmLabel: t("commonUi.ok"),
              });
            }}
          />
        ) : null}

        {isDebugPanelEnabled() ? (
          <PrimaryButton
            title="Diagnostics (build / env)"
            onPress={() => router.push("/debug-diagnostics")}
            style={{ marginTop: Spacing.md, backgroundColor: "#222" }}
          />
        ) : null}
        </>
        )}
      </ScrollView>
      {confirmModal}
    </View>
    </KeyboardScreen>
  );
}
