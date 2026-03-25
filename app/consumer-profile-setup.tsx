import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { PrimaryButton } from "@/components/ui/primary-button";
import { Banner } from "@/components/ui/banner";
import { supabase } from "@/lib/supabase";
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
  const router = useRouter();
  const params = useLocalSearchParams<{ edit?: string }>();
  const isEdit = params.edit === "1" || params.edit === "true";
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const [email, setEmail] = useState<string | null>(null);
  const [zip, setZip] = useState("");
  const [birthDate, setBirthDate] = useState(defaultBirthDate);
  const [showPicker, setShowPicker] = useState(Platform.OS === "ios");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session?.user?.id) {
        router.replace("/(tabs)");
        return;
      }
      setEmail(session.user.email ?? null);
      const row = await fetchConsumerProfile(session.user.id);
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
  }, [router, isEdit]);

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
    const {
      data: { session },
    } = await supabase.auth.getSession();
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
      <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, justifyContent: "center" }}>
        <Text style={{ opacity: 0.7 }}>{t("consumerProfile.loading")}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>
        {isEdit ? t("consumerProfile.editTitle") : t("consumerProfile.title")}
      </Text>
      <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, opacity: 0.72, fontSize: 15, lineHeight: 22 }}>
        {isEdit ? t("consumerProfile.editSubtitle") : t("consumerProfile.subtitle")}
      </Text>
      {email ? (
        <Text style={{ marginBottom: Spacing.md, fontSize: 14, opacity: 0.75 }}>
          {t("consumerProfile.signedInAs", { email })}
        </Text>
      ) : null}
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.lg }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={{ fontWeight: "700", marginBottom: 6 }}>{t("consumerProfile.zipLabel")}</Text>
          <TextInput
            value={zip}
            onChangeText={setZip}
            placeholder={t("consumerProfile.zipPh")}
            autoCapitalize="characters"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            maxLength={12}
            style={{
              borderWidth: 1,
              borderColor: "#ddd",
              borderRadius: 12,
              paddingVertical: Spacing.sm,
              paddingHorizontal: Spacing.md,
              fontSize: 16,
            }}
          />
        </View>

        <View>
          <Text style={{ fontWeight: "700", marginBottom: Spacing.sm }}>{t("consumerProfile.birthdateTitle")}</Text>
          <Text style={{ opacity: 0.65, fontSize: 13, marginBottom: Spacing.sm, lineHeight: 18 }}>
            {t("consumerProfile.birthdateHint")}
          </Text>
          {Platform.OS === "android" ? (
            <Pressable
              onPress={() => setShowPicker(true)}
              style={{
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 12,
                paddingVertical: Spacing.md,
                paddingHorizontal: Spacing.md,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "600" }}>{toIsoDate(birthDate)}</Text>
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
  );
}
