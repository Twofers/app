import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  ScrollView,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { useAuthSession } from "@/components/providers/auth-session-provider";
import { useRedemptionMode } from "@/components/providers/redemption-mode-provider";
import { Banner } from "@/components/ui/banner";
import {
  FORM_SCROLL_KEYBOARD_PROPS,
  IOS_DONE_INPUT_ACCESSORY_ID,
  IosDoneInputAccessory,
  KeyboardScreen,
} from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getDealDisplayTitle } from "@/lib/deal-display-copy";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import {
  confirmStaffRedemption,
  exitRedemptionMode,
  isRedemptionCodeComplete,
  isRedeemerSession,
  normalizeRedemptionCode,
  previewStaffRedemption,
  type StaffRedemptionResult,
} from "@/lib/redemption-mode";

type InputBody = { token?: string; short_code?: string };
type EntryMode = "scan" | "manual";

const SECURE_PIN_INPUT_PROPS = {
  autoComplete: "off",
  autoCorrect: false,
  importantForAutofill: "no",
  keyboardType: "number-pad",
  secureTextEntry: true,
  textContentType: "none",
} satisfies Pick<
  TextInputProps,
  "autoComplete" | "autoCorrect" | "importantForAutofill" | "keyboardType" | "secureTextEntry" | "textContentType"
>;

function normalizePinInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

function codeBodyFromManual(raw: string): InputBody | null {
  const code = normalizeRedemptionCode(raw);
  return isRedemptionCodeComplete(code) ? { short_code: code } : null;
}

