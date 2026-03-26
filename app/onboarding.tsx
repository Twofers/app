import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import {
  CONSUMER_RADIUS_MILES_OPTIONS,
  type ConsumerRadiusMiles,
  getConsumerPreferences,
  setConsumerLocationMode,
  setConsumerNotificationPrefs,
  setConsumerRadiusMiles,
  setConsumerZipCode,
  setLastKnownConsumerCoords,
  setOnboardingComplete,
} from "@/lib/consumer-preferences";
import { resolveConsumerCoordinates } from "@/lib/consumer-location";
import { geocodeUsZip } from "@/lib/us-zip-geocode";
import { setAlertsEnabled } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import { updateConsumerProfileZip } from "@/lib/consumer-profile";

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const [step, setStep] = useState(0);
  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState<ConsumerRadiusMiles>(3);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    void getConsumerPreferences().then((p) => {
      if (p.zipCode.trim()) setZip(p.zipCode.trim());
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session?.user?.id) {
        router.replace("/auth-landing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function afterLocationResolved() {
    const prefs = await getConsumerPreferences();
    const coords = await resolveConsumerCoordinates({
      ...prefs,
      zipCode: zip,
      radiusMiles: radius,
      locationMode: prefs.locationMode,
    });
    if (coords) {
      await setLastKnownConsumerCoords(coords.lat, coords.lng);
    }
  }

  async function requestGps() {
    setBusy(true);
    setHint(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setHint(t("onboarding.locationDenied"));
        setStep(2);
        return;
      }
      await setConsumerLocationMode("gps");
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await setLastKnownConsumerCoords(pos.coords.latitude, pos.coords.longitude);
      setStep(3);
    } catch {
      setHint(t("onboarding.locationError"));
      setStep(2);
    } finally {
      setBusy(false);
    }
  }

  async function saveZipAndContinue() {
    const z = zip.trim();
    if (!z) {
      setHint(t("onboarding.zipRequired"));
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      const geo = await geocodeUsZip(z);
      if (!geo.ok) {
        setHint(geo.failure === "invalid_format" ? t("onboarding.zipInvalidFormat") : t("onboarding.zipLookupFail"));
        return;
      }
      await setConsumerLocationMode("zip");
      await setConsumerZipCode(z);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await updateConsumerProfileZip(session.user.id, z);
      }
      await setLastKnownConsumerCoords(geo.lat, geo.lng);
      setStep(3);
    } catch {
      setHint(t("onboarding.zipLookupFail"));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      await setConsumerRadiusMiles(radius);
      await afterLocationResolved();
      await setOnboardingComplete(true);
      router.replace("/(tabs)");
    } finally {
      setBusy(false);
    }
  }

  async function enableNotificationsAndFinish() {
    setBusy(true);
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === "granted") {
        await setAlertsEnabled(true);
      }
      await setConsumerNotificationPrefs({ v: 1, mode: "all_nearby" });
      await finish();
    } finally {
      setBusy(false);
    }
  }

  async function skipNotificationsAndFinish() {
    await setAlertsEnabled(false);
    await setConsumerNotificationPrefs({ v: 1, mode: "all_nearby" });
    await finish();
  }

  return (
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("onboarding.title")}</Text>
      <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.lg, opacity: 0.72, fontSize: 15, lineHeight: 22 }}>
        {t("onboarding.subtitle")}
      </Text>

      {hint ? (
        <Text style={{ marginBottom: Spacing.md, color: "#b45309", fontSize: 14, lineHeight: 20 }}>{hint}</Text>
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: scrollBottom }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 0 ? (
          <View style={{ gap: Spacing.md }}>
            <Text style={{ fontSize: 17, lineHeight: 24 }}>{t("onboarding.introBody")}</Text>
            <PrimaryButton title={t("onboarding.next")} onPress={() => setStep(1)} />
            <SecondaryButton title={t("onboarding.signInCta")} onPress={() => router.push("/(tabs)/auth" as Href)} />
          </View>
        ) : null}

        {step === 1 ? (
          <View style={{ gap: Spacing.md }}>
            <Text style={{ fontSize: 17, fontWeight: "700" }}>{t("onboarding.locationTitle")}</Text>
            <Text style={{ opacity: 0.75, lineHeight: 22 }}>{t("onboarding.locationBody")}</Text>
            <PrimaryButton title={t("onboarding.useGps")} onPress={() => void requestGps()} disabled={busy} />
            <SecondaryButton title={t("onboarding.useZipInstead")} onPress={() => setStep(2)} disabled={busy} />
          </View>
        ) : null}

        {step === 2 ? (
          <View style={{ gap: Spacing.md }}>
            <Text style={{ fontSize: 17, fontWeight: "700" }}>{t("onboarding.zipTitle")}</Text>
            <Text style={{ opacity: 0.75, lineHeight: 22 }}>{t("onboarding.zipBody")}</Text>
            <TextInput
              value={zip}
              onChangeText={setZip}
              placeholder={t("onboarding.zipPlaceholder")}
              autoCapitalize="characters"
              autoCorrect={false}
              style={{
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 12,
                paddingVertical: Spacing.sm,
                paddingHorizontal: Spacing.md,
                fontSize: 16,
              }}
            />
            <PrimaryButton title={t("onboarding.continueZip")} onPress={() => void saveZipAndContinue()} disabled={busy} />
            <SecondaryButton title={t("onboarding.back")} onPress={() => setStep(1)} disabled={busy} />
          </View>
        ) : null}

        {step === 3 ? (
          <View style={{ gap: Spacing.lg }}>
            <Text style={{ fontSize: 17, fontWeight: "700" }}>{t("onboarding.radiusTitle")}</Text>
            <Text style={{ opacity: 0.75, lineHeight: 22 }}>{t("onboarding.radiusBody")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm }}>
              {CONSUMER_RADIUS_MILES_OPTIONS.map((m) => {
                const active = radius === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => setRadius(m)}
                    style={{
                      paddingVertical: Spacing.sm,
                      paddingHorizontal: Spacing.md,
                      borderRadius: 20,
                      backgroundColor: active ? "#111" : "#ececec",
                    }}
                  >
                    <Text style={{ fontWeight: "700", color: active ? "#fff" : "#333" }}>
                      {t("onboarding.radiusMiles", { miles: m })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <PrimaryButton title={t("onboarding.next")} onPress={() => setStep(4)} />
          </View>
        ) : null}

        {step === 4 ? (
          <View style={{ gap: Spacing.md }}>
            <Text style={{ fontSize: 17, fontWeight: "700" }}>{t("onboarding.notifyTitle")}</Text>
            <Text style={{ opacity: 0.75, lineHeight: 22 }}>{t("onboarding.notifyBody")}</Text>
            <Text style={{ opacity: 0.75, lineHeight: 22 }}>{t("onboarding.favoriteHint")}</Text>
            <PrimaryButton
              title={t("onboarding.enableNotifications")}
              onPress={() => void enableNotificationsAndFinish()}
              disabled={busy}
            />
            <SecondaryButton title={t("onboarding.notNow")} onPress={() => void skipNotificationsAndFinish()} disabled={busy} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
