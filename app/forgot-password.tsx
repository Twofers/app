import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { getPasswordRecoveryRedirectUrl } from "@/lib/auth-password-recovery";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors } from "@/constants/theme";
import { Banner } from "@/components/ui/banner";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "@/components/ui/primary-button";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useColorScheme } from "@/hooks/use-color-scheme";

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) {
      setCooldownRemaining(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownRemaining(remaining);
      if (remaining <= 0 && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [cooldownUntil]);

  async function onSubmit() {
    const trimmed = email.trim();
    if (!trimmed) {
      setError(t("passwordRecovery.errEmailRequired"));
      return;
    }
    if (Date.now() < cooldownUntil) {
      setError(t("passwordRecovery.errCooldown", { defaultValue: "Please wait 60 seconds before requesting another email." }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: getPasswordRecoveryRedirectUrl(),
      });
      if (resetErr) {
        setError(t("passwordRecovery.requestGenericError"));
        return;
      }
      setSuccess(true);
      setCooldownUntil(Date.now() + 60_000);
    } catch {
      setError(t("passwordRecovery.requestGenericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardScreen style={{ backgroundColor: theme.background }}>
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, backgroundColor: theme.background }}>
      <ScrollView
        style={{ flex: 1 }}
        {...FORM_SCROLL_KEYBOARD_PROPS}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: scrollBottom }}
      >
        <Text style={{ opacity: 0.72, fontSize: 15, lineHeight: 22, color: theme.text }}>
          {t("passwordRecovery.forgotSubtitle")}
        </Text>

        {success ? (
          <View style={{ marginTop: Spacing.xl, gap: Spacing.lg }}>
            <Banner message={t("passwordRecovery.requestSuccess")} tone="success" />
            <PrimaryButton
              title={t("passwordRecovery.backToSignIn")}
              onPress={() => router.replace("/auth-landing")}
            />
            <View style={{ gap: Spacing.sm }}>
              <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.68, color: theme.text }}>{t("legal.sectionTitle")}</Text>
              <LegalExternalLinks />
            </View>
          </View>
        ) : (
          <View style={{ marginTop: Spacing.xl, gap: Spacing.md }}>
            {error ? <Banner message={error} tone="error" /> : null}
            <View>
              <Text style={{ fontWeight: "600", color: theme.text }}>{t("auth.email")}</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                editable={!busy}
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 12,
                  padding: 12,
                  marginTop: 6,
                  fontSize: 16,
                  color: theme.text,
                  backgroundColor: theme.surface,
                }}
              />
            </View>
            <PrimaryButton
              title={
                busy
                  ? t("passwordRecovery.sending")
                  : cooldownRemaining > 0
                    ? t("passwordRecovery.resendIn", { seconds: cooldownRemaining })
                    : t("passwordRecovery.submitRequest")
              }
              onPress={() => void onSubmit()}
              disabled={busy || cooldownRemaining > 0}
            />
            <Pressable onPress={() => router.replace("/auth-landing")} disabled={busy} style={{ paddingVertical: Spacing.sm }}>
              <Text style={{ fontWeight: "600", opacity: 0.65, textAlign: "center", color: theme.text }}>{t("passwordRecovery.backToSignIn")}</Text>
            </Pressable>
            <View style={{ marginTop: Spacing.xl, gap: Spacing.sm }}>
              <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.68, color: theme.text }}>{t("legal.sectionTitle")}</Text>
              <LegalExternalLinks />
            </View>
          </View>
        )}
      </ScrollView>
    </View>
    </KeyboardScreen>
  );
}
