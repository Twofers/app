import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
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
  DEFAULT_RADIUS_MILES,
  getConsumerPreferences,
  setConsumerLocationMode,
  setConsumerNotificationPrefs,
  setConsumerRadiusMiles,
  setConsumerZipCode,
  setLastKnownConsumerCoords,
  setOnboardingComplete,
} from "@/lib/consumer-preferences";
import { supabase } from "@/lib/supabase";
import { geocodeUsZip } from "@/lib/us-zip-geocode";
import { updateConsumerProfileZip } from "@/lib/consumer-profile";

function sanitizeZipInput(raw: string): string {
  const cleaned = raw.replace(/[^\d-]/g, "");
  return cleaned.slice(0, 10);
}

// Mirrors the business-setup category keys (minus "other") so a consumer's picks
// match real business.category values. Labels reuse businessSetup.cat.*.
const CONSUMER_CATEGORY_KEYS = ["restaurant", "cafe", "bakery", "retail", "salon", "gym", "services"] as const;

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useAuthSession();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const C = Colors[colorScheme];
  const selectedSurface = colorScheme === "dark" ? "#3B301F" : "#FFF3E0";
  const selectedBorder = colorScheme === "dark" ? "#6B4A1E" : "#FFD59A";
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");

  const [locationMode, setLocationMode] = useState<"gps" | "zip">("gps");
  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState<ConsumerRadiusMiles>(DEFAULT_RADIUS_MILES);
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [step, setStep] = useState<"setup" | "shops">("setup");
  const [nearbyShops, setNearbyShops] = useState<{ id: string; name: string; location: string | null }[]>([]);
  const [selectedShopIds, setSelectedShopIds] = useState<string[]>([]);
  const [loadingShops, setLoadingShops] = useState(false);

  useEffect(() => {
    void getConsumerPreferences().then((p) => {
      if (p.zipCode.trim()) setZip(p.zipCode.trim());
      if (p.notificationPrefs.categoryTags?.length) setCategories(p.notificationPrefs.categoryTags);
    });
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      router.replace("/auth-landing");
    }
  }, [session?.user?.id, router]);

  // Step 1 → 2: persist location, then load a few nearby shops to favorite.
  async function goToShops(coords: { lat: number; lng: number }) {
    await setConsumerRadiusMiles(radius);
    await setLastKnownConsumerCoords(coords.lat, coords.lng);
    setStep("shops");
    void loadNearbyShops(coords);
  }

  async function loadNearbyShops(coords: { lat: number; lng: number }) {
    setLoadingShops(true);
    try {
      let shops: { id: string; name: string; location: string | null }[] = [];
      const { data, error } = await supabase.rpc("nearby_businesses", {
        p_lat: coords.lat,
        p_lng: coords.lng,
        p_radius_miles: radius,
        p_limit: 12,
        p_offset: 0,
        p_favorite_ids: [],
      });
      if (!error && Array.isArray(data) && data.length > 0) {
        shops = (data as { id: string; name: string; location: string | null }[]).map((r) => ({
          id: r.id,
          name: r.name,
          location: r.location,
        }));
      } else {
        // Fallback if the RPC isn't deployed yet: first page of shops.
        const { data: biz } = await supabase
          .from("businesses")
          .select("id,name,location")
          .order("name", { ascending: true })
          .limit(12);
        shops = (biz ?? []) as { id: string; name: string; location: string | null }[];
      }
      setNearbyShops(shops);
    } catch {
      setNearbyShops([]);
    } finally {
      setLoadingShops(false);
    }
  }

  function toggleShop(id: string) {
    setSelectedShopIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  // Step 2 → done: write favorites, save prefs, finish onboarding.
  async function handleFinish() {
    setBusy(true);
    try {
      const uid = session?.user?.id;
      if (uid && selectedShopIds.length > 0) {
        const { error } = await supabase
          .from("favorites")
          .insert(selectedShopIds.map((bid) => ({ user_id: uid, business_id: bid })));
        if (error && __DEV__) console.warn("[onboarding] favorites insert:", error.message);
      }
      await setConsumerNotificationPrefs({
        v: 1,
        mode: "all_nearby",
        ...(categories.length ? { categoryTags: categories } : {}),
      });
      await setOnboardingComplete(true);
      router.replace("/(tabs)");
    } catch (err) {
      if (__DEV__) console.warn("[onboarding] finish error:", err);
      await setOnboardingComplete(true);
      router.replace("/(tabs)");
    } finally {
      setBusy(false);
    }
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
        await goToShops({ lat: pos.coords.latitude, lng: pos.coords.longitude });
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
        await goToShops({ lat: geo.lat, lng: geo.lng });
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
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3, color: C.text }}>
        {step === "setup" ? t("onboarding.locationTitle") : t("onboarding.shopsTitle")}
      </Text>
      <Text style={{ marginTop: Spacing.sm, fontSize: 15, lineHeight: 22, color: C.mutedText }}>
        {step === "setup" ? t("onboarding.subtitle") : t("onboarding.shopsSubtitle")}
      </Text>

      {hint ? (
        <Text style={{ marginTop: Spacing.md, color: "#b45309", fontSize: 14, lineHeight: 20 }}>{hint}</Text>
      ) : null}

      {step === "setup" ? (
      <ScrollView
        style={{ flex: 1, marginTop: Spacing.lg }}
        contentContainerStyle={{ paddingBottom: scrollBottom + Spacing.xxxl, gap: Spacing.lg }}
        {...FORM_SCROLL_KEYBOARD_PROPS}
        showsVerticalScrollIndicator={false}
      >
        {/* Location mode toggle */}
        <View>
          <Text style={{ fontWeight: "700", marginBottom: 4, color: C.text }}>
            {t("onboarding.locationChoice", { defaultValue: "Choose your location method" })}
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: C.mutedText, marginBottom: Spacing.sm }}>
            {t("onboarding.locationBody")}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={() => { setLocationMode("gps"); setHint(null); }}
              style={{
                flex: 1, paddingVertical: Spacing.md, borderRadius: Radii.lg, alignItems: "center",
                borderWidth: 2, borderColor: locationMode === "gps" ? C.primary : C.border,
                backgroundColor: locationMode === "gps" ? selectedSurface : C.surface,
              }}
            >
              <Text style={{ fontWeight: "700", color: locationMode === "gps" ? C.accentText : C.text }}>{t("onboarding.useGps")}</Text>
            </Pressable>
            <Pressable
              onPress={() => { setLocationMode("zip"); setHint(null); }}
              style={{
                flex: 1, paddingVertical: Spacing.md, borderRadius: Radii.lg, alignItems: "center",
                borderWidth: 2, borderColor: locationMode === "zip" ? C.primary : C.border,
                backgroundColor: locationMode === "zip" ? selectedSurface : C.surface,
              }}
            >
              <Text style={{ fontWeight: "700", color: locationMode === "zip" ? C.accentText : C.text }}>{t("onboarding.useZipInstead")}</Text>
            </Pressable>
          </View>
        </View>

        {/* ZIP input (shown only in zip mode) */}
        {locationMode === "zip" ? (
          <View>
            <Text style={{ fontWeight: "700", marginBottom: 4, color: C.text }}>{t("onboarding.zipTitle")}</Text>
            <Text style={{ fontSize: 13, lineHeight: 19, color: C.mutedText, marginBottom: Spacing.sm }}>
              {t("onboarding.zipBody")}
            </Text>
            <TextInput
              value={zip}
              onChangeText={(value) => setZip(sanitizeZipInput(value))}
              placeholder={t("onboarding.zipPlaceholder")}
              placeholderTextColor={C.mutedText}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              returnKeyType="done"
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
          <Text style={{ fontWeight: "700", marginBottom: 4, color: C.text }}>{t("onboarding.radiusTitle")}</Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: C.mutedText, marginBottom: Spacing.sm }}>
            {t("onboarding.radiusBody")}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm }}>
            {CONSUMER_RADIUS_MILES_OPTIONS.map((m) => {
              const active = radius === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setRadius(m)}
                  style={{
                    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radii.pill,
                    backgroundColor: active ? selectedSurface : C.surfaceMuted,
                    borderWidth: 1, borderColor: active ? selectedBorder : C.border,
                  }}
                >
                  <Text style={{ fontWeight: "700", color: active ? C.accentText : C.text }}>
                    {t("onboarding.radiusMiles", { miles: m })}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Favorite categories (optional) — surfaced first in the feed */}
        <View>
          <Text style={{ fontWeight: "700", marginBottom: 4, color: C.text }}>{t("onboarding.categoriesTitle")}</Text>
          <Text style={{ fontSize: 13, color: C.mutedText, marginBottom: Spacing.sm }}>{t("onboarding.categoriesHint")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm }}>
            {CONSUMER_CATEGORY_KEYS.map((key) => {
              const active = categories.includes(key);
              return (
                <Pressable
                  key={key}
                  onPress={() => setCategories((prev) => (active ? prev.filter((c) => c !== key) : [...prev, key]))}
                  style={{
                    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radii.pill,
                    backgroundColor: active ? selectedSurface : C.surfaceMuted,
                    borderWidth: 1, borderColor: active ? selectedBorder : C.border,
                  }}
                >
                  <Text style={{ fontWeight: "700", color: active ? C.accentText : C.text }}>
                    {t(`businessSetup.cat.${key}`)}
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
      ) : (
      <ScrollView
        style={{ flex: 1, marginTop: Spacing.lg }}
        contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        {loadingShops ? (
          <View style={{ paddingVertical: Spacing.xl, alignItems: "center" }}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : nearbyShops.length === 0 ? (
          <Text style={{ color: C.mutedText, fontSize: 14, lineHeight: 20 }}>{t("onboarding.shopsEmpty")}</Text>
        ) : (
          nearbyShops.map((shop) => {
            const selected = selectedShopIds.includes(shop.id);
            return (
              <Pressable
                key={shop.id}
                onPress={() => toggleShop(shop.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={{
                  flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingVertical: Spacing.md, paddingHorizontal: Spacing.md, borderRadius: Radii.lg,
                  borderWidth: 2, borderColor: selected ? C.primary : C.border,
                  backgroundColor: selected ? selectedSurface : C.surface,
                }}
              >
                <View style={{ flex: 1, paddingRight: Spacing.sm }}>
                  <Text style={{ fontWeight: "700", color: C.text }} numberOfLines={1}>{shop.name}</Text>
                  {shop.location ? (
                    <Text style={{ fontSize: 13, color: C.mutedText }} numberOfLines={1}>{shop.location}</Text>
                  ) : null}
                </View>
                <Text style={{ fontSize: 20, fontWeight: "800", color: selected ? C.accentText : C.mutedText }}>
                  {selected ? "♥" : "♡"}
                </Text>
              </Pressable>
            );
          })
        )}

        <PrimaryButton
          title={busy ? t("consumerProfile.saving") : t("onboarding.shopsDone")}
          onPress={() => void handleFinish()}
          disabled={busy}
        />
        <Pressable
          onPress={() => void handleFinish()}
          disabled={busy}
          style={{ alignItems: "center", paddingVertical: Spacing.sm }}
        >
          <Text style={{ color: C.mutedText, fontWeight: "600" }}>{t("onboarding.shopsSkip")}</Text>
        </Pressable>
      </ScrollView>
      )}
    </View>
    </KeyboardScreen>
  );
}
