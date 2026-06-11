import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
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
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { supabase } from "@/lib/supabase";
import { resolvePostAuthReplaceHref } from "@/lib/post-auth-route";
import { useTabMode, type TabMode } from "@/lib/tab-mode";
import { persistRoleForUser, resolveRoleForUser, SIGNUP_ROLE_META_KEY } from "@/lib/profiles-role";
import { logAuthPath } from "@/lib/auth-path-log";
import { friendlyAuthError, friendlyAuthMessage, isEmailNotConfirmedError } from "@/lib/auth-error-messages";
import { Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { Banner } from "@/components/ui/banner";
import { LocaleFlag } from "@/components/ui/locale-flag";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { springPressIn, springPressOut, triggerLightHaptic } from "@/lib/press-feedback";
import i18n, { APP_LOCALES, type AppLocale } from "@/lib/i18n/config";
import { setUiLocalePreference } from "@/lib/locale/ui-locale-storage";
import { getEmailAuthRedirectUrl } from "@/lib/auth-password-recovery";
import { BUSINESS_INVITE_PENDING_META_KEY, isValidBusinessInviteCode } from "@/lib/business-invite";

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
          flex: 1,
          minHeight: 96,
          borderRadius: Radii.card,
          borderWidth: selected ? 2 : 1,
          borderColor: selected || focused || pressed ? theme.primary : theme.border,
          backgroundColor: pressed && !selected ? theme.surfaceMuted : fill,
          padding: Spacing.md,
          justifyContent: "center",
          boxShadow: selected ? "0px 8px 18px rgba(255,159,28,0.18)" : "0px 2px 8px rgba(0,0,0,0.06)",
          elevation: selected ? 4 : pressed ? 2 : 1,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: Spacing.sm,
            marginBottom: 6,
          }}
        >
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            style={{ flex: 1, fontWeight: "900", fontSize: 16, lineHeight: 20, color: theme.text }}
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
        <Text style={{ fontSize: 12, lineHeight: 17, color: theme.mutedText }}>{hint}</Text>
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

