import { useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ActivityIndicator,
  BackHandler,
  Image,
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
import { resolvePostAuthReplaceHref } from "@/lib/post-auth-route";
import { TAB_MODE_ROLE_COMMITTED_KEY, useTabMode, type TabMode } from "@/lib/tab-mode";
import { logAuthPath } from "@/lib/auth-path-log";
import { friendlyAuthError, friendlyAuthMessage } from "@/lib/auth-error-messages";
import { Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { Banner } from "@/components/ui/banner";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { springPressIn, springPressOut, triggerLightHaptic } from "@/lib/press-feedback";
import i18n, { APP_LOCALES, type AppLocale } from "@/lib/i18n/config";
import { setUiLocalePreference } from "@/lib/locale/ui-locale-storage";
import { upsertAppTabModeForUser } from "@/lib/profiles-app-mode";

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

function RoleCard({
  theme,
  colorScheme,
  selected,
  title,
  hint,
  onPress,
  disabled,
}: {
  theme: (typeof Colors)["light"];
  colorScheme: "light" | "dark";
  selected: boolean;
  title: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const fill =
    selected && colorScheme === "dark"
      ? "rgba(255,159,28,0.14)"
      : selected
        ? "rgba(255,159,28,0.1)"
        : theme.surface;
  return (
    <View style={{ flex: 1 }}>
      <ScalePressable
        disabled={disabled}
        onPress={onPress}
        style={{
          flex: 1,
          minHeight: 112,
          borderRadius: Radii.lg,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? theme.primary : theme.border,
          backgroundColor: fill,
          padding: Spacing.md,
          justifyContent: "center",
          boxShadow: selected ? "0px 6px 16px rgba(255,159,28,0.2)" : "0px 2px 8px rgba(0,0,0,0.06)",
          elevation: selected ? 4 : 1,
          opacity: disabled ? 0.55 : 1,
        }}
      >
        <Text style={{ fontWeight: "900", fontSize: 16, color: theme.text, marginBottom: 4 }}>{title}</Text>
        <Text style={{ fontSize: 12, lineHeight: 17, color: theme.mutedText }}>{hint}</Text>
      </ScalePressable>
    </View>
  );
}

const DEMO_MODE = process.env.EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER === "true";

function firstQueryString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  if (Array.isArray(v) && typeof v[0] === "string" && v[0].length > 0) return v[0];
  return undefined;
}

export default function AuthLandingScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const params = useLocalSearchParams<{ next?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const { mode, setMode, ready: tabModeReady } = useTabMode();
  const [selectedMode, setSelectedMode] = useState<TabMode | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);

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
  const canSubmit = !busy && tabModeReady && selectedMode !== null && email.trim().length > 0 && pw.length > 0;

  useEffect(() => {
    if (!tabModeReady) return;
    let cancelled = false;
    void (async () => {
      const committed = await AsyncStorage.getItem(TAB_MODE_ROLE_COMMITTED_KEY);
      if (cancelled) return;
      if (committed === "1") {
        setSelectedMode(mode);
      } else {
        setSelectedMode(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tabModeReady, mode]);

  async function selectRole(next: TabMode) {
    if (roleBusy) return;
    setRoleBusy(true);
    setSelectedMode(next);
    clearFeedback();
    try {
      await AsyncStorage.setItem(TAB_MODE_ROLE_COMMITTED_KEY, "1");
      await setMode(next);
    } catch (e: unknown) {
      setAuthError(friendlyAuthMessage(e instanceof Error ? e.message : String(e), t));
    } finally {
      setRoleBusy(false);
    }
  }

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
    if (!canSubmit || !selectedMode) return;
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
      await setMode(selectedMode);
      const uid = (await supabase.auth.getSession()).data.session?.user?.id;
      if (uid) {
        await upsertAppTabModeForUser(uid, selectedMode);
      }
      const href = await resolvePostAuthReplaceHref({
        role: selectedMode,
        nextParam: firstQueryString(params.next),
      });
      router.replace(href);
    } catch (e: unknown) {
      setAuthError(friendlyAuthMessage(e instanceof Error ? e.message : String(e), t));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSignUp() {
    if (!canSubmit || !selectedMode) return;
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
      await setMode(selectedMode);
      const uid = data.session.user.id;
      await upsertAppTabModeForUser(uid, selectedMode);
      if (selectedMode === "customer") {
        router.replace("/(tabs)" as Href);
      } else {
        const href = await resolvePostAuthReplaceHref({ role: "business", nextParam: undefined });
        router.replace(href);
      }
    } catch (e: unknown) {
      setAuthError(friendlyAuthMessage(e instanceof Error ? e.message : String(e), t));
    } finally {
      setBusyAction(null);
    }
  }

  const inputBorder = theme.border;
  const inputBg = busy ? theme.surfaceMuted : theme.surface;
  const mutedLegal = colorScheme === "dark" ? "rgba(236,237,238,0.55)" : "rgba(17,24,28,0.55)";

  async function chooseLocale(locale: AppLocale) {
    await setUiLocalePreference(locale, { manual: true });
    await i18n.changeLanguage(locale);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <KeyboardScreen>
        <ScrollView
          {...FORM_SCROLL_KEYBOARD_PROPS}
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
              accessibilityLabel={t("authLanding.heroA11y")}
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
            <Text
              style={{
                marginTop: Spacing.xs,
                fontSize: 14,
                lineHeight: 20,
                color: theme.mutedText,
                textAlign: "center",
              }}
            >
              {t("authLanding.subtitle")}
            </Text>
            <View style={{ marginTop: Spacing.md, alignItems: "center" }}>
              <Text style={{ fontSize: 12, color: theme.mutedText, marginBottom: Spacing.xs }}>
                {t("authLanding.languageLabel")}
              </Text>
              <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                {APP_LOCALES.map((locale) => {
                  const active = i18n.language.startsWith(locale);
                  return (
                    <Pressable
                      key={locale}
                      onPress={() => void chooseLocale(locale)}
                      style={{
                        borderRadius: 999,
                        paddingHorizontal: Spacing.md,
                        paddingVertical: Spacing.xs,
                        borderWidth: 1,
                        borderColor: active ? theme.primary : theme.border,
                        backgroundColor: active ? "rgba(255,159,28,0.12)" : theme.surface,
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: "800", color: active ? theme.primary : theme.text }}>
                        {locale.toUpperCase()}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text
                style={{
                  fontSize: 11,
                  color: theme.mutedText,
                  marginTop: Spacing.xs,
                  textAlign: "center",
                  maxWidth: 280,
                }}
              >
                {t("authLanding.languageHelp")}
              </Text>
            </View>
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
              <Text
                style={{
                  fontWeight: "800",
                  fontSize: 17,
                  color: theme.text,
                  marginBottom: Spacing.xs,
                  textAlign: "center",
                }}
              >
                {t("authLanding.roleTitle")}
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  lineHeight: 20,
                  color: theme.mutedText,
                  textAlign: "center",
                  marginBottom: Spacing.lg,
                }}
              >
                {t("authLanding.roleSubtitle")}
              </Text>

              <View style={{ flexDirection: "row", gap: Spacing.md, marginBottom: Spacing.xl }}>
                <RoleCard
                  theme={theme}
                  colorScheme={colorScheme}
                  selected={selectedMode === "customer"}
                  title={t("authLanding.roleCustomer")}
                  hint={t("authLanding.roleCustomerHint")}
                  onPress={() => void selectRole("customer")}
                  disabled={busy || roleBusy}
                />
                <RoleCard
                  theme={theme}
                  colorScheme={colorScheme}
                  selected={selectedMode === "business"}
                  title={t("authLanding.roleBusiness")}
                  hint={t("authLanding.roleBusinessHint")}
                  onPress={() => void selectRole("business")}
                  disabled={busy || roleBusy}
                />
              </View>
              {!tabModeReady ? (
                <View style={{ alignItems: "center", marginTop: -Spacing.md, marginBottom: Spacing.lg }}>
                  <ActivityIndicator color={theme.primary} accessibilityLabel={t("authLanding.loadingSavedRole")} />
                  <Text style={{ marginTop: Spacing.sm, fontSize: 12, color: theme.mutedText, textAlign: "center" }}>
                    {t("authLanding.loadingSavedRole")}
                  </Text>
                </View>
              ) : null}

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
      </KeyboardScreen>
    </View>
  );
}
