import { useState, type ReactNode } from "react";
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
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { logAuthPath } from "@/lib/auth-path-log";
import { friendlyAuthMessage } from "@/lib/auth-error-messages";
import { Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { LegalExternalLinks } from "@/components/legal-external-links";
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
      onPressOut={() => { scale.value = springPressOut(); }}
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
  const params = useLocalSearchParams<{ next?: string }>();
  const nextHref = (typeof params.next === "string" && params.next.length > 0 ? params.next : "/(tabs)") as Href;
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState(DEMO_MODE ? "demo@demo.com" : "");
  const [pw, setPw] = useState(DEMO_MODE ? "123456" : "");
  const [busy, setBusy] = useState(false);

  const canSubmit = !busy && email.trim().length > 0 && pw.length > 0;

  async function handleLogIn() {
    if (!canSubmit) return;
    setBusy(true);
    logAuthPath("normal_login", email.trim());
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: pw,
      });
      if (error) {
        Alert.alert(t("authLanding.loginFailedTitle"), friendlyAuthMessage(error.message, t));
        return;
      }
      router.replace(nextHref);
    } catch (e: unknown) {
      Alert.alert(
        t("authLanding.loginFailedTitle"),
        friendlyAuthMessage(e instanceof Error ? e.message : String(e), t),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUp() {
    if (!canSubmit) return;
    setBusy(true);
    logAuthPath("signup");
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password: pw,
      });
      if (error) {
        Alert.alert(t("authLanding.signUpFailedTitle"), friendlyAuthMessage(error.message, t));
        return;
      }
      router.replace("/onboarding" as Href);
    } catch (e: unknown) {
      Alert.alert(
        t("authLanding.signUpFailedTitle"),
        friendlyAuthMessage(e instanceof Error ? e.message : String(e), t),
      );
    } finally {
      setBusy(false);
    }
  }


  return (
    <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
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
            <Text style={{ fontSize: 32, fontWeight: "900", color: Colors.light.primary, letterSpacing: 2, marginTop: 8 }}>
              TWOFER
            </Text>
          </View>

          {/* Email */}
          <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C", marginBottom: 6 }}>
            {t("authLanding.emailLabel")}
          </Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
            editable={!busy}
            placeholder="you@example.com"
            placeholderTextColor="rgba(17,24,28,0.35)"
            style={{
              borderWidth: 1,
              borderColor: "#e5e7eb",
              borderRadius: Radii.md,
              padding: Spacing.lg,
              fontSize: 16,
              backgroundColor: busy ? "#f9fafb" : "#fff",
              color: "#111",
              marginBottom: Spacing.md,
            }}
          />

          {/* Password */}
          <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C", marginBottom: 6 }}>
            {t("authLanding.passwordLabel")}
          </Text>
          <TextInput
            value={pw}
            onChangeText={setPw}
            secureTextEntry
            editable={!busy}
            placeholder="••••••••"
            placeholderTextColor="rgba(17,24,28,0.35)"
            style={{
              borderWidth: 1,
              borderColor: "#e5e7eb",
              borderRadius: Radii.md,
              padding: Spacing.lg,
              fontSize: 16,
              backgroundColor: busy ? "#f9fafb" : "#fff",
              color: "#111",
            }}
          />

          {/* Forgot password */}
          <Pressable
            onPress={() => router.push("/forgot-password" as Href)}
            disabled={busy}
            style={{ alignSelf: "flex-end", marginTop: Spacing.sm, marginBottom: Spacing.xl, paddingVertical: 4 }}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: Colors.light.primary, opacity: busy ? 0.45 : 1 }}>
              {t("authLanding.forgotPassword")}
            </Text>
          </Pressable>

          {/* Log In */}
          <ScalePressable
            disabled={!canSubmit}
            onPress={() => void handleLogIn()}
            style={{
              minHeight: 58,
              borderRadius: Radii.lg,
              backgroundColor: Colors.light.primary,
              justifyContent: "center",
              alignItems: "center",
              boxShadow: "0px 4px 10px rgba(0,0,0,0.15)",
              elevation: 3,
              opacity: canSubmit ? 1 : 0.5,
              marginBottom: Spacing.md,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 18 }}>
              {busy ? t("authLanding.pleaseWait") : t("authLanding.logIn")}
            </Text>
          </ScalePressable>

          {/* Create Account */}
          <ScalePressable
            disabled={!canSubmit}
            onPress={() => void handleSignUp()}
            style={{
              minHeight: 58,
              borderRadius: Radii.lg,
              backgroundColor: "#fff",
              borderWidth: 2,
              borderColor: Colors.light.primary,
              justifyContent: "center",
              alignItems: "center",
              opacity: canSubmit ? 1 : 0.5,
              marginBottom: Spacing.xl,
            }}
          >
            <Text style={{ color: Colors.light.primary, fontWeight: "900", fontSize: 18 }}>
              {t("authLanding.createAccount")}
            </Text>
          </ScalePressable>

          <View style={{ gap: Spacing.sm }}>
            <Text style={{ fontSize: 12, lineHeight: 18, opacity: 0.55, textAlign: "center" }}>
              {t("authLanding.legalFooter")}
            </Text>
            <LegalExternalLinks align="center" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
