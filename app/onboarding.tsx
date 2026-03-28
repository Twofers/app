import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { requestNotificationPermissionsSafe } from "@/lib/expo-notifications-support";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import i18n from "@/lib/i18n/config";
import type { AppLocale } from "@/lib/i18n/config";
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

function sanitizeZipInput(raw: string): string {
  const cleaned = raw.replace(/[^\d-]/g, "");
  return cleaned.slice(0, 10);
}

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const [step, setStep] = useState(0);
  const [lang, setLang] = useState<AppLocale>("en");
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
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : "";
      setHint(
        detail
          ? `${t("onboarding.locationError")} (${detail})`
          : t("onboarding.locationError"),
      );
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
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : "";
      setHint(
        detail
          ? `${t("onboarding.zipLookupFail")} (${detail})`
          : t("onboarding.zipLookupFail"),
      );
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
      const { status, skippedBecauseExpoGo } = await requestNotificationPermissionsSafe();
      if (status === "granted") {
        await setAlertsEnabled(true);
      } else if (skippedBecauseExpoGo) {
        await setAlertsEnabled(false);
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

  const totalSteps = 5;

  return (
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("onboarding.title")}</Text>
      <Text style={{ marginTop: Spacing.sm, opacity: 0.72, fontSize: 15, lineHeight: 22 }}>
        {t("onboarding.subtitle")}
      </Text>

      {/* Step progress dots */}
      <View style={{ flexDirection: "row", gap: 6, marginTop: Spacing.lg, marginBottom: Spacing.md }}>
        {Array.from({ length: totalSteps }).map((_, i) => (
          <View
            key={i}
            style={{
              height: 4,
              flex: 1,
              borderRadius: Radii.pill,
              backgroundColor: i <= step ? Colors.light.primary : Colors.light.border,
            }}
          />
        ))}
      </View>

      {hint ? (
        <Text style={{ marginBottom: Spacing.md, color: "#b45309", fontSize: 14, lineHeight: 20 }}>{hint}</Text>
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.md }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 0 ? (
          <>
            {/* Title shown in all three languages so users can recognise their own */}
            <Text style={{ fontSize: 17, fontWeight: "700", lineHeight: 26 }}>
              Choose your language
            </Text>
            <Text style={{ fontSize: 14, opacity: 0.55, lineHeight: 20 }}>
              Elige tu idioma  ·  언어를 선택하세요
            </Text>

            <View style={{ gap: Spacing.sm, marginTop: Spacing.sm }}>
              {(
                [
                  { code: "en" as AppLocale, flag: "🇺🇸", label: "English" },
                  { code: "es" as AppLocale, flag: "🇪🇸", label: "Español" },
                  { code: "ko" as AppLocale, flag: "🇰🇷", label: "한국어" },
                ] as const
              ).map(({ code, flag, label }) => {
                const active = lang === code;
                return (
                  <Pressable
                    key={code}
                    onPress={() => setLang(code)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      paddingVertical: Spacing.md,
                      paddingHorizontal: Spacing.lg,
                      borderRadius: Radii.lg,
                      borderWidth: active ? 2 : 1,
                      borderColor: active ? Colors.light.primary : Colors.light.border,
                      backgroundColor: active ? "rgba(255,159,28,0.08)" : Colors.light.surface,
                      gap: Spacing.md,
                    }}
                  >
                    <Text style={{ fontSize: 28 }}>{flag}</Text>
                    <Text
                      style={{
                        fontSize: 17,
                        fontWeight: active ? "700" : "500",
                        color: active ? Colors.light.primary : "#11181C",
                      }}
                    >
                      {label}
                    </Text>
                    {active ? (
                      <View style={{ marginLeft: "auto" }}>
                        <Text style={{ color: Colors.light.primary, fontWeight: "700", fontSize: 18 }}>✓</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            <PrimaryButton
              title="Continue"
              onPress={() => {
                void i18n.changeLanguage(lang).then(() => setStep(1));
              }}
            />
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Text style={{ fontSize: 17, fontWeight: "700" }}>{t("onboarding.locationTitle")}</Text>
            <Text style={{ opacity: 0.75, lineHeight: 22 }}>{t("onboarding.locationBody")}</Text>
            <PrimaryButton title={t("onboarding.useGps")} onPress={() => void requestGps()} disabled={busy} />
            <SecondaryButton title={t("onboarding.useZipInstead")} onPress={() => setStep(2)} disabled={busy} />
            <SecondaryButton title={t("onboarding.back")} onPress={() => setStep(0)} disabled={busy} />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Text style={{ fontSize: 17, fontWeight: "700" }}>{t("onboarding.zipTitle")}</Text>
            <Text style={{ opacity: 0.75, lineHeight: 22 }}>{t("onboarding.zipBody")}</Text>
            <TextInput
              value={zip}
              onChangeText={(value) => setZip(sanitizeZipInput(value))}
              placeholder={t("onboarding.zipPlaceholder")}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.lg,
                paddingVertical: Spacing.sm,
                paddingHorizontal: Spacing.md,
                fontSize: 16,
                backgroundColor: Colors.light.surface,
              }}
            />
            <PrimaryButton title={t("onboarding.continueZip")} onPress={() => void saveZipAndContinue()} disabled={busy} />
            <SecondaryButton title={t("onboarding.back")} onPress={() => setStep(1)} disabled={busy} />
          </>
        ) : null}

        {step === 3 ? (
          <>
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
                      borderRadius: Radii.pill,
                      backgroundColor: active ? "rgba(255,159,28,0.16)" : Colors.light.surfaceMuted,
                      borderWidth: 1,
                      borderColor: active ? "rgba(255,159,28,0.4)" : Colors.light.border,
                    }}
                  >
                    <Text style={{ fontWeight: "700", color: active ? Colors.light.primary : "#333" }}>
                      {t("onboarding.radiusMiles", { miles: m })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <PrimaryButton title={t("onboarding.next")} onPress={() => setStep(4)} />
            <SecondaryButton title={t("onboarding.back")} onPress={() => setStep(1)} disabled={busy} />
          </>
        ) : null}

        {step === 4 ? (
          <>
            <Text style={{ fontSize: 17, fontWeight: "700" }}>{t("onboarding.notifyTitle")}</Text>
            <Text style={{ opacity: 0.75, lineHeight: 22 }}>{t("onboarding.notifyBody")}</Text>
            <Text style={{ opacity: 0.75, lineHeight: 22 }}>{t("onboarding.favoriteHint")}</Text>
            <PrimaryButton
              title={t("onboarding.enableNotifications")}
              onPress={() => void enableNotificationsAndFinish()}
              disabled={busy}
            />
            <SecondaryButton title={t("onboarding.notNow")} onPress={() => void skipNotificationsAndFinish()} disabled={busy} />
            <SecondaryButton title={t("onboarding.back")} onPress={() => setStep(3)} disabled={busy} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
