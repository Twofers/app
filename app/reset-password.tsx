import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { supabase } from "@/lib/supabase";
import { friendlyAuthError, friendlyAuthMessage } from "@/lib/auth-error-messages";
import { PASSWORD_MIN_LENGTH, validateNewPasswordPair } from "@/lib/auth-password-recovery";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors } from "@/constants/theme";
import { Banner } from "@/components/ui/banner";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "@/components/ui/primary-button";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useColorScheme } from "@/hooks/use-color-scheme";

type SessionCheck = "unknown" | "ok" | "missing";

export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const { session, isInitialLoading: authLoading } = useAuthSession();
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionCheck, setSessionCheck] = useState<SessionCheck>("unknown");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    setSessionCheck(session ? "ok" : "missing");
  }, [authLoading, session]);

  async function onSubmit() {
    const v = validateNewPasswordPair(password, confirm, PASSWORD_MIN_LENGTH);
    if (!v.ok) {
      if (v.key === "required") setError(t("passwordRecovery.errPasswordRequired"));
      else if (v.key === "mismatch") setError(t("passwordRecovery.errPasswordMismatch"));
      else setError(t("passwordRecovery.errPasswordMin", { min: PASSWORD_MIN_LENGTH }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: upd } = await supabase.auth.updateUser({ password });
      if (upd) {
        // Translate Supabase auth errors (rate-limited, invalid creds, network) so the
        // owner doesn't see "AuthApiError: Email rate limit exceeded" at 7am Saturday.
        setError(friendlyAuthError(upd, t));
        return;
      }
      setSuccess(true);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "";
      setError(raw ? friendlyAuthMessage(raw, t) : t("passwordRecovery.resetGenericError"));
    } finally {
      setBusy(false);
    }
  }

  if (sessionCheck === "unknown") {
    return (
      <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, justifyContent: "center", backgroundColor: theme.background }}>
        <Text style={{ opacity: 0.7, color: theme.text }}>{t("passwordRecovery.checkingSession")}</Text>
      </View>
    );
  }

  if (sessionCheck === "missing" && !success) {
    return (
      <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, backgroundColor: theme.background }}>
        <Banner message={t("passwordRecovery.invalidSession")} tone="error" />
        <PrimaryButton
          title={t("passwordRecovery.backToSignIn")}
          onPress={() => router.replace("/auth-landing")}
          style={{ marginTop: Spacing.lg }}
        />
        <View style={{ marginTop: Spacing.xl, gap: Spacing.sm }}>
          <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.68, color: theme.text }}>{t("legal.sectionTitle")}</Text>
          <LegalExternalLinks />
        </View>
      </View>
    );
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
          {t("passwordRecovery.resetSubtitle")}
        </Text>

        {success ? (
          <View style={{ marginTop: Spacing.xl }}>
            <Banner message={t("passwordRecovery.resetSuccess")} tone="success" />
            <PrimaryButton
              title={t("passwordRecovery.continueToApp")}
              onPress={() => router.replace("/(tabs)")}
              style={{ marginTop: Spacing.lg }}
            />
          </View>
        ) : (
          <View style={{ marginTop: Spacing.xl, gap: Spacing.md }}>
            {error ? <Banner message={error} tone="error" /> : null}
            <View>
              <Text style={{ fontWeight: "600", color: theme.text }}>{t("passwordRecovery.newPassword")}</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
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
            <View>
              <Text style={{ fontWeight: "600", color: theme.text }}>{t("passwordRecovery.confirmPassword")}</Text>
              <TextInput
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoCapitalize="none"
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
            <Text style={{ fontSize: 13, opacity: 0.55, color: theme.text }}>{t("passwordRecovery.passwordRulesHint", { min: PASSWORD_MIN_LENGTH })}</Text>
            <PrimaryButton
              title={busy ? t("passwordRecovery.saving") : t("passwordRecovery.saveNewPassword")}
              onPress={() => void onSubmit()}
              disabled={busy}
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
