import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { PASSWORD_MIN_LENGTH, validateNewPasswordPair } from "@/lib/auth-password-recovery";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Banner } from "@/components/ui/banner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";

type SessionCheck = "unknown" | "ok" | "missing";

export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionCheck, setSessionCheck] = useState<SessionCheck>("unknown");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSessionCheck(data.session ? "ok" : "missing");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        setError(upd.message || t("passwordRecovery.resetGenericError"));
        return;
      }
      setSuccess(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("passwordRecovery.resetGenericError"));
    } finally {
      setBusy(false);
    }
  }

  if (sessionCheck === "unknown") {
    return (
      <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, justifyContent: "center" }}>
        <Text style={{ opacity: 0.7 }}>{t("passwordRecovery.checkingSession")}</Text>
      </View>
    );
  }

  if (sessionCheck === "missing" && !success) {
    return (
      <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
        <Banner message={t("passwordRecovery.invalidSession")} tone="error" />
        <PrimaryButton
          title={t("passwordRecovery.backToSignIn")}
          onPress={() => router.replace("/(tabs)/account")}
          style={{ marginTop: Spacing.lg }}
        />
        <View style={{ marginTop: Spacing.xl, gap: Spacing.sm }}>
          <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.68 }}>{t("legal.sectionTitle")}</Text>
          <LegalExternalLinks />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: scrollBottom }}
      >
        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("passwordRecovery.resetTitle")}</Text>
        <Text style={{ marginTop: Spacing.sm, opacity: 0.72, fontSize: 15, lineHeight: 22 }}>
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
              <Text style={{ fontWeight: "600" }}>{t("passwordRecovery.newPassword")}</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                editable={!busy}
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 12,
                  padding: 12,
                  marginTop: 6,
                  fontSize: 16,
                }}
              />
            </View>
            <View>
              <Text style={{ fontWeight: "600" }}>{t("passwordRecovery.confirmPassword")}</Text>
              <TextInput
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoCapitalize="none"
                editable={!busy}
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 12,
                  padding: 12,
                  marginTop: 6,
                  fontSize: 16,
                }}
              />
            </View>
            <Text style={{ fontSize: 13, opacity: 0.55 }}>{t("passwordRecovery.passwordRulesHint", { min: PASSWORD_MIN_LENGTH })}</Text>
            <PrimaryButton
              title={busy ? t("passwordRecovery.saving") : t("passwordRecovery.saveNewPassword")}
              onPress={() => void onSubmit()}
              disabled={busy}
            />
            <Pressable onPress={() => router.back()} disabled={busy} style={{ paddingVertical: Spacing.sm }}>
              <Text style={{ fontWeight: "600", opacity: 0.65, textAlign: "center" }}>{t("commonUi.goBack")}</Text>
            </Pressable>
            <View style={{ marginTop: Spacing.xl, gap: Spacing.sm }}>
              <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.68 }}>{t("legal.sectionTitle")}</Text>
              <LegalExternalLinks />
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
