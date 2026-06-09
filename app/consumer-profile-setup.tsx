import { useEffect, useState } from "react";
import { Modal, Platform, ScrollView, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { PrimaryButton } from "@/components/ui/primary-button";
import {
  FORM_SCROLL_KEYBOARD_PROPS,
  IOS_DONE_INPUT_ACCESSORY_ID,
  IosDoneInputAccessory,
  KeyboardScreen,
} from "@/components/ui/keyboard-screen";
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
import { sanitizeUsZipInput, US_ZIP_MAX_LENGTH } from "@/lib/us-zip";

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
  const [draftBirthDate, setDraftBirthDate] = useState(defaultConsumerBirthdate);
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
        setZip(sanitizeUsZipInput(row.zip_code ?? ""));
        const parsed = row.birthdate ? parseBirthdateIsoToLocalDate(row.birthdate) : null;
        if (parsed) {
          setBirthDate(parsed);
          setDraftBirthDate(parsed);
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
    const current = birthDate.getTime() > maximumBirthDate.getTime() ? maximumBirthDate : birthDate;
    if (Platform.OS === "ios") {
      setDraftBirthDate(current);
      setShowPicker(true);
      return;
    }
    setBirthDate(current);
    setShowPicker((visible) => !visible);
  }

  function cancelIosBirthdatePicker() {
    setDraftBirthDate(birthDate);
    setShowPicker(false);
  }

  function confirmIosBirthdatePicker() {
    const next = draftBirthDate.getTime() > maximumBirthDate.getTime() ? maximumBirthDate : draftBirthDate;
    setBirthDate(next);
    setDraftBirthDate(next);
    setBirthdateTouched(true);
    setShowPicker(false);
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
            onChangeText={(value) => setZip(sanitizeUsZipInput(value))}
            placeholder={t("consumerProfile.zipPh")}
            placeholderTextColor={C.mutedText}
            autoCapitalize="none"
            autoComplete="postal-code"
            autoCorrect={false}
            inputAccessoryViewID={IOS_DONE_INPUT_ACCESSORY_ID}
            keyboardType="number-pad"
            textContentType="postalCode"
            returnKeyType="done"
            maxLength={US_ZIP_MAX_LENGTH}
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
          <IosDoneInputAccessory />
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
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: Spacing.sm, flexWrap: "wrap" }}>
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
            <Text
              style={{ fontSize: 16, fontWeight: "600", color: birthdateTouched ? C.text : C.mutedText }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              maxFontSizeMultiplier={1.15}
            >
              {birthdateTouched
                ? birthDate.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
                : t("consumerProfile.addBirthdate", { defaultValue: "Add birthday" })}
            </Text>
          </Pressable>
          {showPicker && Platform.OS !== "ios" ? (
            <DateTimePicker
              value={birthDate}
              mode="date"
              display="default"
              maximumDate={maximumBirthDate}
              minimumDate={new Date(1900, 0, 1)}
              onChange={(event, d) => {
                setShowPicker(false);
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
      <Modal
        visible={showPicker && Platform.OS === "ios"}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        accessibilityViewIsModal
        onRequestClose={cancelIosBirthdatePicker}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.28)" }}>
          <View
            style={{
              borderTopLeftRadius: Radii.xl,
              borderTopRightRadius: Radii.xl,
              backgroundColor: C.surface,
              paddingTop: Spacing.sm,
              paddingHorizontal: horizontal,
              paddingBottom: scrollBottom,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: Spacing.sm,
              }}
            >
              <Pressable
                accessibilityRole="button"
                onPress={cancelIosBirthdatePicker}
                style={{ minHeight: 44, justifyContent: "center", paddingRight: Spacing.md }}
              >
                <Text style={{ color: C.mutedText, fontSize: 16, fontWeight: "700" }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                  {t("commonUi.cancel")}
                </Text>
              </Pressable>
              <Text
                style={{ color: C.text, fontSize: 16, fontWeight: "800", flex: 1, textAlign: "center" }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                maxFontSizeMultiplier={1.15}
              >
                {t("consumerProfile.birthdateTitle")}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={confirmIosBirthdatePicker}
                style={{ minHeight: 44, justifyContent: "center", paddingLeft: Spacing.md }}
              >
                <Text style={{ color: C.primary, fontSize: 16, fontWeight: "800" }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                  {t("commonUi.done", { defaultValue: "Done" })}
                </Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={draftBirthDate}
              mode="date"
              display="spinner"
              textColor={C.text}
              themeVariant={colorScheme}
              style={{ height: 216, alignSelf: "stretch" }}
              maximumDate={maximumBirthDate}
              minimumDate={new Date(1900, 0, 1)}
              onChange={(_event, d) => {
                if (!d) return;
                setDraftBirthDate(d.getTime() > maximumBirthDate.getTime() ? maximumBirthDate : d);
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
    </KeyboardScreen>
  );
}