export default function AuthLandingScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const params = useLocalSearchParams<{ next?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // Account-type cards stay side-by-side by default. On narrow phones we tighten
  // the gap, and on very narrow widths we stack them so "Shopper"/"Business" keep
  // a comfortable, readable card instead of being squeezed.
  const stackRoleCards = windowWidth < 340;
  const roleCardGap = windowWidth < 360 ? Spacing.sm : Spacing.md;
  const { adoptRole } = useTabMode();

  // Hard role split: the role is picked once, at signup only. Login has no
  // picker — it routes by the role stored on the profile.
  const [screenMode, setScreenMode] = useState<AuthScreenMode>("login");
  const [signupRole, setSignupRole] = useState<TabMode>("customer");

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busyAction, setBusyAction] = useState<null | "login" | "signup">(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [signUpAwaitingVerification, setSignUpAwaitingVerification] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

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
  const canSubmit = !busy && email.trim().length > 0 && pw.length > 0;

  function clearFeedback() {
    setAuthError(null);
    setEmailError(null);
    setInviteError(null);
  }

  function switchScreenMode(next: AuthScreenMode) {
    if (busy || next === screenMode) return;
    setScreenMode(next);
    clearFeedback();
  }

  function validateEmail(): boolean {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setEmailError(
        t("authLanding.invalidEmail", { defaultValue: "Please enter a valid email address" }),
      );
      return false;
    }
    setEmailError(null);
    return true;
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
    if (!validateEmail()) return;
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
      await adoptRole(role);
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
    if (!canSubmit) return;
    if (!validateEmail()) return;
    if (signupRole === "business" && !isValidBusinessInviteCode(inviteCode)) {
      setInviteError(
        t("authLanding.errInviteCode", {
          defaultValue: "That invite code isn't valid. Reach out to TWOFER to get one.",
        }),
      );
      return;
    }

    setBusyAction("signup");
    clearFeedback();
    setSignUpAwaitingVerification(false);
    logAuthPath("signup");
    try {
      // The role rides in auth metadata so it survives the email-verification
      // round-trip; the first login persists it to profiles.role.
      const signUpData: Record<string, string> = { [SIGNUP_ROLE_META_KEY]: signupRole };
      if (signupRole === "business") {
        signUpData[BUSINESS_INVITE_PENDING_META_KEY] = inviteCode.trim().toLowerCase();
      }
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
      await adoptRole(signupRole);
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
  const mutedLegal = colorScheme === "dark" ? "rgba(236,237,238,0.55)" : "rgba(17,24,28,0.55)";
  const consumerSubtitle = t("authLanding.subtitleConsumerPolished", {
    defaultValue: "Claim high-value local BOGO deals nearby.",
  });
  const businessSubtitle = t("authLanding.subtitleBusinessPolished", {
    defaultValue: "Create simple BOGO offers and redeem customer tickets.",
  });
  const isSignup = screenMode === "signup";

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
            // FIX: Reduced top padding from xxl to sm to push penguin up.
            // Keeps content higher so Login button is visible without scrolling.
            paddingTop: Math.max(insets.top, Spacing.xs),
            paddingBottom: insets.bottom + Spacing.xxxl * 3,
            paddingHorizontal: Spacing.lg,
          }}
        >
          <View style={{ alignItems: "center", marginBottom: Spacing.md }}>
            {/* Dedicated auth-logo asset (NOT the adaptive-icon foreground, which must
                keep its launcher safe-zone padding). Re-export penguin-logo.png as a
                tightly cropped penguin with true alpha transparency — the current file
                still carries a baked-in checkerboard from the original art export. */}
            <Image
              source={require("../assets/images/penguin-logo.png")}
              style={{ width: 88, height: 88, marginBottom: Spacing.xs }}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              accessibilityLabel={t("authLanding.heroA11y")}
            />
            <Text
              style={{
                fontSize: 34,
                lineHeight: 38,
                fontWeight: "900",
                color: theme.primary,
                letterSpacing: 1.5,
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
              {isSignup && signupRole === "business" ? businessSubtitle : consumerSubtitle}
            </Text>
            <View style={{ marginTop: Spacing.md, alignItems: "center" }}>
              <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                {APP_LOCALES.map((locale) => {
                  const active = i18n.language.startsWith(locale);
                  return (
                    <Pressable
                      key={locale}
                      onPress={() => void chooseLocale(locale)}
                      accessibilityRole="button"
                      accessibilityLabel={LOCALE_LABELS[locale]}
                      accessibilityState={{ selected: active }}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      style={{
                        minHeight: 44,
                        minWidth: 48,
                        borderRadius: Radii.sm,
                        // Border grows 1→2 when active; padding shrinks 3→2 so the
                        // outer size stays fixed and the row doesn't shift.
                        padding: active ? 2 : 3,
                        borderWidth: active ? 2 : 1,
                        borderColor: active ? theme.primary : theme.border,
                        backgroundColor: theme.surface,
                        opacity: active ? 1 : 0.6,
                        boxShadow: active
                          ? "0px 4px 10px rgba(255,159,28,0.25)"
                          : "0px 1px 3px rgba(0,0,0,0.08)",
                        elevation: active ? 3 : 1,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <View style={{ borderRadius: Radii.sm - 2, overflow: "hidden" }}>
                        <LocaleFlag locale={locale} width={40} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
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
                    color: theme.accentText,
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
                <Text style={{ fontSize: 16, fontWeight: "700", color: theme.accentText }}>
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
                  marginBottom: Spacing.lg,
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
                      marginBottom: Spacing.sm,
                      textAlign: "center",
                    }}
                  >
                    {t("authLanding.roleTitle")}
                  </Text>

                  <View
                    style={{
                      flexDirection: stackRoleCards ? "column" : "row",
                      gap: roleCardGap,
                      marginBottom: Spacing.md,
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
                        defaultValue: "Post BOGO offers, track claims, and scan redemptions.",
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

              <Text style={{ fontWeight: "700", fontSize: 14, color: theme.text, marginBottom: 6 }}>
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
                accessibilityLabel={t("authLanding.emailLabel")}
                placeholder={t("authLanding.emailPlaceholder")}
                placeholderTextColor={theme.mutedText}
                style={{
                  borderWidth: 1,
                  borderColor: emailError ? theme.danger : inputBorder,
                  borderRadius: Radii.md,
                  padding: Spacing.lg,
                  fontSize: 16,
                  backgroundColor: inputBg,
                  color: theme.text,
                  marginBottom: emailError ? 4 : Spacing.md,
                }}
              />
              {emailError ? (
                <Text
                  style={{
                    fontSize: 13,
                    color: theme.danger,
                    marginBottom: Spacing.md,
                  }}
                >
                  {emailError}
                </Text>
              ) : null}

              <Text style={{ fontWeight: "700", fontSize: 14, color: theme.text, marginBottom: 6 }}>
                {t("authLanding.passwordLabel")}
              </Text>
              <TextInput
                value={pw}
                onChangeText={onPwChange}
                secureTextEntry
                textContentType="password"
                autoComplete="password"
                editable={!busy}
                accessibilityLabel={t("authLanding.passwordLabel")}
                placeholder={t("authLanding.passwordPlaceholder")}
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
                    <View style={{ marginTop: 6 }}>
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
                      <Text style={{ fontSize: 12, color, marginTop: 2 }}>{label}</Text>
                    </View>
                  );
                })()
              ) : null}

              {isSignup && signupRole === "business" ? (
                <View style={{ marginTop: Spacing.md }}>
                  <Text style={{ fontWeight: "700", fontSize: 14, color: theme.text, marginBottom: 6 }}>
                    {t("authLanding.inviteCodeLabel", { defaultValue: "Business invite code" })}
                  </Text>
                  <TextInput
                    value={inviteCode}
                    onChangeText={(v) => {
                      setInviteCode(v);
                      if (inviteError) setInviteError(null);
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!busy}
                    accessibilityLabel={t("authLanding.inviteCodeLabel", { defaultValue: "Business invite code" })}
                    placeholder={t("authLanding.inviteCodePlaceholder", { defaultValue: "Enter the code TWOFER gave you" })}
                    placeholderTextColor={theme.mutedText}
                    style={{
                      borderWidth: 1,
                      borderColor: inviteError ? theme.danger : inputBorder,
                      borderRadius: Radii.md,
                      padding: Spacing.lg,
                      fontSize: 16,
                      backgroundColor: inputBg,
                      color: theme.text,
                    }}
                  />
                  {inviteError ? (
                    <Text style={{ fontSize: 13, color: theme.danger, marginTop: 4 }}>{inviteError}</Text>
                  ) : (
                    <Text style={{ fontSize: 12, color: theme.mutedText, marginTop: 4 }}>
                      {t("authLanding.inviteCodeHint", {
                        defaultValue: "Required to create a business account.",
                      })}
                    </Text>
                  )}
                </View>
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
                    style={{ fontSize: 14, fontWeight: "700", color: theme.accentText, opacity: busy ? 0.45 : 1, textAlign: "center" }}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                    maxFontSizeMultiplier={1.15}
                  >
                    {t("authLanding.forgotPassword")}
                  </Text>
                </Pressable>
              ) : (
                <View style={{ height: Spacing.lg }} />
              )}

              {!canSubmit && !busy ? (
                <Text
                  style={{
                    fontSize: 13,
                    color: theme.mutedText,
                    textAlign: "center",
                    marginBottom: Spacing.md,
                  }}
                  maxFontSizeMultiplier={1.15}
                >
                  {email.trim().length === 0 && pw.length === 0
                    ? t("authLanding.hintEnterBoth")
                    : email.trim().length === 0
                      ? t("authLanding.hintEnterEmail")
                      : t("authLanding.hintEnterPassword")}
                </Text>
              ) : null}

              <ScalePressable
                disabled={!canSubmit}
                onPress={() => void (isSignup ? handleSignUp() : handleLogIn())}
                accessibilityLabel={
                  busy
                    ? t("authLanding.pleaseWait")
                    : isSignup
                      ? t("authLanding.createAccount")
                      : t("authLanding.logIn")
                }
                accessibilityState={{ disabled: !canSubmit, busy }}
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
                  marginBottom: Spacing.lg,
                }}
              >
                {busy ? <ActivityIndicator color={theme.primaryText} /> : null}
                <Text
                  style={{ color: theme.primaryText, fontWeight: "900", fontSize: 18, textAlign: "center", flexShrink: 1 }}
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

          <View style={{ gap: Spacing.sm }}>
            <Text style={{ fontSize: 12, lineHeight: 18, color: mutedLegal, textAlign: "center" }} maxFontSizeMultiplier={1.15}>
              {t("authLanding.legalFooter")}
            </Text>
            <LegalExternalLinks align="center" showSupport={false} />
          </View>
        </ScrollView>
      </KeyboardScreen>
    </View>
  );
}
