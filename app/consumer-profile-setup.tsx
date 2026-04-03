import { useEffect, useState } from "react";
import { Platform, ScrollView, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { PrimaryButton } from "@/components/ui/primary-button";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { Banner } from "@/components/ui/banner";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import {
  fetchConsumerProfile,
  isConsumerProfileComplete,
  isValidBirthdateIso,
  upsertConsumerProfile,
} from "@/lib/consumer-profile";
import { getConsumerPreferences } from "@/lib/consumer-preferences";

function defaultBirthDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 25);
  d.setHours(12, 0, 0, 0);
  return d;
}

function parseIsoToLocalDate(iso: string): Date | null {
  if (!isValidBirthdateIso(iso)) return null;
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, day!, 12, 0, 0, 0);
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function ConsumerProfileSetupScreen() {
  const { t } = useTranslation();
  const { session, isInitialLoading: authLoading } = useAuthSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ edit?: string }>();
  const isEdit = params.edit === "1" || params.edit === "true";
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const C = Colors[colorScheme];
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const [email, setEmail] = useState<string | null>(null);
  const [zip, setZip] = useState("");
  const [birthDate, setBirthDate] = useState(defaultBirthDate);
  const [showPicker, setShowPicker] = useState(Platform.OS === "ios");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    void (async () => {
      const uid = session?.user?.id;
      if (!uid) {
        router.replace("/auth-landing");
        return;
      }
      if (cancelled) return;
      setEmail(session.user.email ?? null);
      const row = await fetchConsumerProfile(uid);
      if (row) {
        setZip(row.zip_code ?? "");
        const parsed = row.birthdate ? parseIsoToLocalDate(row.birthdate) : null;
        if (parsed) setBirthDate(parsed);
        if (isConsumerProfileComplete(row) && !isEdit) {
          const prefs = await getConsumerPreferences();
          router.replace(prefs.onboardingComplete ? "/(tabs)" : "/onboarding");
          return;
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, isEdit, session, authLoading]);

  async function onContinue() {
    setBanner(null);
    const z = zip.trim();
    if (!z) {
      setBanner({ message: t("consumerProfile.errZip"), tone: "error" });
      return;
    }
    const iso = toIsoDate(birthDate);
    if (!isValidBirthdateIso(iso)) {
      setBanner({ message: t("consumerProfile.errBirthdate"), tone: "error" });
      return;
    }
    const uid = session?.user?.id;
    if (!uid) {
      setBanner({ message: t("consumerProfile.errLogin"), tone: "error" });
      return;
    }
    setBusy(true);
    try {
      const { error } = await upsertConsumerProfile({
        userId: uid,
        zipCode: z,
        birthdate: iso,
      });
      if (error) {
        if (error.message === "BIRTHDATE_INVALID") {
          setBanner({ message: t("consumerProfile.errBirthdate"), tone: "error" });
          return;
        }
        if (error.message === "ZIP_FORMAT_INVALID") {
          setBanner({ message: t("consumerProfile.errZipInvalid"), tone: "error" });
          return;
        }
        throw error;
      }
      if (isEdit) {
        router.replace("/(tabs)/settings");
      } else {
        const prefs = await getConsumerPreferences();
        router.replace(prefs.onboardingComplete ? "/(tabs)" : "/onboarding");
      }
    } catch (e: unknown) {
      setBanner({ message: e instanceof Error ? e.message : t("consumerProfile.errSave"), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, justifyContent: "center", backgroundColor: C.background }}>
        <Text style={{ color: C.mutedText }}>{t("consumerProfile.loading")}</Text>
      </View>
    );
  }

  return (
    <KeyboardScreen>
    {/* FIX: Added theme colors (C.text, C.mutedText, C.background) for dark mode support */}
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, backgroundColor: C.background }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3, color: C.text }}>
        {isEdit ? t("consumerProfile.editTitle") : t("consumerProfile.title")}
      </Text>
      <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, fontSize: 15, lineHeight: 22, color: C.mutedText }}>
        {isEdit ? t("consumerProfile.editSubtitle") : t("consumerProfile.subtitle")}
      </Text>
      {email ? (
        <Text style={{ marginBottom: Spacing.md, fontSize: 14, color: C.mutedText }}>
          {t("consumerProfile.signedInAs", { email })}
        </Text>
      ) : null}
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.lg }}
        {...FORM_SCROLL_KEYBOARD_PROPS}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={{ fontWeight: "700", marginBottom: 6, color: C.text }}>{t("consumerProfile.zipLabel")}</Text>
          {/* FIX: Changed keyboardType to number-pad and autoCapitalize to none for ZIP */}
          <TextInput
            value={zip}
            onChangeText={setZip}
            placeholder={t("consumerProfile.zipPh")}
            placeholderTextColor={C.mutedText}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            maxLength={12}
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
        </View>

        <View>
          <Text style={{ fontWeight: "700", marginBottom: Spacing.sm, color: C.text }}>{t("consumerProfile.birthdateTitle")}</Text>
          <Text style={{ fontSize: 13, marginBottom: Spacing.sm, lineHeight: 18, color: C.mutedText }}>
            {t("consumerProfile.birthdateHint")}
          </Text>
          {Platform.OS === "android" ? (
            <Pressable
              onPress={() => setShowPicker(true)}
              style={{
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: Radii.lg,
                paddingVertical: Spacing.md,
                paddingHorizontal: Spacing.md,
                backgroundColor: C.surface,
              }}
            >
              {/* FIX: Show human-readable date instead of raw ISO "2001-03-26" */}
              <Text style={{ fontSize: 16, fontWeight: "600", color: C.text }}>
                {birthDate.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
              </Text>
            </Pressable>
          ) : null}
          {showPicker ? (
            <DateTimePicker
              value={birthDate}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              maximumDate={new Date()}
              minimumDate={new Date(1900, 0, 1)}
              onChange={(_, d) => {
                if (Platform.OS === "android") setShowPicker(false);
                if (d) setBirthDate(d);
              }}
            />
          ) : null}
        </View>

        <PrimaryButton
          title={busy ? t("consumerProfile.saving") : t("consumerProfile.continue")}
          onPress={() => void onContinue()}
          disabled={busy}
        />
      </ScrollView>
    </View>
    </KeyboardScreen>
  );
}