export default function RedemptionModeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { session } = useAuthSession();
  const { state, loading, sessionStatus, refresh } = useRedemptionMode();
  const [permission, requestPermission] = useCameraPermissions();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const [mode, setMode] = useState<EntryMode>("scan");
  const [manualCode, setManualCode] = useState("");
  const [exitPin, setExitPin] = useState("");
  const [banner, setBanner] = useState<{ message: string; tone?: "error" | "success" | "info" | "warning" } | null>(null);
  const [preview, setPreview] = useState<StaffRedemptionResult | null>(null);
  const [success, setSuccess] = useState<StaffRedemptionResult | null>(null);
  const [lastInput, setLastInput] = useState<InputBody | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [exiting, setExiting] = useState(false);
  const busyRef = useRef(false);

  const staffReady = isRedeemerSession(session) && sessionStatus === "ready";
  const lockedExpired = Boolean(state) && !staffReady;
  const cameraHeight = Math.round(Math.min(430, Math.max(260, height * 0.42)));
  const manualCodeComplete = isRedemptionCodeComplete(manualCode);
  const manualPreviewDisabled = busy || !manualCodeComplete;
  const dealTitleFallback = t("redeem.defaultDealTitle", { defaultValue: "Twofer deal" });
  const previewDealTitle = preview?.deal_title
    ? getDealDisplayTitle({ title: preview.deal_title }, preview.deal_title) || dealTitleFallback
    : dealTitleFallback;
  const successDealTitle = success?.deal_title
    ? getDealDisplayTitle({ title: success.deal_title }, success.deal_title) || dealTitleFallback
    : dealTitleFallback;

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  useFocusEffect(
    useCallback(() => {
      return () => setExitPin("");
    }, []),
  );

  useEffect(() => {
    if (loading) return;
    if (!state && !isRedeemerSession(session)) {
      router.replace("/auth-landing" as Href);
    }
  }, [loading, router, session, state]);

  const statusText = useMemo(() => {
    // redemptionMode.locked is the badge text ("LOCKED"); the subtitle wants the mode name.
    if (!state) return t("redemptionMode.title", { defaultValue: "Redemption mode" });
    return state.deviceLabel;
  }, [state, t]);

  const resetForNext = useCallback(() => {
    setPreview(null);
    setSuccess(null);
    setLastInput(null);
    setManualCode("");
    setScanned(false);
    setBanner(null);
  }, []);

  async function runPreview(body: InputBody) {
    if (!staffReady || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setBanner(null);
    setSuccess(null);
    try {
      const result = await previewStaffRedemption(body);
      setPreview(result);
      setLastInput(body);
      if (!result.ok) {
        setBanner({ message: result.message || t("redemptionMode.previewFailed", { defaultValue: "Cannot redeem this code." }), tone: "error" });
      }
    } catch (err) {
      setPreview(null);
      setLastInput(null);
      setScanned(false);
      setBanner({
        message: err instanceof Error ? err.message : t("redemptionMode.sessionExpired", { defaultValue: "Redemption session expired. Owner PIN required." }),
        tone: "error",
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function runConfirm() {
    if (!staffReady || !lastInput || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setBanner(null);
    try {
      const result = await confirmStaffRedemption(lastInput);
      if (!result.ok) {
        setBanner({ message: result.message || t("redemptionMode.confirmFailed", { defaultValue: "Redemption failed." }), tone: "error" });
        return;
      }
      setPreview(null);
      setSuccess(result);
      setManualCode("");
      setScanned(false);
    } catch (err) {
      setBanner({
        message: err instanceof Error ? err.message : t("redemptionMode.confirmFailed", { defaultValue: "Redemption failed." }),
        tone: "error",
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function runManualPreview() {
    const body = codeBodyFromManual(manualCode);
    if (!body) {
      setBanner({ message: t("redeem.errCodeRequired", { defaultValue: "Enter the claim code." }), tone: "error" });
      return;
    }
    await runPreview(body);
  }

  async function runExit() {
    if (exiting) return;
    const pinValue = exitPin.trim();
    if (!/^\d{4,6}$/.test(pinValue)) {
      setBanner({ message: t("redemptionMode.pinRequired", { defaultValue: "Enter the 4-6 digit exit PIN." }), tone: "error" });
      return;
    }
    setExiting(true);
    setBanner(null);
    setExitPin("");
    try {
      await exitRedemptionMode(pinValue);
      await refresh();
      // No owner session lives on this device; exit always ends at login.
      router.replace("/auth-landing" as Href);
    } catch (err) {
      setBanner({
        message: err instanceof Error ? err.message : t("redemptionMode.exitFailed", { defaultValue: "Could not exit Redemption Mode." }),
        tone: "error",
      });
    } finally {
      setExiting(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <KeyboardScreen>
      <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, backgroundColor: theme.background }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 24, fontWeight: "900", color: theme.text }} numberOfLines={1} adjustsFontSizeToFit>
              {t("redemptionMode.title", { defaultValue: "Redemption mode" })}
            </Text>
            <Text style={{ marginTop: 3, color: theme.mutedText, fontSize: 13 }} numberOfLines={1}>
              {statusText}
            </Text>
          </View>
          <View
            style={{
              paddingVertical: 8,
              paddingHorizontal: 10,
              borderRadius: Radii.pill,
              backgroundColor: staffReady ? theme.primary : theme.surfaceMuted,
            }}
          >
            <Text style={{ color: staffReady ? theme.primaryText : theme.text, fontWeight: "800", fontSize: 12 }}>
              {staffReady ? t("redemptionMode.ready", { defaultValue: "READY" }) : t("redemptionMode.locked", { defaultValue: "LOCKED" })}
            </Text>
          </View>
        </View>

        {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

        <ScrollView
          style={{ flex: 1, marginTop: Spacing.lg }}
          contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.md }}
          showsVerticalScrollIndicator={false}
          {...FORM_SCROLL_KEYBOARD_PROPS}
        >
          {lockedExpired ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: Radii.lg,
                padding: Spacing.lg,
                backgroundColor: theme.surface,
                gap: Spacing.md,
              }}
            >
              <Text style={{ color: theme.text, fontWeight: "800", fontSize: 17 }}>
                {t("redemptionMode.sessionExpiredTitle", { defaultValue: "Owner PIN required" })}
              </Text>
              <Text style={{ color: theme.mutedText, lineHeight: 20 }}>
                {t("redemptionMode.sessionExpiredBody", {
                  defaultValue: "The restricted staff session is not available. Scanning stays disabled until the owner exits.",
                })}
              </Text>
            </View>
          ) : success ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.primary,
                borderRadius: Radii.lg,
                padding: Spacing.lg,
                backgroundColor: colorScheme === "dark" ? "#2b1c08" : "#fff7ed",
                gap: Spacing.sm,
              }}
            >
              <Text style={{ color: theme.text, fontWeight: "900", fontSize: 22 }}>
                {t("redemptionMode.redeemed", { defaultValue: "Redeemed" })}
              </Text>
              <Text style={{ color: theme.text, fontSize: 16 }}>{successDealTitle}</Text>
              <SecondaryButton title={t("redeem.scanNext", { defaultValue: "Scan next" })} onPress={resetForNext} />
            </View>
          ) : preview?.ok ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: Radii.lg,
                padding: Spacing.lg,
                backgroundColor: theme.surface,
                gap: Spacing.md,
              }}
            >
              <Text style={{ color: theme.text, fontWeight: "900", fontSize: 18 }}>
                {previewDealTitle}
              </Text>
              {preview.customer_first_name ? (
                <Text style={{ color: theme.text, fontSize: 15 }}>
                  {t("redemptionMode.customer", { defaultValue: "Customer" })}: {preview.customer_first_name}
                </Text>
              ) : null}
              <Text style={{ color: theme.mutedText, lineHeight: 20 }}>
                {t("redemptionMode.valid", { defaultValue: "Valid and ready to redeem." })}
              </Text>
              <PrimaryButton
                title={busy ? t("redeem.redeeming", { defaultValue: "Redeeming..." }) : t("redemptionMode.confirm", { defaultValue: "Confirm redemption" })}
                onPress={() => void runConfirm()}
                disabled={busy}
              />
              <SecondaryButton title={t("commonUi.cancel", { defaultValue: "Cancel" })} onPress={resetForNext} disabled={busy} />
            </View>
          ) : staffReady ? (
            <>
              <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                <SecondaryButton
                  title={t("redeem.modeScan", { defaultValue: "Scan" })}
                  onPress={() => {
                    setMode("scan");
                    resetForNext();
                  }}
                  style={{ flex: 1, backgroundColor: mode === "scan" ? theme.surfaceMuted : theme.surface }}
                />
                <SecondaryButton
                  title={t("redeem.modeManual", { defaultValue: "Manual" })}
                  onPress={() => {
                    setMode("manual");
                    resetForNext();
                  }}
                  style={{ flex: 1, backgroundColor: mode === "manual" ? theme.surfaceMuted : theme.surface }}
                />
              </View>

              {mode === "manual" ? (
                <View style={{ gap: Spacing.md }}>
                  <Text style={{ color: theme.mutedText, lineHeight: 20 }}>
                    {t("redeem.manualFormatHelp", {
                      defaultValue: "Enter the 6-character code shown under the customer's QR. Spaces and dashes are okay.",
                    })}
                  </Text>
                  <TextInput
                    value={manualCode}
                    onChangeText={(value) => setManualCode(normalizeRedemptionCode(value))}
                    placeholder={t("redeem.manualPlaceholder", { defaultValue: "6-character code" })}
                    accessibilityLabel={t("redeem.manualCodeInputLabel", { defaultValue: "Ticket code" })}
                    accessibilityHint={t("redeem.manualFormatHelp", {
                      defaultValue: "Enter the 6-character code shown under the customer's QR. Spaces and dashes are okay.",
                    })}
                    placeholderTextColor={theme.mutedText}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    inputAccessoryViewID={IOS_DONE_INPUT_ACCESSORY_ID}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      if (manualCodeComplete) void runManualPreview();
                    }}
                    maxLength={12}
                    editable={!busy}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: Radii.md,
                      padding: 14,
                      fontSize: 20,
                      fontWeight: "900",
                      letterSpacing: 2,
                      color: theme.text,
                      backgroundColor: theme.surface,
                    }}
                  />
                  {!manualCodeComplete ? (
                    <Text style={{ color: theme.mutedText, fontSize: 13, lineHeight: 18 }}>
                      {t("redeem.manualIncompleteHint", { defaultValue: "Enter all 6 characters to redeem." })}
                    </Text>
                  ) : null}
                  <PrimaryButton
                    title={busy ? t("redeem.redeeming", { defaultValue: "Checking..." }) : t("redemptionMode.preview", { defaultValue: "Check code" })}
                    onPress={() => void runManualPreview()}
                    disabled={manualPreviewDisabled}
                  />
                </View>
              ) : !permission ? (
                <ActivityIndicator color={theme.primary} />
              ) : !permission.granted ? (
                <View style={{ gap: Spacing.md }}>
                  <Text style={{ color: theme.mutedText }}>{t("redeem.cameraRequired", { defaultValue: "Camera permission is required." })}</Text>
                  <PrimaryButton title={t("redeem.grantPermission", { defaultValue: "Grant camera permission" })} onPress={requestPermission} />
                </View>
              ) : (
                <View style={{ gap: Spacing.md }}>
                  <View style={{ borderRadius: Radii.lg, overflow: "hidden", height: cameraHeight, backgroundColor: "#000" }}>
                    <CameraView
                      style={{ flex: 1 }}
                      facing="back"
                      barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                      onBarcodeScanned={
                        scanned || busy
                          ? undefined
                          : (result) => {
                              const token = result.data.trim();
                              if (!token) return;
                              setScanned(true);
                              void runPreview({ token });
                            }
                      }
                    />
                    {busy ? (
                      <View
                        style={{
                          position: "absolute",
                          inset: 0,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: "rgba(0,0,0,0.45)",
                        }}
                      >
                        <ActivityIndicator color="#fff" />
                      </View>
                    ) : null}
                  </View>
                  <SecondaryButton title={t("redeem.scanNext", { defaultValue: "Scan next" })} onPress={() => setScanned(false)} disabled={busy} />
                </View>
              )}
            </>
          ) : null}

          <View
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: Radii.lg,
              padding: Spacing.lg,
              backgroundColor: theme.surface,
              gap: Spacing.md,
            }}
          >
            <Text style={{ color: theme.text, fontWeight: "800", fontSize: 16 }}>
              {t("redemptionMode.exitTitle", { defaultValue: "Exit redemption mode" })}
            </Text>
            <TextInput
              value={exitPin}
              onChangeText={(value) => setExitPin(normalizePinInput(value))}
              placeholder={t("redemptionMode.exitPinPlaceholder", { defaultValue: "Exit PIN" })}
              placeholderTextColor={theme.mutedText}
              {...SECURE_PIN_INPUT_PROPS}
              inputAccessoryViewID={IOS_DONE_INPUT_ACCESSORY_ID}
              maxLength={6}
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: Radii.md,
                padding: 14,
                color: theme.text,
                backgroundColor: theme.background,
                fontSize: 18,
                fontWeight: "800",
              }}
            />
            <SecondaryButton
              title={exiting ? t("redemptionMode.exiting", { defaultValue: "Exiting..." }) : t("redemptionMode.exitButton", { defaultValue: "Exit" })}
              onPress={() => void runExit()}
              disabled={exiting}
            />
          </View>
        </ScrollView>
        <IosDoneInputAccessory onPress={mode === "manual" ? () => void runManualPreview() : undefined} />
      </View>
    </KeyboardScreen>
  );
}
