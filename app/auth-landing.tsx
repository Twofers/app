import { useEffect, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { isDemoAuthHelperEnabled } from "@/lib/runtime-env";
import { Spacing } from "@/lib/screen-layout";
import type { AppLocale } from "@/lib/i18n/config";
import { setUiLocalePreference } from "@/lib/locale/ui-locale-storage";
import { LegalExternalLinks } from "@/components/legal-external-links";

export default function AuthLandingScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        router.replace("/(tabs)" as Href);
      }
    });
  }, [router]);

  async function chooseAppLocale(locale: AppLocale) {
    await setUiLocalePreference(locale, { manual: true });
    await i18n.changeLanguage(locale);
  }

  async function signUp() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password: pw,
      });
      if (error) throw error;
      Alert.alert(t("auth.alertSignUpSuccessTitle"), t("auth.alertSignUpSuccessMsg"));
    } catch (e: any) {
      Alert.alert(t("auth.alertSignUpFailTitle"), e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(overrideEmail?: string, overridePw?: string) {
    setBusy(true);
    try {
      const demoEmail = "demo@demo.com";
      const demoPassword = "demo12345";
      const emailToUse = (overrideEmail ?? email).trim();
      const pwToUse = overridePw ?? pw;
      const isDemo = emailToUse.toLowerCase() === demoEmail;

      const { error } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password: pwToUse,
      });

      if (error) {
        const msg = String(error.message || "");
        const canAutoSignUp =
          isDemoAuthHelperEnabled() &&
          isDemo &&
          (msg.includes("Invalid login credentials") || msg.toLowerCase().includes("user not found"));

        if (canAutoSignUp) {
          const { error: signUpError } = await supabase.auth.signUp({
            email: demoEmail,
            password: demoPassword,
          });
          if (signUpError) throw signUpError;

          const { error: retryError } = await supabase.auth.signInWithPassword({
            email: demoEmail,
            password: demoPassword,
          });
          if (retryError) throw retryError;
        } else {
          throw error;
        }
      }

      router.replace("/(tabs)" as Href);
    } catch (e: any) {
      Alert.alert(t("auth.alertLoginFailTitle"), e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const heroSize = Math.min(220, Math.max(160, winH * 0.22));

  return (
    <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
      <View
        style={{
          position: "absolute",
          bottom: -winH * 0.02,
          right: -Spacing.lg,
          opacity: 0.14,
          pointerEvents: "none",
        }}
      >
        <Image
          source={require("../assets/images/splash-icon.png")}
          style={{ width: winH * 0.55, height: winH * 0.55 }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xxl,
          paddingHorizontal: Spacing.lg,
        }}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginBottom: Spacing.lg }}>
          <Text style={{ fontSize: 13, fontWeight: "600", opacity: 0.5, alignSelf: "center" }}>
            {t("authLanding.languageLabel")}
          </Text>
          {(["en", "es", "ko"] as const).map((loc) => (
            <Pressable
              key={loc}
              onPress={() => chooseAppLocale(loc)}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: i18n.language === loc ? "#111" : "#f0f0f0",
              }}
            >
              <Text style={{ color: i18n.language === loc ? "#fff" : "#111", fontWeight: "600", fontSize: 13 }}>
                {loc === "en" ? t("language.english") : loc === "es" ? t("language.spanish") : t("language.korean")}
              </Text>
            </Pressable>
          ))}
        </View>

        <Image
          source={require("../assets/images/splash-icon.png")}
          style={{ width: heroSize, height: heroSize, alignSelf: "center", marginBottom: Spacing.md }}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel={t("authLanding.heroA11y")}
        />

        <Text
          style={{
            fontSize: 32,
            fontWeight: "800",
            letterSpacing: -0.8,
            textAlign: "center",
            color: "#111",
          }}
        >
          {t("authLanding.title")}
        </Text>
        <Text
          style={{
            marginTop: Spacing.sm,
            fontSize: 16,
            lineHeight: 24,
            textAlign: "center",
            opacity: 0.62,
            color: "#27272a",
            paddingHorizontal: Spacing.sm,
          }}
        >
          {t("authLanding.subtitle")}
        </Text>

        <View
          style={{
            flexDirection: "row",
            marginTop: Spacing.xl,
            marginBottom: Spacing.lg,
            borderRadius: 14,
            backgroundColor: "#f4f4f5",
            padding: 4,
          }}
        >
          <Pressable
            onPress={() => setMode("login")}
            style={{
              flex: 1,
              paddingVertical: Spacing.md,
              borderRadius: 12,
              backgroundColor: mode === "login" ? "#fff" : "transparent",
              alignItems: "center",
              shadowColor: mode === "login" ? "#000" : "transparent",
              shadowOpacity: mode === "login" ? 0.06 : 0,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              elevation: mode === "login" ? 2 : 0,
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 15, color: "#111" }}>{t("auth.logIn")}</Text>
          </Pressable>
          <Pressable
            onPress={() => setMode("signup")}
            style={{
              flex: 1,
              paddingVertical: Spacing.md,
              borderRadius: 12,
              backgroundColor: mode === "signup" ? "#fff" : "transparent",
              alignItems: "center",
              shadowColor: mode === "signup" ? "#000" : "transparent",
              shadowOpacity: mode === "signup" ? 0.06 : 0,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              elevation: mode === "signup" ? 2 : 0,
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 15, color: "#111" }}>{t("authLanding.createAccount")}</Text>
          </Pressable>
        </View>

        <Text style={{ fontWeight: "600", fontSize: 14, color: "#374151" }}>{t("auth.email")}</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          style={{
            borderWidth: 1,
            borderColor: "#e5e7eb",
            borderRadius: 12,
            padding: Spacing.md,
            marginTop: 6,
            fontSize: 16,
            backgroundColor: "#fff",
          }}
        />

        <Text style={{ fontWeight: "600", fontSize: 14, color: "#374151", marginTop: Spacing.md }}>{t("auth.password")}</Text>
        <TextInput
          value={pw}
          onChangeText={setPw}
          secureTextEntry
          style={{
            borderWidth: 1,
            borderColor: "#e5e7eb",
            borderRadius: 12,
            padding: Spacing.md,
            marginTop: 6,
            fontSize: 16,
            backgroundColor: "#fff",
          }}
        />

        <Pressable
          onPress={() => router.push("/forgot-password" as Href)}
          style={{ alignSelf: "flex-start", marginTop: Spacing.md, paddingVertical: 4 }}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: "#2563eb" }}>{t("passwordRecovery.forgotLink")}</Text>
        </Pressable>

        {mode === "login" ? (
          <Pressable
            disabled={busy}
            onPress={() => void signIn()}
            style={{
              marginTop: Spacing.lg,
              padding: Spacing.md + 2,
              borderRadius: 14,
              backgroundColor: "#111",
              opacity: busy ? 0.65 : 1,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "800", textAlign: "center", fontSize: 16 }}>{t("auth.logIn")}</Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={busy}
            onPress={() => void signUp()}
            style={{
              marginTop: Spacing.lg,
              padding: Spacing.md + 2,
              borderRadius: 14,
              backgroundColor: "#1d4ed8",
              opacity: busy ? 0.65 : 1,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "800", textAlign: "center", fontSize: 16 }}>{t("auth.signUp")}</Text>
          </Pressable>
        )}

        {isDemoAuthHelperEnabled() ? (
          <Pressable
            disabled={busy}
            onPress={async () => {
              await signIn("demo@demo.com", "demo12345");
            }}
            style={{
              marginTop: Spacing.md,
              padding: Spacing.md + 2,
              borderRadius: 14,
              backgroundColor: "#fafafa",
              borderWidth: 1,
              borderColor: "#e4e4e7",
            }}
          >
            <Text style={{ color: "#18181b", fontWeight: "700", textAlign: "center", fontSize: 15 }}>
              {t("auth.demoLogin")}
            </Text>
            <Text style={{ textAlign: "center", fontSize: 12, opacity: 0.55, marginTop: 4 }}>
              {t("authLanding.demoHint")}
            </Text>
          </Pressable>
        ) : null}

        <View style={{ marginTop: Spacing.xl, gap: Spacing.sm }}>
          <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.68, textAlign: "center" }}>{t("legal.authFooterHint")}</Text>
          <LegalExternalLinks align="center" />
        </View>
      </ScrollView>
    </View>
  );
}
