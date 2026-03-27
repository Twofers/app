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
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { logAuthPath } from "@/lib/auth-path-log";

function friendlyError(raw: string): string {
  const m = (raw ?? "").toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid email or password")) return "Incorrect email or password.";
  if (m.includes("user not found")) return "No account found with that email.";
  if (m.includes("already registered") || m.includes("already exists")) return "An account with that email already exists. Try logging in.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a moment and try again.";
  if (m.includes("network") || m.includes("fetch")) return "Network error. Check your connection and try again.";
  if (m.includes("password") && m.includes("least")) return "Password must be at least 6 characters.";
  return raw?.trim() ? raw : "Something went wrong. Please try again.";
}
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
  style?: any;
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

export default function AuthLandingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();
  const nextHref = (typeof params.next === "string" && params.next.length > 0 ? params.next : "/(tabs)") as Href;
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("demo@demo.com");
  const [pw, setPw] = useState("123456");
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
        Alert.alert("Login Failed", friendlyError(error.message));
        return;
      }
      router.replace(nextHref);
    } catch (e: any) {
      Alert.alert("Login Failed", friendlyError(e?.message ?? ""));
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
        Alert.alert("Sign Up Failed", friendlyError(error.message));
        return;
      }
      router.replace("/onboarding" as Href);
    } catch (e: any) {
      Alert.alert("Sign Up Failed", friendlyError(e?.message ?? ""));
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
          {/* Penguin hero — large, centered, no wordmark */}
          <View style={{ alignItems: "center", marginBottom: Spacing.xl }}>
            <Image
              source={require("../assets/images/splash-icon.png")}
              style={{ width: 240, height: 270, opacity: 0.88 }}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          </View>

          {/* Email */}
          <Text style={{ fontWeight: "700", fontSize: 14, color: "#11181C", marginBottom: 6 }}>
            Email
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
            Password
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
              Forgot Password?
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
              {busy ? "Please wait…" : "Log In"}
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
              Create Account
            </Text>
          </ScalePressable>

          <View style={{ gap: Spacing.sm }}>
            <Text style={{ fontSize: 12, lineHeight: 18, opacity: 0.55, textAlign: "center" }}>
              By continuing you agree to our Terms and Privacy Policy.
            </Text>
            <LegalExternalLinks align="center" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
