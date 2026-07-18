import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Outfit_700Bold, useFonts } from "@expo-google-fonts/outfit";
import { LaunchArguments } from "react-native-launch-arguments";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Trans, useTranslation } from "react-i18next";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { supabase } from "@/lib/supabase";
import { resolvePostAuthReplaceHref } from "@/lib/post-auth-route";
import { useTabMode, type TabMode } from "@/lib/tab-mode";
import { persistRoleForUser, resolveRoleForUser, SIGNUP_ROLE_META_KEY } from "@/lib/profiles-role";
import { logAuthPath } from "@/lib/auth-path-log";
import { friendlyAuthError, friendlyAuthMessage, isEmailNotConfirmedError } from "@/lib/auth-error-messages";
import { getScreenLayoutMetrics, Spacing, type TabBarPlatform } from "@/lib/screen-layout";
import { Colors, Controls, Radii } from "@/constants/theme";
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from "@/lib/legal-urls";
import { Banner } from "@/components/ui/banner";
import { LocaleFlag } from "@/components/ui/locale-flag";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { springPressIn, springPressOut, triggerLightHaptic } from "@/lib/press-feedback";
import i18n, { APP_LOCALES, appLocaleFromLanguage, type AppLocale } from "@/lib/i18n/config";
import { setUiLocalePreference } from "@/lib/locale/ui-locale-storage";
import { setCustomerPreferredDealLocaleFromAppLanguage } from "@/lib/customer-deal-locale-storage";
import { getEmailAuthRedirectUrl, PASSWORD_MIN_LENGTH } from "@/lib/auth-password-recovery";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Language switcher shows flags; keep a spoken label for screen readers.
const LOCALE_LABELS: Record<AppLocale, string> = {
  en: "English",
  es: "Español",
  ko: "한국어",
};

