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
  upsertConsumerProfile,
} from "@/lib/consumer-profile";
import {
  defaultConsumerBirthdate,
  latestValidBirthdate,
  parseBirthdateIsoToLocalDate,
  toBirthdateIso,
} from "@/lib/consumer-birthdate";
import { getConsumerPreferences } from "@/lib/consumer-preferences";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";

function sanitizeZipInput(raw: string): string {
  return raw.replace(/[^\d-]/g, "").slice(0, 10);
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
  const [birthDate, setBirthDate] = useState(defaultConsumerBirthdate);
  const [birthdateTouched, setBirthdateTouched] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" } | null>(null);
  const maximumBirthDate = latestValidBirthdate();

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
        const parsed = row.birthdate ? parseBirthdateIsoToLocalDate(row.birthdate) : null;
        if (parsed) {
          setBirthDate(parsed);
          setBirthdateTouched(true);
        }
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
    const uid = session?.user?.id;
    if (!uid) {
      setBanner({ message: t("consumerProfile.errLogin"), tone: "error" });
      return;
    }
    const iso = birthdateTouched ? toBirthdateIso(birthDate) : undefined;
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
      // Don't surface raw Postgres / RLS / JWT messages to a brand-new consumer.
      // Route through translateKnownApiMessage so DB and network errors render as
      // localized friendly text; fall back to the generic save-failed copy otherwise.
      const raw = e instanceof Error ? e.message : "";
      setBanner({
        message: raw ? translateKnownApiMessage(raw, t) : t("consumerProfile.errSave"),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  function openBirthdatePicker() {
    setBirthDate((current) => (current.getTime() > maximumBirthDate.getTime() ? maximumBirthDate : current));
    if (Platform.OS === "ios") setBirthdateTouched(true);
    setShowPicker((visible) => !visible);
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
        contentContainerStyle={{ paddingBottom: scrollBottom + Spacing.xxxl, gap: Spacing.lg }}
        {...FORM_SCROLL_KEYBOARD_PROPS}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={{ fontWeight: "700", marginBottom: 6, color: C.text }}>{t("consumerProfile.zipLabel")}</Text>
          <TextInput
            value={zip}
            onChangeText={(value) => setZip(sanitizeZipInput(value))}
            placeholder={t("consumerProfile.zipPh")}
            placeholderTextColor={C.mutedText}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            returnKeyType="done"
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
          <View
            style={{
              marginTop: Spacing.sm,
              borderRadius: Radii.lg,
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.surfaceMuted,
              padding: Spacing.md,
            }}
          >
            <Text style={{ fontSize: 13, lineHeight: 19, color: C.mutedText }}>
              {isEdit
                ? t("consumerProfile.zipWhyEdit", {
                    defaultValue:
                      "TWOFER uses your ZIP as a general area so nearby deals and alerts stay relevant. You can change your radius in Settings.",
                  })
                : t("consumerProfile.zipWhy", {
                    defaultValue:
                      "TWOFER uses your ZIP as a general area so nearby deals and alerts start relevant. You can choose your browsing radius next.",
                  })}
            </Text>
          </View>
        </View>

        <View>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: Spacing.sm }}>
            <Text style={{ fontWeight: "700", color: C.text }}>{t("consumerProfile.birthdateTitle")}</Text>
            <Text style={{ fontSize: 12, color: C.mutedText }}>({t("consumerProfile.birthdateOptional")})</Text>
          </View>
          <Text style={{ fontSize: 13, marginBottom: Spacing.sm, lineHeight: 18, color: C.mutedText }}>
            {t("consumerProfile.birthdateHint")}
          </Text>
          <Pressable
            onPress={openBirthdatePicker}
            accessibilityRole="button"
            accessibilityLabel={t("consumerProfile.birthdateTitle")}
            style={{
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: Radii.lg,
              paddingVertical: Spacing.md,
              paddingHorizontal: Spacing.md,
              backgroundColor: C.surface,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "600", color: birthdateTouched ? C.text : C.mutedText }}>
              {birthdateTouched
                ? birthDate.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
                : t("consumerProfile.addBirthdate", { defaultValue: "Add birthday" })}
            </Text>
          </Pressable>
          {showPicker ? (
            <DateTimePicker
              value={birthDate}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              maximumDate={maximumBirthDate}
              minimumDate={new Date(1900, 0, 1)}
              onChange={(event, d) => {
                if (Platform.OS === "android") setShowPicker(false);
                if (event.type === "dismissed" || !d) return;
                setBirthDate(d.getTime() > maximumBirthDate.getTime() ? maximumBirthDate : d);
                setBirthdateTouched(true);
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
