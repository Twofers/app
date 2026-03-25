import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
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
import { supabase } from "@/lib/supabase";
import { updateConsumerProfileZip } from "@/lib/consumer-profile";
import type { AppLocale } from "@/lib/i18n/config";
import { setUiLocalePreference } from "@/lib/locale/ui-locale-storage";
import { PrimaryButton } from "@/components/ui/primary-button";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { isDebugPanelEnabled } from "@/lib/runtime-env";

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const [alertsEnabled, setAlertsEnabledState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [locationMode, setLocationModeState] = useState<ConsumerLocationMode>("gps");
  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState<ConsumerRadiusMiles>(3);
  const [notifMode, setNotifModeState] = useState<ConsumerNotificationMode>("all_nearby");
  const [consumerSession, setConsumerSession] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const [a, p, sess] = await Promise.all([
      getAlertsEnabled(),
      getConsumerPreferences(),
      supabase.auth.getSession(),
    ]);
    setAlertsEnabledState(a);
    setLocationModeState(p.locationMode);
    setZip(p.zipCode);
    setRadius(p.radiusMiles);
    setNotifModeState(p.notificationPrefs.mode);
    setConsumerSession(!!sess.data.session?.user);
    setLoading(false);
  }, []);

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
      const { status } = await Notifications.requestPermissionsAsync();
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
        } catch {
          /* ignore */
        }
      }
    }
    await persistCoords();
  }

  async function saveZip() {
    await setConsumerZipCode(zip);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user?.id && zip.trim()) {
      await updateConsumerProfileZip(session.user.id, zip.trim());
    }
    await persistCoords();
  }

  async function applyRadius(m: ConsumerRadiusMiles) {
    setRadius(m);
    await setConsumerRadiusMiles(m);
  }

  async function applyNotifMode(m: ConsumerNotificationMode) {
    setNotifModeState(m);
    await setConsumerNotificationPrefs({ v: 1, mode: m });
  }

  async function chooseAppLocale(locale: AppLocale) {
    await setUiLocalePreference(locale, { manual: true });
    await i18n.changeLanguage(locale);
  }

  function chip(active: boolean, label: string, onPress: () => void) {
    return (
      <Pressable
        onPress={onPress}
        style={{
          paddingVertical: Spacing.sm,
          paddingHorizontal: Spacing.md,
          borderRadius: 14,
          backgroundColor: active ? "#111" : "#ececec",
          marginRight: Spacing.sm,
          marginBottom: Spacing.sm,
        }}
      >
        <Text style={{ fontWeight: "700", color: active ? "#fff" : "#333" }}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("settingsScreen.title")}</Text>

      <ScrollView
        style={{ flex: 1, marginTop: Spacing.lg }}
        contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.lg }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => router.push("/(tabs)/account")}
          style={{
            borderRadius: 16,
            padding: Spacing.lg,
            backgroundColor: "#111",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>{t("consumerSettings.accountCta")}</Text>
          <Text style={{ color: "rgba(255,255,255,0.75)", marginTop: Spacing.xs, fontSize: 14 }}>
            {t("consumerSettings.accountCtaSub")}
          </Text>
        </Pressable>

        {consumerSession ? (
          <Pressable
            onPress={() => router.push("/consumer-profile-setup?edit=1" as Href)}
            style={{
              borderWidth: 1,
              borderColor: "#e5e5e5",
              borderRadius: 16,
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
            borderColor: "#e5e5e5",
            borderRadius: 16,
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
                style={{
                  borderWidth: 1,
                  borderColor: "#ddd",
                  borderRadius: 12,
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
            borderColor: "#e5e5e5",
            borderRadius: 16,
            padding: Spacing.lg,
            gap: Spacing.md,
          }}
        >
          <Text style={{ fontWeight: "800", fontSize: 17 }}>{t("consumerSettings.radiusSection")}</Text>
          <Text style={{ opacity: 0.7, fontSize: 14, lineHeight: 20 }}>{t("consumerSettings.radiusHelp")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {CONSUMER_RADIUS_MILES_OPTIONS.map((m) =>
              chip(radius === m, t("onboarding.radiusMiles", { miles: m }), () => void applyRadius(m)),
            )}
          </View>
        </View>

        <View
          style={{
            borderWidth: 1,
            borderColor: "#e5e5e5",
            borderRadius: 16,
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
            borderColor: "#e5e5e5",
            borderRadius: 16,
            padding: Spacing.lg,
            gap: Spacing.sm,
          }}
        >
          <Text style={{ fontWeight: "800", fontSize: 17 }}>{t("language.sectionApp")}</Text>
          <Text style={{ opacity: 0.7, fontSize: 14, lineHeight: 20 }}>{t("language.sectionAppHelp")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: Spacing.sm }}>
            <Pressable
              onPress={() => chooseAppLocale("en")}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: i18n.language === "en" ? "#111" : "#f0f0f0",
                marginRight: 8,
                marginBottom: 8,
              }}
            >
              <Text style={{ color: i18n.language === "en" ? "#fff" : "#111", fontWeight: "600", fontSize: 13 }}>
                {t("language.english")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => chooseAppLocale("es")}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: i18n.language === "es" ? "#111" : "#f0f0f0",
                marginRight: 8,
                marginBottom: 8,
              }}
            >
              <Text style={{ color: i18n.language === "es" ? "#fff" : "#111", fontWeight: "600", fontSize: 13 }}>
                {t("language.spanish")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => chooseAppLocale("ko")}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: i18n.language === "ko" ? "#111" : "#f0f0f0",
                marginRight: 8,
                marginBottom: 8,
              }}
            >
              <Text style={{ color: i18n.language === "ko" ? "#fff" : "#111", fontWeight: "600", fontSize: 13 }}>
                {t("language.korean")}
              </Text>
            </Pressable>
          </View>
        </View>

        <View
          style={{
            borderWidth: 1,
            borderColor: "#e5e5e5",
            borderRadius: 16,
            padding: Spacing.lg,
            gap: Spacing.sm,
          }}
        >
          <Text style={{ fontWeight: "800", fontSize: 17 }}>{t("legal.sectionTitle")}</Text>
          <LegalExternalLinks />
        </View>

        <Pressable
          onPress={async () => {
            const enabled = await getAlertsEnabled();
            Alert.alert(
              t("settingsScreen.statusAlertTitle"),
              enabled ? t("settingsScreen.statusOn") : t("settingsScreen.statusOff"),
            );
          }}
          style={{
            paddingVertical: Spacing.md + 2,
            borderRadius: 14,
            backgroundColor: "#eee",
          }}
        >
          <Text style={{ color: "#111", fontWeight: "700", textAlign: "center", fontSize: 16 }}>
            {t("settingsScreen.checkStatus")}
          </Text>
        </Pressable>

        {isDebugPanelEnabled() ? (
          <Pressable
            onPress={() => router.push("/debug-diagnostics")}
            style={{
              marginTop: Spacing.md,
              paddingVertical: Spacing.md + 2,
              borderRadius: 14,
              backgroundColor: "#222",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700", textAlign: "center", fontSize: 16 }}>
              Diagnostics (build / env)
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
