import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { supabase } from "@/lib/supabase";
import { logAuthPath } from "@/lib/auth-path-log";
import { friendlyAuthError, friendlyAuthMessage } from "@/lib/auth-error-messages";
import { Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { Banner } from "@/components/ui/banner";
import { springPressIn, springPressOut, triggerLightHaptic } from "@/lib/press-feedback";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function ScalePressable({
  onPress,
  disabled,
  style,
  children,
}: {
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const scale = useSharedValue(1);
  const rStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      accessibilityRole="button"
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

const DEMO_MODE = process.env.EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER === "true";

export default function AuthLandingScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const params = useLocalSearchParams<{ next?: string }>();
  const nextHref = (typeof params.next === "string" && params.next.length > 0 ? params.next : "/(tabs)") as Href;
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState(DEMO_MODE ? "demo@demo.com" : "");
  const [pw, setPw] = useState(DEMO_MODE ? "123456" : "");
  const [busyAction, setBusyAction] = useState<null | "login" | "signup">(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signUpAwaitingVerification, setSignUpAwaitingVerification] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  const busy = busyAction !== null;
  const canSubmit = !busy && email.trim().length > 0 && pw.length > 0;

  function clearFeedback() {
    setAuthError(null);
  }

  function onEmailChange(v: string) {
    setEmail(v);
    clearFeedback();
    setSignUpAwaitingVerification(false);
  }

  function onPwChange(v: string) {
    setPw(v);
    clearFeedback();
  }

  async function handleLogIn() {
    if (!canSubmit) return;
    setBusyAction("login");
    clearFeedback();
    logAuthPath("normal_login", email.trim());
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: pw,
      });
      if (error) {
        setAuthError(friendlyAuthError(error, t));
        return;
      }
      router.replace(nextHref);
    } catch (e: unknown) {
      setAuthError(friendlyAuthMessage(e instanceof Error ? e.message : String(e), t));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSignUp() {
    if (!canSubmit) return;
    setBusyAction("signup");
    clearFeedback();
    setSignUpAwaitingVerification(false);
    logAuthPath("signup");
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password: pw,
      });
      if (error) {
        setAuthError(friendlyAuthError(error, t));
        return;
      }
      if (!data.session) {
        setSignUpAwaitingVerification(true);
        return;
      }
      router.replace("/onboarding" as Href);
    } catch (e: unknown) {
      setAuthError(friendlyAuthMessage(e instanceof Error ? e.message : String(e), t));
    } finally {
      setBusyAction(null);
    }
  }

  const inputBorder = theme.border;
  const inputBg = busy ? theme.surfaceMuted : theme.surface;
  const mutedLegal = colorScheme === "dark" ? "rgba(236,237,238,0.55)" : "rgba(17,24,28,0.55)";

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: Math.max(insets.top, Spacing.md),
            paddingBottom: insets.bottom + Spacing.xxl,
            paddingHorizontal: Spacing.xxl,
          }}
        >
          <View style={{ alignItems: "center", marginBottom: Spacing.xl }}>
            <Image
              source={require("../assets/images/splash-icon.png")}
              style={{ width: 240, height: 270, opacity: 0.88 }}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
            <Text
              style={{
                fontSize: 32,
                fontWeight: "900",
                color: theme.primary,
                letterSpacing: 2,
                marginTop: 8,
              }}
            >
              TWOFER
            </Text>
          </View>

          {authError ? <Banner message={authError} tone="error" /> : null}

          {signUpAwaitingVerification ? (
            <View style={{ marginBottom: Spacing.lg }}>
              <Banner message={t("authLanding.verifyEmailTitle")} tone="info" />
              <Text
                style={{
                  marginTop: Spacing.md,
                  fontSize: 15,
                  lineHeight: 22,
                  color: theme.mutedText,
                  textAlign: "center",
                }}
              >
                {t("authLanding.verifyEmailBody", { email: email.trim() })}
              </Text>
              <Pressable
                onPress={() => {
                  setSignUpAwaitingVerification(false);
                  clearFeedback();
                }}
                style={{ marginTop: Spacing.lg, alignSelf: "center", paddingVertical: Spacing.sm }}
              >
                <Text style={{ fontSize: 16, fontWeight: "700", color: theme.primary }}>
                  {t("authLanding.backToSignIn")}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {!signUpAwaitingVerification ? (
            <>
              <Text style={{ fontWeight: "700", fontSize: 14, color: theme.text, marginBottom: 6 }}>
                {t("authLanding.emailLabel")}
              </Text>
              <TextInput
                value={email}
                onChangeText={onEmailChange}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                editable={!busy}
                placeholder="you@example.com"
                placeholderTextColor={theme.mutedText}
                style={{
                  borderWidth: 1,
                  borderColor: inputBorder,
                  borderRadius: Radii.md,
                  padding: Spacing.lg,
                  fontSize: 16,
                  backgroundColor: inputBg,
                  color: theme.text,
                  marginBottom: Spacing.md,
                }}
              />

              <Text style={{ fontWeight: "700", fontSize: 14, color: theme.text, marginBottom: 6 }}>
                {t("authLanding.passwordLabel")}
              </Text>
              <TextInput
                value={pw}
                onChangeText={onPwChange}
                secureTextEntry
                editable={!busy}
                placeholder="••••••••"
                placeholderTextColor={theme.mutedText}
                style={{
                  borderWidth: 1,
                  borderColor: inputBorder,
                  borderRadius: Radii.md,
                  padding: Spacing.lg,
                  fontSize: 16,
                  backgroundColor: inputBg,
                  color: theme.text,
                }}
              />

              <Pressable
                onPress={() => router.push("/forgot-password" as Href)}
                disabled={busy}
                style={{ alignSelf: "flex-end", marginTop: Spacing.sm, marginBottom: Spacing.xl, paddingVertical: 4 }}
              >
                <Text style={{ fontSize: 14, fontWeight: "700", color: theme.primary, opacity: busy ? 0.45 : 1 }}>
                  {t("authLanding.forgotPassword")}
                </Text>
              </Pressable>

              <ScalePressable
                disabled={!canSubmit}
                onPress={() => void handleLogIn()}
                style={{
                  minHeight: 58,
                  borderRadius: Radii.lg,
                  backgroundColor: theme.primary,
                  justifyContent: "center",
                  alignItems: "center",
                  flexDirection: "row",
                  gap: Spacing.sm,
                  boxShadow: "0px 4px 10px rgba(0,0,0,0.15)",
                  elevation: 3,
                  opacity: canSubmit ? 1 : 0.5,
                  marginBottom: Spacing.md,
                }}
              >
                {busyAction === "login" ? <ActivityIndicator color={theme.primaryText} /> : null}
                <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 18 }}>
                  {busyAction === "login" ? t("authLanding.pleaseWait") : t("authLanding.logIn")}
                </Text>
              </ScalePressable>

              <ScalePressable
                disabled={!canSubmit}
                onPress={() => void handleSignUp()}
                style={{
                  minHeight: 58,
                  borderRadius: Radii.lg,
                  backgroundColor: theme.surface,
                  borderWidth: 2,
                  borderColor: theme.primary,
                  justifyContent: "center",
                  alignItems: "center",
                  flexDirection: "row",
                  gap: Spacing.sm,
                  opacity: canSubmit ? 1 : 0.5,
                  marginBottom: Spacing.xl,
                }}
              >
                {busyAction === "signup" ? <ActivityIndicator color={theme.primary} /> : null}
                <Text style={{ color: theme.primary, fontWeight: "900", fontSize: 18 }}>
                  {t("authLanding.createAccount")}
                </Text>
              </ScalePressable>
            </>
          ) : null}

          <View style={{ gap: Spacing.sm }}>
            <Text style={{ fontSize: 12, lineHeight: 18, color: mutedLegal, textAlign: "center" }}>
              {t("authLanding.legalFooter")}
            </Text>
            <LegalExternalLinks align="center" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
