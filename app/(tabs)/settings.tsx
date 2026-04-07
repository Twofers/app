import { useCallback, useState } from "react";
import { Alert, ScrollView, Switch, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { requestNotificationPermissionsSafe } from "@/lib/expo-notifications-support";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { getAlertsEnabled, setAlertsEnabled } from "@/lib/notifications";
import {
  CONSUMER_RADIUS_MILES_OPTIONS,
  type ConsumerLocationMode,
  type ConsumerNotificationMode,
  type ConsumerRadiusMiles,
  getConsumerPreferences,
  setConsumerLocationMode,
  setConsumerNotificationPrefs,
  setConsumerRadiusMiles,
  setConsumerZipCode,
  setLastKnownConsumerCoords,
} from "@/lib/consumer-preferences";
import { resolveConsumerCoordinates } from "@/lib/consumer-location";
import { geocodeUsZip } from "@/lib/us-zip-geocode";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { updateConsumerProfileZip } from "@/lib/consumer-profile";
import { syncConsumerPrefsToServer } from "@/lib/sync-consumer-prefs";
import type { AppLocale } from "@/lib/i18n/config";
import { setUiLocalePreference } from "@/lib/locale/ui-locale-storage";
import { PrimaryButton } from "@/components/ui/primary-button";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { isDebugPanelEnabled } from "@/lib/runtime-env";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useTabMode } from "@/lib/tab-mode";
import { signOutAndRedirectToAuthLanding } from "@/lib/auth-app-sign-out";

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { session } = useAuthSession();
  const { setMode: setTabMode } = useTabMode();
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const [alertsEnabled, setAlertsEnabledState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [locationMode, setLocationModeState] = useState<ConsumerLocationMode>("gps");
  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState<ConsumerRadiusMiles>(3);
  const [notifMode, setNotifModeState] = useState<ConsumerNotificationMode>("all_nearby");
  const [consumerSession, setConsumerSession] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const [a, p] = await Promise.all([getAlertsEnabled(), getConsumerPreferences()]);
    setAlertsEnabledState(a);
    setLocationModeState(p.locationMode);
    setZip(p.zipCode);
    setRadius(p.radiusMiles);
    setNotifModeState(p.notificationPrefs.mode);
    setConsumerSession(!!session?.user);
    setLoading(false);
  }, [session?.user]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function persistCoords() {
    const prefs = await getConsumerPreferences();
    const coords = await resolveConsumerCoordinates({ ...prefs, zipCode: zip, locationMode });
    if (coords) {
      await setLastKnownConsumerCoords(coords.lat, coords.lng);
    }
  }

  async function toggleAlerts(next: boolean) {
    if (next) {
      const { status, skippedBecauseExpoGo } = await requestNotificationPermissionsSafe();
      if (skippedBecauseExpoGo) {
        Alert.alert(t("settingsScreen.alertsPermissionTitle"), t("settingsScreen.alertsExpoGoBody"));
        return;
      }
      if (status !== "granted") {
        Alert.alert(t("settingsScreen.alertsPermissionTitle"), t("settingsScreen.alertsPermissionBody"));
        return;
      }
    }
    await setAlertsEnabled(next);
    setAlertsEnabledState(next);
  }

  async function applyLocationMode(mode: ConsumerLocationMode) {
    await setConsumerLocationMode(mode);
    setLocationModeState(mode);
    if (mode === "gps") {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        try {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          await setLastKnownConsumerCoords(pos.coords.latitude, pos.coords.longitude);
        } catch (err: unknown) {
          const detail = err instanceof Error ? err.message : "";
          Alert.alert(
            t("consumerSettings.gpsErrorTitle"),
            detail
              ? `${t("consumerSettings.gpsErrorBody")} (${detail})`
              : t("consumerSettings.gpsErrorBody"),
          );
        }
      }
    }
    await persistCoords();
  }

  async function saveZip() {
    const trimmed = zip.trim();
    if (!trimmed) {
      Alert.alert(t("consumerSettings.zipSaveFailTitle"), t("consumerSettings.zipEmpty"));
      return;
    }
    const geo = await geocodeUsZip(trimmed);
    if (!geo.ok) {
      Alert.alert(
        t("consumerSettings.zipSaveFailTitle"),
        geo.failure === "invalid_format" ? t("consumerSettings.zipInvalid") : t("consumerSettings.zipLookupFail"),
      );
      return;
    }
    await setConsumerZipCode(trimmed);
    if (session?.user?.id) {
      await updateConsumerProfileZip(session.user.id, trimmed);
    }
    await setLastKnownConsumerCoords(geo.lat, geo.lng);
  }

  async function applyRadius(m: ConsumerRadiusMiles) {
    setRadius(m);
    await setConsumerRadiusMiles(m);
    void syncConsumerPrefsToServer(session?.user?.id ?? null);
  }

  async function applyNotifMode(m: ConsumerNotificationMode) {
    setNotifModeState(m);
    await setConsumerNotificationPrefs({ v: 1, mode: m });
    void syncConsumerPrefsToServer(session?.user?.id ?? null);
  }

  async function chooseAppLocale(locale: AppLocale) {
    await setUiLocalePreference(locale, { manual: true });
    await i18n.changeLanguage(locale);
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
        Alert.alert(t("account.errLogoutFailed"), result.message);
      }
    } finally {
      setLogoutBusy(false);
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
          backgroundColor: active ? "#111" : Colors.light.surfaceMuted,
          marginRight: Spacing.sm,
          marginBottom: Spacing.sm,
        }}
      >
        <Text style={{ fontWeight: "700", color: active ? "#fff" : "#333" }}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <KeyboardScreen>
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("settingsScreen.title")}</Text>

      <ScrollView
        style={{ flex: 1, marginTop: Spacing.lg }}
        contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.lg }}
        showsVerticalScrollIndicator={false}
        {...FORM_SCROLL_KEYBOARD_PROPS}
      >
        {consumerSession ? (
          <Pressable
            onPress={() => router.push("/consumer-profile-setup?edit=1" as Href)}
            style={{
              borderWidth: 1,
              borderColor: Colors.light.border,
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
            borderColor: Colors.light.border,
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
                onChangeText={setZip}
                onEndEditing={() => void saveZip()}
                placeholder={t("onboarding.zipPlaceholder")}
                autoCapitalize="characters"
                maxLength={10}
                style={{
                  borderWidth: 1,
                  borderColor: Colors.light.border,
                  borderRadius: Radii.md,
                  padding: Spacing.md,
                  fontSize: 16,
                }}
              />
              <View style={{ marginTop: Spacing.sm }}>
                <PrimaryButton title={t("consumerSettings.saveZip")} onPress={() => void saveZip()} />
              </View>
            </View>
          ) : null}
        </View>

        <View
          style={{
            borderWidth: 1,
            borderColor: Colors.light.border,
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
            borderColor: Colors.light.border,
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
            <Switch value={alertsEnabled} onValueChange={toggleAlerts} disabled={loading} />
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
            borderColor: Colors.light.border,
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
                    backgroundColor: active ? "rgba(255,159,28,0.16)" : Colors.light.surfaceMuted,
                    borderWidth: 1,
                    borderColor: active ? "rgba(255,159,28,0.4)" : Colors.light.border,
                    marginRight: Spacing.sm,
                    marginBottom: Spacing.sm,
                  }}
                >
                  <Text style={{ color: active ? Colors.light.primary : "#333", fontWeight: "700", fontSize: 13 }}>
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
          />
        </View>

        {consumerSession ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: Colors.light.border,
              borderRadius: Radii.lg,
              padding: Spacing.lg,
              gap: Spacing.sm,
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 17 }}>{t("account.sessionSectionTitle")}</Text>
            <SecondaryButton
              title={t("account.logOut")}
              onPress={confirmLogout}
              disabled={loading || logoutBusy}
            />
          </View>
        ) : null}

        <View
          style={{
            borderWidth: 1,
            borderColor: Colors.light.border,
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
              Alert.alert(
                t("settingsScreen.statusAlertTitle"),
                enabled ? t("settingsScreen.statusOn") : t("settingsScreen.statusOff"),
              );
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
      </ScrollView>
    </View>
    </KeyboardScreen>
  );
}
