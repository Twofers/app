import { useCallback, useEffect, useState } from "react";
import { BackHandler, ScrollView, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { requestNotificationPermissionsSafe } from "@/lib/expo-notifications-support";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { PrimaryButton } from "@/components/ui/primary-button";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useColorScheme } from "@/hooks/use-color-scheme";
import i18n from "@/lib/i18n/config";
import type { AppLocale } from "@/lib/i18n/config";
import {
  CONSUMER_RADIUS_MILES_OPTIONS,
  type ConsumerRadiusMiles,
  getConsumerPreferences,
  getOnboardingStepIndex,
  setConsumerLocationMode,
  setConsumerNotificationPrefs,
  setConsumerRadiusMiles,
  setConsumerZipCode,
  setLastKnownConsumerCoords,
  setOnboardingComplete,
  setOnboardingStepIndex,
} from "@/lib/consumer-preferences";
import { resolveConsumerCoordinates } from "@/lib/consumer-location";
import { geocodeUsZip } from "@/lib/us-zip-geocode";
import { setAlertsEnabled } from "@/lib/notifications";
import { updateConsumerProfileZip } from "@/lib/consumer-profile";

function sanitizeZipInput(raw: string): string {
  const cleaned = raw.replace(/[^\d-]/g, "");
  return cleaned.slice(0, 10);
}

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useAuthSession();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const C = Colors[colorScheme];
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const [step, setStep] = useState(0);
  const [lang, setLang] = useState<AppLocale>("en");

  const goToStep = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(4, Math.floor(next)));
    setStep(clamped);
    void setOnboardingStepIndex(clamped);
  }, []);
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
    void getOnboardingStepIndex().then((s) => {
      if (s !== null) goToStep(s);
    });
  }, [goToStep]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (step > 0) {
        goToStep(step - 1);
      }
      // Always consume back press during onboarding to prevent app exit
      return true;
    });
    return () => sub.remove();
  }, [step, goToStep]);

  useEffect(() => {
    if (!session?.user?.id) {
      router.replace("/auth-landing");
    }
  }, [session?.user?.id, router]);

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
        goToStep(2);
        return;
      }
      await setConsumerLocationMode("gps");
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await setLastKnownConsumerCoords(pos.coords.latitude, pos.coords.longitude);
      goToStep(3);
    } catch (err: unknown) {
      if (__DEV__) console.warn("GPS error:", err);
      setHint(t("onboarding.locationError"));
      goToStep(2);
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
      const uid = session?.user?.id;
      if (uid) {
        await updateConsumerProfileZip(uid, z);
      }
      await setLastKnownConsumerCoords(geo.lat, geo.lng);
      goToStep(3);
    } catch (err: unknown) {
      if (__DEV__) console.warn("ZIP lookup error:", err);
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
    <KeyboardScreen>
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, backgroundColor: C.background }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3, color: C.text }}>{t("onboarding.title")}</Text>
      <Text style={{ marginTop: Spacing.sm, fontSize: 15, lineHeight: 22, color: C.mutedText }}>
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
              backgroundColor: i <= step ? C.primary : C.border,
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
        {...FORM_SCROLL_KEYBOARD_PROPS}
        showsVerticalScrollIndicator={false}
      >
        {step === 0 ? (
          <>
            {/* Title shown in all three languages so users can recognise their own */}
            <Text style={{ fontSize: 17, fontWeight: "700", lineHeight: 26, color: C.text }}>
              Choose your language
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 20, color: C.mutedText }}>
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
                      borderColor: active ? C.primary : C.border,
                      backgroundColor: active ? "rgba(255,159,28,0.08)" : C.surface,
                      gap: Spacing.md,
                    }}
                  >
                    <Text style={{ fontSize: 28 }}>{flag}</Text>
                    <Text
                      style={{
                        fontSize: 17,
                        fontWeight: active ? "700" : "500",
                        color: active ? C.primary : C.text,
                      }}
                    >
                      {label}
                    </Text>
                    {active ? (
                      <View style={{ marginLeft: "auto" }}>
                        <Text style={{ color: C.primary, fontWeight: "700", fontSize: 18 }}>✓</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            {/* FIX: Was hardcoded "Continue" — now uses i18n so it translates
                when user picks Spanish or Korean before tapping this button. */}
            <PrimaryButton
              title={t("onboarding.next")}
              onPress={() => {
                void i18n.changeLanguage(lang).then(() => goToStep(1));
              }}
            />
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Text style={{ fontSize: 17, fontWeight: "700", color: C.text }}>{t("onboarding.locationTitle")}</Text>
            <Text style={{ lineHeight: 22, color: C.mutedText }}>{t("onboarding.locationBody")}</Text>
            <PrimaryButton title={t("onboarding.useGps")} onPress={() => void requestGps()} disabled={busy} />
            <SecondaryButton title={t("onboarding.useZipInstead")} onPress={() => goToStep(2)} disabled={busy} />
            <SecondaryButton title={t("onboarding.back")} onPress={() => goToStep(0)} disabled={busy} />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Text style={{ fontSize: 17, fontWeight: "700", color: C.text }}>{t("onboarding.zipTitle")}</Text>
            <Text style={{ lineHeight: 22, color: C.mutedText }}>{t("onboarding.zipBody")}</Text>
            <TextInput
              value={zip}
              onChangeText={(value) => setZip(sanitizeZipInput(value))}
              placeholder={t("onboarding.zipPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              maxLength={10}
              style={{
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: Radii.lg,
                paddingVertical: Spacing.sm,
                paddingHorizontal: Spacing.md,
                fontSize: 16,
                backgroundColor: C.surface,
                color: C.text,
              }}
            />
            <PrimaryButton
              title={t("onboarding.continueZip")}
              onPress={() => void saveZipAndContinue()}
              disabled={busy || !zip.trim()}
            />
            <SecondaryButton title={t("onboarding.back")} onPress={() => goToStep(1)} disabled={busy} />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Text style={{ fontSize: 17, fontWeight: "700", color: C.text }}>{t("onboarding.radiusTitle")}</Text>
            <Text style={{ lineHeight: 22, color: C.mutedText }}>{t("onboarding.radiusBody")}</Text>
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
                      backgroundColor: active ? "rgba(255,159,28,0.16)" : C.surfaceMuted,
                      borderWidth: 1,
                      borderColor: active ? "rgba(255,159,28,0.4)" : C.border,
                    }}
                  >
                    <Text style={{ fontWeight: "700", color: active ? C.primary : C.text }}>
                      {t("onboarding.radiusMiles", { miles: m })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <PrimaryButton title={t("onboarding.next")} onPress={() => goToStep(4)} />
            {/* FIX: Was goToStep(1), skipping the ZIP step. Linear back = step 2. */}
            <SecondaryButton title={t("onboarding.back")} onPress={() => goToStep(2)} disabled={busy} />
          </>
        ) : null}

        {step === 4 ? (
          <>
            <Text style={{ fontSize: 17, fontWeight: "700", color: C.text }}>{t("onboarding.notifyTitle")}</Text>
            <Text style={{ lineHeight: 22, color: C.mutedText }}>{t("onboarding.notifyBody")}</Text>
            <Text style={{ lineHeight: 22, color: C.mutedText }}>{t("onboarding.favoriteHint")}</Text>
            <PrimaryButton
              title={t("onboarding.enableNotifications")}
              onPress={() => void enableNotificationsAndFinish()}
              disabled={busy}
            />
            <SecondaryButton title={t("onboarding.notNow")} onPress={() => void skipNotificationsAndFinish()} disabled={busy} />
            <SecondaryButton title={t("onboarding.back")} onPress={() => goToStep(3)} disabled={busy} />
          </>
        ) : null}
      </ScrollView>
    </View>
    </KeyboardScreen>
  );
}