function ScalePressable({
  onPress,
  disabled,
  style,
  children,
  accessibilityLabel,
  accessibilityState,
  onFocus,
  onBlur,
  onPressStateChange,
}: {
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  accessibilityLabel?: string;
  accessibilityState?: { disabled?: boolean; selected?: boolean; busy?: boolean };
  onFocus?: () => void;
  onBlur?: () => void;
  onPressStateChange?: (pressed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const rStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      onPress={onPress}
      disabled={disabled}
      onFocus={onFocus}
      onBlur={onBlur}
      onPressIn={() => {
        if (disabled) return;
        onPressStateChange?.(true);
        triggerLightHaptic();
        scale.value = springPressIn();
      }}
      onPressOut={() => {
        onPressStateChange?.(false);
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
  stacked,
}: {
  theme: (typeof Colors)["light"];
  colorScheme: "light" | "dark";
  selected: boolean;
  title: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  stacked?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  // Selected cards use an OPAQUE light-orange fill. A translucent rgba fill let the
  // Android elevation shadow bleed through the card body, producing a muddy beige block
  // behind the text; an opaque tint keeps the border, shadow, and text clean.
  const fill =
    selected && colorScheme === "dark"
      ? "#3B301F"
      : selected
        ? "#FFF3E0"
        : theme.surface;
  return (
    <View style={stacked ? { width: "100%" } : { flex: 1 }}>
      <ScalePressable
        disabled={disabled}
        onPress={onPress}
        accessibilityLabel={`${title}. ${hint}`}
        accessibilityState={{ selected, disabled }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPressStateChange={setPressed}
        style={{
          minHeight: stacked ? 78 : 72,
          borderRadius: Radii.md,
          borderWidth: selected ? 2 : 1,
          borderColor: selected || focused || pressed ? theme.primary : theme.border,
          backgroundColor: pressed && !selected ? theme.surfaceMuted : fill,
          padding: Spacing.sm,
          justifyContent: "center",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: Spacing.sm,
            marginBottom: 2,
          }}
        >
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            style={{ flex: 1, fontWeight: "800", fontSize: 14, lineHeight: 18, color: theme.text }}
          >
            {title}
          </Text>
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              borderWidth: 2,
              borderColor: selected ? theme.primary : theme.border,
              backgroundColor: selected ? theme.primary : theme.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {selected ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.primaryText }} /> : null}
          </View>
        </View>
        <Text
          maxFontSizeMultiplier={1.15}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.9}
          style={{ fontSize: 11, lineHeight: 14, color: theme.mutedText }}
        >
          {hint}
        </Text>
      </ScalePressable>
    </View>
  );
}

function firstQueryString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  if (Array.isArray(v) && typeof v[0] === "string" && v[0].length > 0) return v[0];
  return undefined;
}

type AuthScreenMode = "login" | "signup";

type QaLoginLaunchArgs = {
  qaLogin?: string | number | boolean;
  qaLoginEmail?: string;
  qaLoginPassword?: string;
};

export default function AuthLandingScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const params = useLocalSearchParams<{
    next?: string | string[];
    qaLogin?: string | string[];
    qaLoginEmail?: string | string[];
  }>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // Account-type cards stay side-by-side by default. On narrow phones we tighten
  // the gap, and on very narrow widths we stack them so "Shopper"/"Business" keep
  // a comfortable, readable card instead of being squeezed.
  const stackRoleCards = windowWidth < 340;
  const roleCardGap = windowWidth < 360 ? Spacing.sm : Spacing.md;
  const { adoptRole } = useTabMode();
  // Brand wordmark font. Until it resolves (first frames only — expo-font caches
  // after that) we fall back to the system font at the same size to avoid layout shift.
  const [wordmarkFontLoaded] = useFonts({ Outfit_700Bold });

  // Hard role split: the role is picked once, at signup only. Login has no
  // picker — it routes by the role stored on the profile.
  const [screenMode, setScreenMode] = useState<AuthScreenMode>("login");
  const [signupRole, setSignupRole] = useState<TabMode>("customer");
  // Apple 1.2: account creation requires explicit agreement to the conduct policy.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [langPickerOpen, setLangPickerOpen] = useState(false);

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pwVisible, setPwVisible] = useState(false);
  const [focusedField, setFocusedField] = useState<null | "email" | "password">(null);
  const [busyAction, setBusyAction] = useState<null | "login" | "signup">(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [signUpAwaitingVerification, setSignUpAwaitingVerification] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const qaLoginStarted = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  // Count the resend cooldown down once a second so the button label stays live.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  const busy = busyAction !== null;

  useEffect(() => {
    if (!__DEV__ || qaLoginStarted.current) return;
    let args: QaLoginLaunchArgs | null = null;
    try {
      args = LaunchArguments.value<QaLoginLaunchArgs>();
    } catch {
      args = null;
    }
    const paramQaLogin = firstQueryString(params.qaLogin);
    const paramQaEmail = firstQueryString(params.qaLoginEmail);
    const rawEnabled = paramQaLogin ?? args?.qaLogin;
    const enabled = rawEnabled === "1" || rawEnabled === 1 || rawEnabled === true;
    const qaEmail = (paramQaEmail ?? args?.qaLoginEmail ?? "").trim();
    // The password is accepted ONLY from native launch arguments (adb/instrumentation),
    // never from a deep-link URL query param — a URL-borne password would leak into
    // Android logcat / intent history / screen recordings. (__DEV__-only regardless.)
    const qaPassword = args?.qaLoginPassword ?? "";
    if (!enabled || !qaEmail || !qaPassword) return;

    qaLoginStarted.current = true;
    setEmail(qaEmail);
    setPw(qaPassword);
    setBusyAction("login");
    clearFeedback();

    void (async () => {
      try {
        const { data: signInData, error } = await supabase.auth.signInWithPassword({
          email: qaEmail,
          password: qaPassword,
        });
        if (error) {
          setAuthError(friendlyAuthError(error, t));
          return;
        }
        const user = signInData.session?.user;
        if (!user) {
          setAuthError(t("authLanding.errGeneric"));
          return;
        }
        const role = await resolveRoleForUser(user);
        await adoptRole(role, user.id);
        const href = await resolvePostAuthReplaceHref({
          role,
          nextParam: firstQueryString(params.next),
        });
        router.replace(href);
      } catch (e: unknown) {
        setAuthError(friendlyAuthMessage(e instanceof Error ? e.message : String(e), t));
      } finally {
        setBusyAction(null);
      }
    })();
  }, [adoptRole, params.next, params.qaLogin, params.qaLoginEmail, router, t]);

  function clearFeedback() {
    setAuthError(null);
    setEmailError(null);
    setPwError(null);
  }

  function switchScreenMode(next: AuthScreenMode) {
    if (busy || next === screenMode) return;
    setScreenMode(next);
    clearFeedback();
  }

  // The submit button stays enabled (full brand orange) at all times; tapping it
  // with bad input surfaces inline errors under the offending fields instead.
  function validateFields(): boolean {
    let ok = true;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setEmailError(
        t("authLanding.invalidEmail", { defaultValue: "Please enter a valid email address" }),
      );
      ok = false;
    } else {
      setEmailError(null);
    }
    if (pw.length === 0) {
      setPwError(t("authLanding.passwordRequired", { defaultValue: "Please enter your password" }));
      ok = false;
    } else if (screenMode === "signup" && pw.length < PASSWORD_MIN_LENGTH) {
      // Same rule (and localized copy) as the reset screen, so the client and
      // server password policies cannot drift apart. Login keeps the
      // non-empty-only check so legacy shorter passwords can still sign in.
      setPwError(t("passwordRecovery.errPasswordMin", { min: PASSWORD_MIN_LENGTH }));
      ok = false;
    } else {
      setPwError(null);
    }
    return ok;
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
    if (busy) return;
    if (!validateFields()) return;
    setBusyAction("login");
    clearFeedback();
    logAuthPath("normal_login", email.trim());
    try {
      const { data: signInData, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: pw,
      });
      if (error) {
        if (isEmailNotConfirmedError(error)) {
          // Show the check-your-email block, which carries the resend action.
          setResendNotice(null);
          setSignUpAwaitingVerification(true);
          return;
        }
        setAuthError(friendlyAuthError(error, t));
        return;
      }
      const user = signInData.session?.user;
      if (!user) {
        setAuthError(t("authLanding.errGeneric"));
        return;
      }
      const role = await resolveRoleForUser(user);
      await adoptRole(role, user.id);
      const href = await resolvePostAuthReplaceHref({
        role,
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
    if (busy) return;
    if (!termsAccepted) {
      setAuthError(
        t("authLanding.errTermsRequired", {
          defaultValue: "Please agree to the Terms of Service to create an account.",
        }),
      );
      return;
    }
    if (!validateFields()) return;

    setBusyAction("signup");
    clearFeedback();
    setSignUpAwaitingVerification(false);
    logAuthPath("signup");
    try {
      // The role rides in auth metadata so it survives the email-verification
      // round-trip; the first login persists it to profiles.role. Business
      // signups are open applications (audit F-003): new businesses start
      // pending_verification and inert until admin review approves them.
      const signUpData: Record<string, string> = { [SIGNUP_ROLE_META_KEY]: signupRole };
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password: pw,
        options: {
          emailRedirectTo: getEmailAuthRedirectUrl(),
          data: signUpData,
        },
      });
      if (error) {
        setAuthError(friendlyAuthError(error, t));
        return;
      }
      if (!data.session) {
        setResendNotice(null);
        setSignUpAwaitingVerification(true);
        return;
      }
      const uid = data.session.user.id;
      await persistRoleForUser(uid, signupRole);
      await adoptRole(signupRole, uid);
      if (signupRole === "customer") {
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

  async function handleResendConfirmation() {
    if (resendBusy || resendCooldown > 0) return;
    setResendBusy(true);
    setAuthError(null);
    setResendNotice(null);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: getEmailAuthRedirectUrl() },
      });
      if (error) {
        setAuthError(friendlyAuthError(error, t));
        return;
      }
      setResendNotice(t("authLanding.resendConfirmSent"));
      setResendCooldown(60);
    } catch (e: unknown) {
      setAuthError(friendlyAuthMessage(e instanceof Error ? e.message : String(e), t));
    } finally {
      setResendBusy(false);
    }
  }

  const inputBorder = theme.border;
  const inputBg = busy ? theme.surfaceMuted : theme.surface;
  const consumerSubtitle = t("authLanding.subtitleConsumerPolished", {
    defaultValue: "Claim high-value local deals nearby.",
  });
  const businessSubtitle = t("authLanding.subtitleBusinessPolished", {
    defaultValue: "Create simple buy-one-get-one offers and redeem customer tickets.",
  });
  const isSignup = screenMode === "signup";
  const submitBlockedByTerms = isSignup && !termsAccepted;
  const authInputPadding = isSignup ? Spacing.md : Spacing.lg;
  const authSubmitBottomGap = isSignup ? Spacing.sm : Spacing.md;

  async function chooseLocale(locale: AppLocale) {
    setLangPickerOpen(false);
    await setUiLocalePreference(locale, { manual: true });
    await setCustomerPreferredDealLocaleFromAppLanguage(locale);
    await i18n.changeLanguage(locale);
  }

  const currentLocale = appLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);
  const stackPlatform: TabBarPlatform =
    Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios" : "default";
  const authLayout = getScreenLayoutMetrics(insets, "stack", stackPlatform);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <KeyboardScreen>
        <ScrollView
          {...FORM_SCROLL_KEYBOARD_PROPS}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            // Minimal top padding keeps the hero high so the form clears the fold.
            paddingTop: Math.max(insets.top, Spacing.xs),
            paddingBottom: authLayout.scrollBottom + Spacing.xl,
            paddingHorizontal: Spacing.lg,
          }}
        >
          <View style={{ alignItems: "center", marginBottom: isSignup ? Spacing.sm : Spacing.md }}>
            {/* Dedicated auth-logo asset sized for this compact hero. */}
            <Image
              source={require("../assets/images/penguin-auth-512.png")}
              style={{ width: isSignup ? 48 : 72, height: isSignup ? 48 : 72 }}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              accessibilityLabel={t("authLanding.heroA11y")}
            />
            <Text
              style={{
                fontSize: isSignup ? 24 : 28,
                lineHeight: isSignup ? 28 : 34,
                color: theme.primary,
                ...(wordmarkFontLoaded
                  ? { fontFamily: "Outfit_700Bold" }
                  : { fontWeight: "700" as const }),
              }}
            >
              Twofer
            </Text>
            <Text
              style={{
                marginTop: isSignup ? 0 : Spacing.xs,
                fontSize: isSignup ? 13 : 14,
                lineHeight: isSignup ? 18 : 20,
                color: theme.mutedText,
                textAlign: "center",
              }}
            >
              {isSignup && signupRole === "business" ? businessSubtitle : consumerSubtitle}
            </Text>
          </View>

          {authError ? <Banner message={authError} tone="error" /> : null}

          {signUpAwaitingVerification ? (
            <View style={{ marginBottom: Spacing.lg }}>
              <Banner message={t("authLanding.verifyEmailTitle")} tone="info" />
              <Text
                style={{
                  marginTop: Spacing.md,
                  fontSize: 14,
                  lineHeight: 20,
                  color: theme.mutedText,
                  textAlign: "center",
                }}
              >
                {t("authLanding.verifyEmailBody", { email: email.trim() })}
              </Text>
              {resendNotice ? (
                <Text
                  style={{
                    marginTop: Spacing.sm,
                    fontSize: 14,
                    lineHeight: 20,
                    color: theme.success,
                    textAlign: "center",
                  }}
                >
                  {resendNotice}
                </Text>
              ) : null}
              <Pressable
                onPress={() => void handleResendConfirmation()}
                disabled={resendBusy || resendCooldown > 0}
                accessibilityRole="button"
                accessibilityLabel={t("authLanding.resendConfirmEmail")}
                accessibilityState={{ disabled: resendBusy || resendCooldown > 0, busy: resendBusy }}
                style={{ marginTop: Spacing.md, alignSelf: "center", paddingVertical: Spacing.sm }}
              >
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "700",
                    color: theme.primary,
                    opacity: resendBusy || resendCooldown > 0 ? 0.45 : 1,
                  }}
                >
                  {resendBusy
                    ? t("authLanding.pleaseWait")
                    : resendCooldown > 0
                      ? t("authLanding.resendConfirmCooldown", { seconds: resendCooldown })
                      : t("authLanding.resendConfirmEmail")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setSignUpAwaitingVerification(false);
                  setResendNotice(null);
                  setScreenMode("login");
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
              <View
                accessibilityRole="tablist"
                style={{
                  flexDirection: "row",
                  borderRadius: Radii.pill,
                  backgroundColor: theme.surfaceMuted,
                  padding: 4,
                  gap: 4,
                  marginBottom: isSignup ? Spacing.md : Spacing.lg,
                }}
              >
                {(["login", "signup"] as const).map((m) => {
                  const selected = screenMode === m;
                  const label = m === "login" ? t("authLanding.logIn") : t("authLanding.createAccount");
                  return (
                    <Pressable
                      key={m}
                      onPress={() => switchScreenMode(m)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      accessibilityState={{ selected, disabled: busy }}
                      style={{
                        flex: 1,
                        minHeight: 44,
                        justifyContent: "center",
                        borderRadius: Radii.pill,
                        backgroundColor: selected ? theme.primary : "transparent",
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.78}
                        maxFontSizeMultiplier={1.15}
                        style={{
                          textAlign: "center",
                          fontWeight: "800",
                          fontSize: 14,
                          paddingHorizontal: Spacing.xs,
                          color: selected ? theme.primaryText : theme.text,
                        }}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {isSignup ? (
                <>
                  <Text
                    style={{
                      fontWeight: "800",
                      fontSize: 16,
                      color: theme.text,
                      marginBottom: Spacing.xs,
                      textAlign: "center",
                    }}
                  >
                    {t("authLanding.roleTitle")}
                  </Text>

                  <View
                    style={{
                      flexDirection: stackRoleCards ? "column" : "row",
                      gap: roleCardGap,
                      marginBottom: Spacing.sm,
                    }}
                  >
                    <RoleCard
                      theme={theme}
                      colorScheme={colorScheme}
                      selected={signupRole === "customer"}
                      title={t("authLanding.roleCustomer")}
                      hint={t("authLanding.roleCustomerPolishedHint", {
                        defaultValue: "Find nearby offers, claim tickets, and redeem in person.",
                      })}
                      onPress={() => {
                        setSignupRole("customer");
                        clearFeedback();
                      }}
                      disabled={busy}
                      stacked={stackRoleCards}
                    />
                    <RoleCard
                      theme={theme}
                      colorScheme={colorScheme}
                      selected={signupRole === "business"}
                      title={t("authLanding.roleBusiness")}
                      hint={t("authLanding.roleBusinessPolishedHint", {
                        defaultValue: "Post offers, track claims, and scan redemptions.",
                      })}
                      onPress={() => {
                        setSignupRole("business");
                        clearFeedback();
                      }}
                      disabled={busy}
                      stacked={stackRoleCards}
                    />
                  </View>
                </>
              ) : null}

              <Text style={{ fontWeight: "500", fontSize: 14, color: theme.mutedText, marginBottom: Spacing.sm }}>
                {t("authLanding.emailLabel")}
              </Text>
              <TextInput
                value={email}
                onChangeText={onEmailChange}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                textContentType="emailAddress"
                autoComplete="email"
                editable={!busy}
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField((f) => (f === "email" ? null : f))}
                accessibilityLabel={t("authLanding.emailLabel")}
                placeholder={t("authLanding.emailPlaceholder")}
                placeholderTextColor={theme.mutedText}
                style={{
                  borderWidth: 1,
                  borderColor: emailError ? theme.danger : focusedField === "email" ? theme.primary : inputBorder,
                  borderRadius: Radii.md,
                  padding: authInputPadding,
                  fontSize: 16,
                  backgroundColor: inputBg,
                  color: theme.text,
                  marginBottom: emailError ? 4 : Spacing.md,
                }}
              />
              {emailError ? (
                <Text
                  style={{
                    fontSize: 12,
                    color: theme.danger,
                    marginBottom: Spacing.md,
                  }}
                >
                  {emailError}
                </Text>
              ) : null}

              <Text style={{ fontWeight: "500", fontSize: 14, color: theme.mutedText, marginBottom: Spacing.sm }}>
                {t("authLanding.passwordLabel")}
              </Text>
              <View style={{ justifyContent: "center" }}>
                <TextInput
                  value={pw}
                  onChangeText={onPwChange}
                  secureTextEntry={!pwVisible}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType={isSignup ? "newPassword" : "password"}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  editable={!busy}
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField((f) => (f === "password" ? null : f))}
                  accessibilityLabel={t("authLanding.passwordLabel")}
                  placeholder={t("authLanding.passwordPlaceholder")}
                  placeholderTextColor={theme.mutedText}
                  style={{
                    borderWidth: 1,
                    borderColor: pwError ? theme.danger : focusedField === "password" ? theme.primary : inputBorder,
                    borderRadius: Radii.md,
                    padding: authInputPadding,
                    paddingRight: authInputPadding + 24 + Spacing.md,
                    fontSize: 16,
                    backgroundColor: inputBg,
                    color: theme.text,
                  }}
                />
                <Pressable
                  onPress={() => setPwVisible((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    pwVisible ? t("authLanding.hidePassword") : t("authLanding.showPassword")
                  }
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={{ position: "absolute", right: Spacing.lg }}
                >
                  <MaterialCommunityIcons
                    name={pwVisible ? "eye-off-outline" : "eye-outline"}
                    size={24}
                    color={theme.mutedText}
                  />
                </Pressable>
              </View>
              {pwError ? (
                <Text style={{ fontSize: 12, color: theme.danger, marginTop: Spacing.xs }}>
                  {pwError}
                </Text>
              ) : null}

              {isSignup && pw.length > 0 ? (
                (() => {
                  const hasUpper = /[A-Z]/.test(pw);
                  const hasNumber = /[0-9]/.test(pw);
                  const hasSpecial = /[^A-Za-z0-9]/.test(pw);
                  const bonusCount = [hasUpper, hasNumber, hasSpecial].filter(Boolean).length;
                  const strength =
                    pw.length < 8 ? "weak" : bonusCount >= 3 ? "strong" : bonusCount >= 2 ? "medium" : "weak";
                  const color = strength === "strong" ? theme.success : strength === "medium" ? theme.primary : theme.danger;
                  const widthPct = strength === "strong" ? "100%" : strength === "medium" ? "66%" : "33%";
                  const label =
                    strength === "strong"
                      ? t("authLanding.strengthStrong", { defaultValue: "Strong" })
                      : strength === "medium"
                        ? t("authLanding.strengthMedium", { defaultValue: "Medium" })
                        : t("authLanding.strengthWeak", { defaultValue: "Weak" });
                  return (
                    <View style={{ marginTop: Spacing.sm }}>
                      <View
                        style={{
                          height: 4,
                          borderRadius: 2,
                          backgroundColor: theme.border,
                          overflow: "hidden",
                        }}
                      >
                        <View style={{ height: 4, borderRadius: 2, backgroundColor: color, width: widthPct }} />
                      </View>
                      <Text style={{ fontSize: 12, color, marginTop: Spacing.xs }}>{label}</Text>
                    </View>
                  );
                })()
              ) : null}

              {!isSignup ? (
                <Pressable
                  onPress={() => router.push("/forgot-password" as Href)}
                  disabled={busy}
                  accessibilityRole="link"
                  accessibilityLabel={t("authLanding.forgotPassword")}
                  hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
                  style={{
                    alignSelf: "center",
                    minHeight: 44,
                    marginTop: Spacing.sm,
                    marginBottom: Spacing.sm,
                    paddingVertical: Spacing.sm,
                    paddingHorizontal: Spacing.md,
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{ fontSize: 14, fontWeight: "700", color: theme.primary, opacity: busy ? 0.45 : 1, textAlign: "center" }}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                    maxFontSizeMultiplier={1.15}
                  >
                    {t("authLanding.forgotPassword")}
                  </Text>
                </Pressable>
              ) : (
                <View style={{ height: Spacing.sm }} />
              )}

              {isSignup ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: Spacing.sm,
                    marginBottom: Spacing.md,
                  }}
                >
                  <Pressable
                    onPress={() => setTermsAccepted((v) => !v)}
                    disabled={busy}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: termsAccepted, disabled: busy }}
                    accessibilityLabel={t("authLanding.termsCheckboxA11y", {
                      defaultValue: "I agree to the Terms of Service, which prohibit objectionable content and abusive behavior",
                    })}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ paddingTop: 1 }}
                  >
                    <MaterialIcons
                      name={termsAccepted ? "check-box" : "check-box-outline-blank"}
                      size={22}
                      color={termsAccepted ? theme.primary : theme.mutedText}
                    />
                  </Pressable>
                  <Text
                    style={{ flex: 1, fontSize: 12, lineHeight: 17, color: theme.mutedText }}
                    maxFontSizeMultiplier={1.1}
                  >
                    <Trans
                      i18nKey="authLanding.termsCheckbox"
                      components={{
                        terms: (
                          <Text
                            accessibilityRole="link"
                            style={{ textDecorationLine: "underline", color: theme.primary }}
                            onPress={() => void Linking.openURL(TERMS_OF_SERVICE_URL)}
                          />
                        ),
                      }}
                    />
                  </Text>
                </View>
              ) : null}

              {/* Custom Pressable (not PrimaryButton) only because it renders an
                  inline busy spinner + accessibilityState.busy. Sizing must match
                  the button standard: Controls.buttonHeight + Radii.md, no shadow
                  (see components/ui/primary-button.tsx). */}
              <ScalePressable
                disabled={busy || submitBlockedByTerms}
                onPress={() => void (isSignup ? handleSignUp() : handleLogIn())}
                accessibilityLabel={
                  busy
                    ? t("authLanding.pleaseWait")
                    : isSignup
                      ? t("authLanding.createAccount")
                      : t("authLanding.logIn")
                }
                accessibilityState={{ disabled: busy || submitBlockedByTerms, busy }}
                style={{
                  minHeight: Controls.buttonHeight,
                  borderRadius: Radii.md,
                  backgroundColor: theme.primary,
                  opacity: submitBlockedByTerms && !busy ? 0.6 : 1,
                  justifyContent: "center",
                  alignItems: "center",
                  flexDirection: "row",
                  gap: Spacing.sm,
                  marginBottom: authSubmitBottomGap,
                }}
              >
                {busy ? <ActivityIndicator color={theme.primaryText} /> : null}
                <Text
                  style={{ color: theme.primaryText, fontWeight: "800", fontSize: 17, textAlign: "center", flexShrink: 1 }}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                  maxFontSizeMultiplier={1.15}
                >
                  {busy
                    ? t("authLanding.pleaseWait")
                    : isSignup
                      ? t("authLanding.createAccount")
                      : t("authLanding.logIn")}
                </Text>
              </ScalePressable>
            </>
          ) : null}

          <View
            style={{
              minHeight: 44,
              justifyContent: "center",
              paddingVertical: Spacing.xs,
              paddingHorizontal: Spacing.sm,
            }}
          >
            <Text
              style={{ fontSize: 12, lineHeight: 17, color: theme.mutedText, textAlign: "center" }}
              maxFontSizeMultiplier={1.1}
            >
              <Trans
                i18nKey="authLanding.legalFooter"
                components={{
                  terms: (
                    <Text
                      accessibilityRole="link"
                      style={{ textDecorationLine: "underline" }}
                      onPress={() => void Linking.openURL(TERMS_OF_SERVICE_URL)}
                    />
                  ),
                  privacy: (
                    <Text
                      accessibilityRole="link"
                      style={{ textDecorationLine: "underline" }}
                      onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
                    />
                  ),
                }}
              />
            </Text>
          </View>
        </ScrollView>
      </KeyboardScreen>

      {/* Compact language selector pinned top-right; the flag cards used to sit
          inline under the tagline. Same chooseLocale flow, just behind a popover. */}
      <View
        style={{
          position: "absolute",
          top: insets.top + Spacing.sm,
          right: Spacing.lg,
          alignItems: "flex-end",
          zIndex: 10,
        }}
      >
        <Pressable
          onPress={() => setLangPickerOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={t("authLanding.changeLanguage", { defaultValue: "Change language" })}
          accessibilityState={{ expanded: langPickerOpen }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
            minHeight: 36,
            paddingVertical: 4,
            paddingLeft: 8,
            paddingRight: 4,
            borderRadius: Radii.md,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
          }}
        >
          <View style={{ borderRadius: 3, overflow: "hidden" }}>
            <LocaleFlag locale={currentLocale} width={26} />
          </View>
          <MaterialIcons
            name={langPickerOpen ? "arrow-drop-up" : "arrow-drop-down"}
            size={20}
            color={theme.mutedText}
          />
        </Pressable>
        {langPickerOpen ? (
          <View
            style={{
              marginTop: Spacing.sm,
              borderRadius: Radii.md,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surface,
              overflow: "hidden",
            }}
          >
            {APP_LOCALES.map((locale) => {
              const active = locale === currentLocale;
              return (
                <Pressable
                  key={locale}
                  onPress={() => void chooseLocale(locale)}
                  accessibilityRole="button"
                  accessibilityLabel={LOCALE_LABELS[locale]}
                  accessibilityState={{ selected: active }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: Spacing.sm,
                    minHeight: 44,
                    paddingHorizontal: Spacing.md,
                    backgroundColor: active ? theme.surfaceMuted : theme.surface,
                  }}
                >
                  <View style={{ borderRadius: 2, overflow: "hidden" }}>
                    <LocaleFlag locale={locale} width={22} />
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: active ? "700" : "500", color: theme.text }}>
                    {LOCALE_LABELS[locale]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
}
