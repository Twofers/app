import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { DEMO_PREVIEW_EMAIL } from "@/lib/demo-account";
import { ensureDemoCoffeePreview } from "@/lib/demo-preview-seed";
import { signInDemoPreviewUser } from "@/lib/demo-auth-signin";
import { friendlyAuthMessage, friendlyDemoAuthMessage } from "@/lib/auth-error-messages";
import { logAuthPath } from "@/lib/auth-path-log";
import { isDemoAuthHelperEnabled } from "@/lib/runtime-env";
import { Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import type { AppLocale } from "@/lib/i18n/config";
import { setUiLocalePreference } from "@/lib/locale/ui-locale-storage";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { springPressIn, springPressOut, triggerLightHaptic } from "@/lib/press-feedback";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function ScalePressable({
  onPress,
  disabled,
  style,
  children,
  accessibilityRole,
}: {
  onPress: () => void;
  disabled?: boolean;
  style?: any;
  children: ReactNode;
  accessibilityRole?: any;
}) {
  const scale = useSharedValue(1);
  const rStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      accessibilityRole={accessibilityRole ?? "button"}
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        if (disabled) return;
        triggerLightHaptic();
        scale.value = springPressIn();
      }}
      onPressOut={() => {
        scale.value = springPressOut();
      }}
      style={[style, rStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}

export default function AuthLandingScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();
  const nextHref = (typeof params.next === "string" && params.next.length > 0 ? params.next : "/(tabs)") as Href;
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [step, setStep] = useState<"landing" | "login" | "signup">("landing");

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        logAuthPath("session_restore", "redirect tabs");
        router.replace(nextHref);
      }
    });
  }, [router, nextHref]);

  async function chooseAppLocale(locale: AppLocale) {
    await setUiLocalePreference(locale, { manual: true });
    await i18n.changeLanguage(locale);
  }

  async function handleSignUp() {
    if (busy) return;
    const trimmed = email.trim();
    if (!trimmed || !pw) {
      Alert.alert(t("auth.alertSignUpFailTitle"), t("auth.errFieldsRequired"));
      return;
    }
    setBusy(true);
    logAuthPath("signup");
    try {
      const { error } = await supabase.auth.signUp({
        email: trimmed,
        password: pw,
      });
      if (error) throw error;
      Alert.alert(t("auth.alertSignUpSuccessTitle"), t("auth.alertSignUpSuccessMsg"));
    } catch (e: unknown) {
      const raw = e && typeof e === "object" && "message" in e ? String((e as { message?: string }).message) : String(e);
      Alert.alert(t("auth.alertSignUpFailTitle"), friendlyAuthMessage(raw, t));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogIn() {
    if (busy) return;
    const emailToUse = email.trim();
    const pwToUse = pw;
    if (!emailToUse || !pwToUse) {
      Alert.alert(t("auth.alertLoginFailTitle"), t("auth.errFieldsRequired"));
      return;
    }
    setBusy(true);
    logAuthPath("normal_login", emailToUse);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password: pwToUse,
      });
      if (error) {
        Alert.alert(t("auth.alertLoginFailTitle"), friendlyAuthMessage(error.message ?? "", t));
        return;
      }

      if (emailToUse.toLowerCase() === DEMO_PREVIEW_EMAIL) {
        await ensureDemoCoffeePreview(supabase);
      }

      router.replace(nextHref);
    } catch (e: unknown) {
      const raw = e && typeof e === "object" && "message" in e ? String((e as { message?: string }).message) : String(e);
      Alert.alert(t("auth.alertLoginFailTitle"), friendlyAuthMessage(raw, t));
    } finally {
      setBusy(false);
    }
  }

  async function handleDemoLogin() {
    if (busy || !isDemoAuthHelperEnabled()) return;
    setBusy(true);
    logAuthPath("demo_login");
    try {
      const result = await signInDemoPreviewUser();
      if (!result.ok) {
        Alert.alert(t("auth.alertLoginFailTitle"), friendlyDemoAuthMessage(result.message, t));
        return;
      }
      router.replace(nextHref);
    } catch (e: unknown) {
      const raw = e && typeof e === "object" && "message" in e ? String((e as { message?: string }).message) : String(e);
      Alert.alert(t("auth.alertLoginFailTitle"), friendlyDemoAuthMessage(raw, t));
    } finally {
      setBusy(false);
    }
  }

  const demoEnabled = isDemoAuthHelperEnabled();
  const canSubmitEmailAuth = !busy && email.trim().length > 0 && pw.length > 0;
  const wordmarkSize = Math.min(64, Math.max(50, Math.round(winH * 0.08)));

  return (
    <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
      {/* Subtle background accent illustration */}
      <View style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <Image
          source={require("../assets/images/splash-icon.png")}
          style={{
            position: "absolute",
            top: winH * 0.08,
            right: -Spacing.xxxl,
            width: winH * 0.52,
            height: winH * 0.52,
            opacity: 0.045,
            transform: [{ rotate: "10deg" }],
          }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: Math.max(insets.top, Spacing.md) + Spacing.md,
            paddingBottom: insets.bottom + Spacing.xxl,
            paddingHorizontal: Spacing.xxl,
          }}
        >
          {step === "landing" ? (
            <View style={{ flex: 1, justifyContent: "space-between", paddingTop: Spacing.md }}>
              <View style={{ alignItems: "center", gap: Spacing.md }}>
                <Image
                  source={require("../assets/images/splash-icon.png")}
                  style={{ width: 34, height: 34, opacity: 0.92 }}
                  resizeMode="contain"
                  accessibilityIgnoresInvertColors
                />
                <Text
                  style={{
                    fontSize: wordmarkSize,
                    fontWeight: "900",
                    letterSpacing: 0.8,
                    textAlign: "center",
                    color: "#ff9f1c",
                  }}
                >
                  TWOFER
                </Text>
              </View>

              <View
                style={{
                  marginTop: Spacing.xxxl,
                  backgroundColor: "#fff",
                  borderRadius: Radii.xl,
                  padding: Spacing.xxl,
                  boxShadow: "0px 10px 16px rgba(0,0,0,0.07)",
                  elevation: 4,
                }}
              >
                <Text
                  style={{
                    fontSize: 36,
                    lineHeight: 42,
                    textAlign: "center",
                    fontWeight: "900",
                    color: "#11181C",
                    letterSpacing: -0.6,
                  }}
                >
                  Welcome to Twofer
                </Text>
                <Text
                  style={{
                    marginTop: Spacing.md,
                    fontSize: 17,
                    lineHeight: 26,
                    textAlign: "center",
                    color: "rgba(17,24,28,0.74)",
                  }}
                >
                  Discover live time-limited BOGO deals from local coffee shops near you
                </Text>

                <View style={{ marginTop: Spacing.xxl, gap: Spacing.md }}>
                  <ScalePressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => {
                      setStep("signup");
                      setMode("signup");
                    }}
                    style={{
                      minHeight: 60,
                      borderRadius: Radii.lg,
                      backgroundColor: Colors.light.primary,
                      justifyContent: "center",
                      alignItems: "center",
                      boxShadow: "0px 4px 10px rgba(0,0,0,0.15)",
                      elevation: 3,
                      opacity: busy ? 0.65 : 1,
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 18, letterSpacing: 0.2 }}>Create Account</Text>
                  </ScalePressable>

                  <ScalePressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => {
                      setStep("login");
                      setMode("login");
                    }}
                    style={{
                      minHeight: 60,
                      borderRadius: Radii.lg,
                      backgroundColor: "#fff",
                      borderWidth: 2,
                      borderColor: Colors.light.primary,
                      justifyContent: "center",
                      alignItems: "center",
                      opacity: busy ? 0.65 : 1,
                    }}
                  >
                    <Text style={{ color: Colors.light.primary, fontWeight: "900", fontSize: 18, letterSpacing: 0.2 }}>Log In</Text>
                  </ScalePressable>
                </View>
              </View>

              <View style={{ alignItems: "center", gap: Spacing.md, marginTop: Spacing.xxxl }}>
                <Text style={{ fontSize: 12, color: "rgba(17,24,28,0.56)", textAlign: "center" }}>
                  English / Español / 한국어
                </Text>
                <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                  {(["en", "es", "ko"] as const).map((loc) => (
                    <HapticScalePressable
                      key={loc}
                      onPress={() => chooseAppLocale(loc)}
                      disabled={busy}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: 999,
                        backgroundColor: i18n.language === loc ? "rgba(255,159,28,0.16)" : "rgba(17,24,28,0.04)",
                        borderWidth: 1,
                        borderColor: i18n.language === loc ? "rgba(255,159,28,0.34)" : "rgba(17,24,28,0.08)",
                        opacity: busy ? 0.55 : 1,
                      }}
                    >
                      <Text style={{ color: "#11181C", fontWeight: "700", fontSize: 12 }}>
                        {loc === "en" ? t("language.english") : loc === "es" ? t("language.spanish") : t("language.korean")}
                      </Text>
                    </HapticScalePressable>
                  ))}
                </View>
              </View>
            </View>
          ) : (
            <View
              style={{
                marginTop: Spacing.xl,
                backgroundColor: "#ffffff",
                borderRadius: Radii.xl,
                padding: Spacing.xxl,
                boxShadow: "0px 5px 14px rgba(0,0,0,0.09)",
                elevation: 4,
              }}
            >
              <HapticScalePressable
                onPress={() => setStep("landing")}
                disabled={busy}
                style={{ alignSelf: "flex-start", marginBottom: Spacing.md, opacity: busy ? 0.5 : 1 }}
              >
                <Text style={{ fontSize: 14, fontWeight: "700", color: "rgba(17,24,28,0.6)" }}>{"< Back"}</Text>
              </HapticScalePressable>

              <Text style={{ fontSize: 28, fontWeight: "900", color: "#11181C", textAlign: "center" }}>
                {step === "signup" ? "Create Account" : "Log In"}
              </Text>
              <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.lg, textAlign: "center", color: "rgba(17,24,28,0.68)" }}>
                {step === "signup" ? "Start saving with fresh BOGO drops." : "Welcome back to Twofer."}
              </Text>

            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C" }}>{t("auth.email")}</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!busy}
            style={{
              borderWidth: 1,
              borderColor: "#e5e7eb",
              borderRadius: Radii.md,
              padding: Spacing.lg,
              marginTop: 6,
              fontSize: 16,
              backgroundColor: busy ? "#f9fafb" : "#fff",
              color: "#111",
            }}
          />

            <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C", marginTop: Spacing.md }}>{t("auth.password")}</Text>
          <TextInput
            value={pw}
            onChangeText={setPw}
            secureTextEntry
            editable={!busy}
            style={{
              borderWidth: 1,
              borderColor: "#e5e7eb",
              borderRadius: Radii.md,
              padding: Spacing.lg,
              marginTop: 6,
              fontSize: 16,
              backgroundColor: busy ? "#f9fafb" : "#fff",
              color: "#111",
            }}
          />
            <HapticScalePressable
              onPress={() => {
                logAuthPath("forgot_password");
                router.push("/forgot-password" as Href);
              }}
              disabled={busy}
              style={{ alignSelf: "flex-end", marginTop: Spacing.md, paddingVertical: 4, opacity: busy ? 0.45 : 1 }}
            >
              <Text style={{ fontSize: 15, fontWeight: "700", color: Colors.light.primary }}>{t("passwordRecovery.forgotLink")}</Text>
            </HapticScalePressable>

            <View style={{ marginTop: Spacing.xxl, gap: Spacing.md }}>
              <ScalePressable
                accessibilityRole="button"
                disabled={!canSubmitEmailAuth || busy || step !== "login"}
                onPress={() => {
                  setMode("login");
                  void handleLogIn();
                }}
                style={{
                  minHeight: 56,
                  borderRadius: Radii.lg,
                  backgroundColor: Colors.light.primary,
                  justifyContent: "center",
                  alignItems: "center",
                  boxShadow: "0px 3px 8px rgba(0,0,0,0.16)",
                  elevation: 3,
                  opacity: !canSubmitEmailAuth || busy || step !== "login" ? 0.65 : 1,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "800", textAlign: "center", fontSize: 17, letterSpacing: -0.1 }}>
                  {busy && mode === "login" ? t("auth.loggingIn") : t("auth.logIn")}
                </Text>
              </ScalePressable>

              <ScalePressable
                accessibilityRole="button"
                disabled={!canSubmitEmailAuth || busy || step !== "signup"}
                onPress={() => {
                  setMode("signup");
                  void handleSignUp();
                }}
                style={{
                  minHeight: 56,
                  borderRadius: Radii.lg,
                  backgroundColor: "#fff",
                  borderWidth: 2,
                  borderColor: Colors.light.primary,
                  justifyContent: "center",
                  alignItems: "center",
                  opacity: !canSubmitEmailAuth || busy || step !== "signup" ? 0.65 : 1,
                }}
              >
                <Text style={{ color: Colors.light.primary, fontWeight: "800", textAlign: "center", fontSize: 17, letterSpacing: -0.1 }}>
                  {busy && mode === "signup" ? t("auth.signingUp") : t("authLanding.createAccount")}
                </Text>
              </ScalePressable>
            </View>

            {demoEnabled && step === "login" ? (
              <ScalePressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void handleDemoLogin()}
                style={{
                  marginTop: Spacing.md,
                  minHeight: 56,
                  borderRadius: Radii.lg,
                  backgroundColor: "#fff",
                  borderWidth: 1,
                  borderColor: "rgba(255,159,28,0.35)",
                  justifyContent: "center",
                  alignItems: "center",
                  opacity: busy ? 0.65 : 1,
                }}
              >
                <View style={{ alignItems: "center", paddingHorizontal: Spacing.sm }}>
                  <Text style={{ color: "#11181C", fontWeight: "900", textAlign: "center", fontSize: 16 }}>
                    {t("auth.demoLogin")}
                  </Text>
                  <Text style={{ textAlign: "center", fontSize: 12, color: "rgba(17,24,28,0.7)", marginTop: 4 }}>
                    {t("authLanding.demoHint")}
                  </Text>
                </View>
              </ScalePressable>
            ) : null}

            <View style={{ marginTop: Spacing.xxl, gap: Spacing.sm }}>
              <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.68, textAlign: "center" }}>
                {t("legal.authFooterHint")}
              </Text>
              <LegalExternalLinks align="center" />
            </View>
          </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
