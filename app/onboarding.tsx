import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { PrimaryButton } from "@/components/ui/primary-button";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useColorScheme } from "@/hooks/use-color-scheme";
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

  const [locationMode, setLocationMode] = useState<"gps" | "zip">("gps");
  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState<ConsumerRadiusMiles>(15);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    void getConsumerPreferences().then((p) => {
      if (p.zipCode.trim()) setZip(p.zipCode.trim());
    });
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      router.replace("/auth-landing");
    }
  }, [session?.user?.id, router]);

  async function finish(coords?: { lat: number; lng: number }) {
    await setConsumerRadiusMiles(radius);
    if (coords) {
      await setLastKnownConsumerCoords(coords.lat, coords.lng);
    } else {
      const prefs = await getConsumerPreferences();
      const resolved = await resolveConsumerCoordinates({
        ...prefs,
        zipCode: zip,
        radiusMiles: radius,
        locationMode,
      });
      if (resolved) await setLastKnownConsumerCoords(resolved.lat, resolved.lng);
    }
    await setConsumerNotificationPrefs({ v: 1, mode: "all_nearby" });
    await setOnboardingComplete(true);
    router.replace("/(tabs)");
  }

  async function handleGetStarted() {
    setBusy(true);
    setHint(null);
    try {
      if (locationMode === "gps") {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setHint(t("onboarding.locationDenied"));
          setLocationMode("zip");
          return;
        }
        await setConsumerLocationMode("gps");
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await finish({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } else {
        const z = zip.trim();
        if (!z) {
          setHint(t("onboarding.zipRequired"));
          return;
        }
        const geo = await geocodeUsZip(z);
        if (!geo.ok) {
          setHint(geo.failure === "invalid_format" ? t("onboarding.zipInvalidFormat") : t("onboarding.zipLookupFail"));
          return;
        }
        await setConsumerLocationMode("zip");
        await setConsumerZipCode(z);
        const uid = session?.user?.id;
        if (uid) await updateConsumerProfileZip(uid, z);
        await finish({ lat: geo.lat, lng: geo.lng });
      }
    } catch (err: unknown) {
      if (__DEV__) console.warn("Onboarding error:", err);
      setHint(t("onboarding.locationError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardScreen>
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, backgroundColor: C.background }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3, color: C.text }}>{t("onboarding.locationTitle")}</Text>
      <Text style={{ marginTop: Spacing.sm, fontSize: 15, lineHeight: 22, color: C.mutedText }}>
        {t("onboarding.subtitle")}
      </Text>

      {hint ? (
        <Text style={{ marginTop: Spacing.md, color: "#b45309", fontSize: 14, lineHeight: 20 }}>{hint}</Text>
      ) : null}

      <ScrollView
        style={{ flex: 1, marginTop: Spacing.lg }}
        contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.lg }}
        {...FORM_SCROLL_KEYBOARD_PROPS}
        showsVerticalScrollIndicator={false}
      >
        {/* Location mode toggle */}
        <View>
          <Text style={{ fontWeight: "700", marginBottom: Spacing.sm, color: C.text }}>{t("onboarding.locationBody")}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={() => { setLocationMode("gps"); setHint(null); }}
              style={{
                flex: 1, paddingVertical: Spacing.md, borderRadius: Radii.lg, alignItems: "center",
                borderWidth: 2, borderColor: locationMode === "gps" ? C.primary : C.border,
                backgroundColor: locationMode === "gps" ? "rgba(255,159,28,0.08)" : C.surface,
              }}
            >
              <Text style={{ fontWeight: "700", color: locationMode === "gps" ? C.primary : C.text }}>{t("onboarding.useGps")}</Text>
            </Pressable>
            <Pressable
              onPress={() => { setLocationMode("zip"); setHint(null); }}
              style={{
                flex: 1, paddingVertical: Spacing.md, borderRadius: Radii.lg, alignItems: "center",
                borderWidth: 2, borderColor: locationMode === "zip" ? C.primary : C.border,
                backgroundColor: locationMode === "zip" ? "rgba(255,159,28,0.08)" : C.surface,
              }}
            >
              <Text style={{ fontWeight: "700", color: locationMode === "zip" ? C.primary : C.text }}>{t("onboarding.useZipInstead")}</Text>
            </Pressable>
          </View>
        </View>

        {/* ZIP input (shown only in zip mode) */}
        {locationMode === "zip" ? (
          <View>
            <TextInput
              value={zip}
              onChangeText={(value) => setZip(sanitizeZipInput(value))}
              placeholder={t("onboarding.zipPlaceholder")}
              placeholderTextColor={C.mutedText}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              maxLength={10}
              style={{
                borderWidth: 1, borderColor: C.border, borderRadius: Radii.lg,
                paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
                fontSize: 16, backgroundColor: C.surface, color: C.text,
              }}
            />
          </View>
        ) : null}

        {/* Search radius */}
        <View>
          <Text style={{ fontWeight: "700", marginBottom: Spacing.sm, color: C.text }}>{t("onboarding.radiusTitle")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm }}>
            {CONSUMER_RADIUS_MILES_OPTIONS.map((m) => {
              const active = radius === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setRadius(m)}
                  style={{
                    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radii.pill,
                    backgroundColor: active ? "rgba(255,159,28,0.16)" : C.surfaceMuted,
                    borderWidth: 1, borderColor: active ? "rgba(255,159,28,0.4)" : C.border,
                  }}
                >
                  <Text style={{ fontWeight: "700", color: active ? C.primary : C.text }}>
                    {t("onboarding.radiusMiles", { miles: m })}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <PrimaryButton
          title={busy ? t("consumerProfile.saving") : t("onboarding.getStarted")}
          onPress={() => void handleGetStarted()}
          disabled={busy || (locationMode === "zip" && !zip.trim())}
        />
      </ScrollView>
    </View>
    </KeyboardScreen>
  );
}
