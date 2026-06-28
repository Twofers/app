import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, Text, TextInput, type TextInputProps, useWindowDimensions, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useBusiness } from "../../hooks/use-business";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { Banner } from "../../components/ui/banner";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { redeemToken } from "../../lib/functions";
import { translateKnownApiMessage } from "../../lib/i18n/api-messages";
import { formatAppDateTime } from "../../lib/i18n/format-datetime";
import {
  FORM_SCROLL_KEYBOARD_PROPS,
  IOS_DONE_INPUT_ACCESSORY_ID,
  IosDoneInputAccessory,
  KeyboardScreen,
} from "@/components/ui/keyboard-screen";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Colors, Radii } from "@/constants/theme";
import { ReportSheet } from "@/components/report-sheet";
import { useOwnerRedemptionSecurity } from "@/components/providers/owner-redemption-security-provider";
import { submitUserReport, type UserReportReason } from "@/lib/reports";
import {
  getOwnerRedemptionSecurityStatus,
  verifyOwnerRedemptionPin,
  type OwnerRedemptionSecurityStatus,
} from "@/lib/owner-redemption-security";
import { isRedemptionCodeComplete, normalizeRedemptionCode } from "@/lib/redemption-mode-logic";
import { getDealDisplayTitle } from "@/lib/deal-display-copy";

type RedeemMode = "scan" | "manual";

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

export default function RedeemScanner() {
  const { t, i18n } = useTranslation();
  const { height: winH } = useWindowDimensions();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const router = useRouter();
  const { isLoggedIn, businessId, loading } = useBusiness();
  const { isUnlocked, markUnlocked, setPinEnabled } = useOwnerRedemptionSecurity();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const [banner, setBanner] = useState<{ message: string; tone?: "error" | "success" | "info" | "warning" } | null>(null);
  const [ownerSecurity, setOwnerSecurity] = useState<OwnerRedemptionSecurityStatus | null>(null);
  const [ownerSecurityLoading, setOwnerSecurityLoading] = useState(false);
  const [ownerSecurityError, setOwnerSecurityError] = useState<string | null>(null);
  const [ownerPinInput, setOwnerPinInput] = useState("");
  const [ownerPinSubmitting, setOwnerPinSubmitting] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraPermissionRequesting, setCameraPermissionRequesting] = useState(false);
  const [cameraPermissionError, setCameraPermissionError] = useState<string | null>(null);
  const [mode, setMode] = useState<RedeemMode>("scan");
  const [scannerActive, setScannerActive] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [processing, setProcessing] = useState(false);
  const processingRef = useRef(false);
  const [success, setSuccess] = useState<{ dealTitle: string; redeemedAt: string; claimId: string | null } | null>(null);
  const [claimCodeInput, setClaimCodeInput] = useState("");
  const [reportVisible, setReportVisible] = useState(false);

  const loadOwnerSecurity = useCallback(async () => {
    if (!businessId) {
      setOwnerSecurity(null);
      setOwnerSecurityError(null);
      return;
    }
    setOwnerSecurityLoading(true);
    setOwnerSecurityError(null);
    try {
      const status = await getOwnerRedemptionSecurityStatus(businessId);
      setOwnerSecurity(status);
      setPinEnabled(businessId, status.enabled);
    } catch (err) {
      const fallback = t("redemptionMode.ownerPinLoadFailed", {
        defaultValue: "Could not load owner redemption PIN settings.",
      });
      const raw = err instanceof Error ? err.message : fallback;
      if (/requested function was not found|function was not found/i.test(raw)) {
        setOwnerSecurity({ enabled: false, hasPin: false, lockedUntil: null });
        setPinEnabled(businessId, false);
        setBanner({ message: fallback, tone: "warning" });
      } else {
        setOwnerSecurity(null);
        setOwnerSecurityError(fallback);
      }
    } finally {
      setOwnerSecurityLoading(false);
    }
  }, [businessId, setPinEnabled, t]);

  // Clear stale success/error state when tab regains focus
  useFocusEffect(
    useCallback(() => {
      setSuccess(null);
      setBanner(null);
      setScanned(false);
      setScannerActive(false);
      processingRef.current = false;
      return () => setOwnerPinInput("");
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      void loadOwnerSecurity();
    }, [loadOwnerSecurity]),
  );

  useEffect(() => {
    setBanner(null);
    setScanned(false);
    if (mode === "manual") {
      setScannerActive(false);
    }
  }, [mode]);

  async function unlockOwnerRedeem() {
    if (!businessId || ownerPinSubmitting) return;
    const pin = ownerPinInput.trim();
    if (!/^\d{4,6}$/.test(pin)) {
      setBanner({ message: t("redemptionMode.ownerPinRequired", { defaultValue: "Enter a 4-6 digit redemption PIN." }), tone: "error" });
      return;
    }
    setOwnerPinSubmitting(true);
    setBanner(null);
    setOwnerPinInput("");
    try {
      const unlocked = await verifyOwnerRedemptionPin(businessId, pin);
      if (!unlocked) {
        setBanner({ message: t("redemptionMode.ownerPinInvalid", { defaultValue: "Incorrect redemption PIN." }), tone: "error" });
        return;
      }
      markUnlocked(businessId);
      setPinEnabled(businessId, true);
      setOwnerSecurity({ enabled: true, hasPin: true, lockedUntil: null });
    } catch (err) {
      setBanner({
        message: err instanceof Error ? err.message : t("redemptionMode.ownerPinInvalid", { defaultValue: "Incorrect redemption PIN." }),
        tone: "error",
      });
    } finally {
      setOwnerPinSubmitting(false);
    }
  }

  async function runRedeem(body: { token?: string; short_code?: string }) {
    if (processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);
    setBanner(null);
    try {
      const result = await redeemToken(body);
      setSuccess({
        dealTitle: result.deal_title
          ? getDealDisplayTitle({ title: result.deal_title }, result.deal_title)
          : t("redeem.defaultDealTitle"),
        redeemedAt: result.redeemed_at,
        claimId: result.claim_id ?? null,
      });
      setClaimCodeInput("");
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : t("redeem.errRedeemFailed");
      setBanner({ message: translateKnownApiMessage(String(raw), t), tone: "error" });
      setScanned(false);
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }

  async function onScan(data: string) {
    if (processing || scanned) return;
    setScanned(true);
    const token = data.trim();
    if (!token) {
      setScanned(false);
      setBanner({ message: translateKnownApiMessage("Missing or invalid token", t), tone: "error" });
      return;
    }
    await runRedeem({ token });
  }

  async function onManualRedeem() {
    if (processingRef.current) return;
    const code = normalizeRedemptionCode(claimCodeInput);
    if (!isRedemptionCodeComplete(code)) {
      setBanner({ message: t("redeem.errCodeRequired"), tone: "error" });
      return;
    }
    await runRedeem({ short_code: code });
  }

  async function requestCameraAccess() {
    if (cameraPermissionRequesting) return;
    setCameraPermissionRequesting(true);
    setCameraPermissionError(null);
    try {
      await requestPermission();
    } catch {
      setCameraPermissionError(
        t("redeem.cameraPermissionFailed", {
          defaultValue: "Camera permission did not open. Try again or enter the ticket code.",
        }),
      );
    } finally {
      setCameraPermissionRequesting(false);
    }
  }

  async function openCameraSettings() {
    setCameraPermissionError(null);
    try {
      await Linking.openSettings();
    } catch {
      setCameraPermissionError(
        t("redeem.cameraPermissionFailed", {
          defaultValue: "Camera permission did not open. Try again or enter the ticket code.",
        }),
      );
    }
  }

  const cameraBlockHeight = Math.round(Math.min(420, Math.max(260, winH * 0.42)));
  const ownerPinGateActive = Boolean(businessId && ownerSecurity?.enabled && !isUnlocked(businessId));
  const cameraPermissionBlocked = Boolean(permission && !permission.granted && permission.canAskAgain === false);
  const claimCodeComplete = isRedemptionCodeComplete(claimCodeInput);
  const manualRedeemDisabled = processing || !claimCodeComplete;

  return (
    <KeyboardScreen>
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3, color: theme.text }}>{t("redeem.title")}</Text>
      {!success && !ownerPinGateActive && !ownerSecurityError && !(businessId && (ownerSecurityLoading || !ownerSecurity)) ? (
        <Text style={{ marginTop: Spacing.sm, fontSize: 14, opacity: 0.72, lineHeight: 20, color: theme.text }}>
          {mode === "scan" ? t("redeem.scanPrimaryHint") : t("redeem.manualFallbackHint")}
        </Text>
      ) : null}
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {!isLoggedIn ? (
        <Text style={{ marginTop: Spacing.lg, opacity: 0.7, color: theme.text }}>{t("redeem.loginPrompt")}</Text>
      ) : loading ? (
        <Text style={{ marginTop: Spacing.lg, opacity: 0.7, color: theme.text }}>{t("redeem.loading")}</Text>
      ) : !businessId ? (
        <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
          <Text style={{ fontWeight: "700", fontSize: 16, color: theme.text }}>{t("redeem.createHeader")}</Text>
          <Text style={{ opacity: 0.7, color: theme.text }}>{t("redeem.createBody")}</Text>
          <PrimaryButton title={t("redeem.startBusinessSetup")} onPress={() => router.push("/business-setup")} />
        </View>
      ) : ownerSecurityError ? (
        <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
          <Banner message={ownerSecurityError} tone="error" />
          <SecondaryButton
            title={t("commonUi.tryAgain", { defaultValue: "Try again" })}
            onPress={() => void loadOwnerSecurity()}
            disabled={ownerSecurityLoading}
          />
        </View>
      ) : ownerSecurityLoading || !ownerSecurity ? (
        <Text style={{ marginTop: Spacing.lg, opacity: 0.7, color: theme.text }}>
          {t("redemptionMode.ownerPinLoading", { defaultValue: "Loading redemption security..." })}
        </Text>
      ) : ownerPinGateActive ? (
        <View style={{ marginTop: Spacing.lg, gap: Spacing.md, paddingBottom: scrollBottom }}>
          <Text style={{ fontWeight: "900", fontSize: 18, color: theme.text }}>
            {t("redemptionMode.ownerPinRequiredTitle", { defaultValue: "Owner PIN required" })}
          </Text>
          <Text style={{ color: theme.mutedText, fontSize: 14, lineHeight: 20 }}>
            {t("redemptionMode.ownerPinUnlockBody", {
              defaultValue: "Enter the owner PIN to unlock the rest of the business app.",
            })}
          </Text>
          <TextInput
            value={ownerPinInput}
            onChangeText={(value) => setOwnerPinInput(normalizePinInput(value))}
            placeholder={t("redemptionMode.ownerPinPlaceholder", { defaultValue: "Enter owner PIN" })}
            placeholderTextColor={theme.mutedText}
            {...SECURE_PIN_INPUT_PROPS}
            maxLength={6}
            editable={!ownerPinSubmitting}
            inputAccessoryViewID={IOS_DONE_INPUT_ACCESSORY_ID}
            returnKeyType="done"
            onSubmitEditing={() => void unlockOwnerRedeem()}
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 10,
              padding: 12,
              fontSize: 18,
              fontWeight: "700",
              letterSpacing: 2,
              color: theme.text,
              backgroundColor: theme.surface,
            }}
          />
          <PrimaryButton
            title={ownerPinSubmitting ? t("commonUi.unlocking", { defaultValue: "Unlocking..." }) : t("commonUi.unlock", { defaultValue: "Unlock" })}
            onPress={() => void unlockOwnerRedeem()}
            disabled={ownerPinSubmitting}
          />
        </View>
      ) : success ? (
        <View style={{ marginTop: Spacing.lg, paddingBottom: scrollBottom }}>
          <View
            style={{
              borderRadius: 18,
              padding: Spacing.lg,
              backgroundColor: colorScheme === "dark" ? "#2b1c08" : "#fff7ed",
              borderWidth: 1,
              borderColor: theme.primary,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm }}>
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.primary,
                }}
              >
                <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 12 }}>OK</Text>
              </View>
              <Text style={{ fontWeight: "900", fontSize: 18, color: theme.text }}>{t("redeem.redeemed")}</Text>
            </View>
            <Text style={{ marginTop: Spacing.sm, fontSize: 16, color: theme.text }}>{success.dealTitle}</Text>
            <Text style={{ marginTop: Spacing.sm, opacity: 0.72, fontSize: 14, color: theme.text }}>
              {t("redeem.redeemedAt")}{" "}
              {formatAppDateTime(success.redeemedAt, i18n.language)}
            </Text>
          </View>
          <View style={{ marginTop: Spacing.md }}>
            <SecondaryButton
              title={t("redeem.scanNext")}
              onPress={() => {
                setSuccess(null);
                setScanned(false);
              }}
            />
          </View>
          {success.claimId ? (
            <Pressable
              onPress={() => setReportVisible(true)}
              accessibilityRole="button"
              style={{
                marginTop: Spacing.md,
                paddingVertical: Spacing.md,
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: theme.mutedText }}>
                {t("redeem.reportCustomerLink", { defaultValue: "Report this customer" })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={{ marginTop: Spacing.lg, flex: 1, paddingBottom: scrollBottom, gap: Spacing.md }}>
          <View style={{ flexDirection: "row", gap: Spacing.sm }}>
            <Pressable
              onPress={() => setMode("scan")}
              disabled={processing}
              style={{
                flex: 1,
                paddingVertical: Spacing.sm,
                borderRadius: Radii.pill,
                backgroundColor: mode === "scan" ? theme.primary : theme.surfaceMuted,
                alignItems: "center",
                opacity: processing && mode !== "scan" ? 0.5 : 1,
              }}
            >
              <Text style={{ fontWeight: "700", color: mode === "scan" ? theme.primaryText : theme.text }}>{t("redeem.modeScan")}</Text>
            </Pressable>
            <Pressable
              onPress={() => setMode("manual")}
              disabled={processing}
              style={{
                flex: 1,
                paddingVertical: Spacing.sm,
                borderRadius: Radii.pill,
                backgroundColor: mode === "manual" ? theme.primary : theme.surfaceMuted,
                alignItems: "center",
                opacity: processing && mode !== "manual" ? 0.5 : 1,
              }}
            >
              <Text style={{ fontWeight: "700", color: mode === "manual" ? theme.primaryText : theme.text }}>{t("redeem.modeManual")}</Text>
            </Pressable>
          </View>

          {mode === "manual" ? (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ gap: Spacing.md, paddingBottom: scrollBottom }}
              {...FORM_SCROLL_KEYBOARD_PROPS}
            >
              <Text style={{ opacity: 0.72, fontSize: 14, lineHeight: 20, color: theme.text }}>{t("redeem.manualHelp")}</Text>
              <TextInput
                value={claimCodeInput}
                onChangeText={(value) => setClaimCodeInput(normalizeRedemptionCode(value))}
                placeholder={t("redeem.manualPlaceholder")}
                accessibilityLabel={t("redeem.manualCodeInputLabel", { defaultValue: "Ticket code" })}
                accessibilityHint={t("redeem.manualFormatHelp", {
                  defaultValue: "Enter the 6-character code shown under the customer's QR. Spaces and dashes are okay.",
                })}
                testID="redeem-manual-code-input"
                placeholderTextColor={theme.mutedText}
                autoCapitalize="characters"
                autoCorrect={false}
                inputAccessoryViewID={IOS_DONE_INPUT_ACCESSORY_ID}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (claimCodeComplete) void onManualRedeem();
                }}
                maxLength={12}
                editable={!processing}
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 10,
                  padding: 12,
                  fontSize: 18,
                  fontWeight: "700",
                  letterSpacing: 2,
                  color: theme.text,
                  backgroundColor: theme.surface,
                }}
              />
              <Text style={{ opacity: 0.72, fontSize: 13, lineHeight: 18, color: theme.text }}>
                {t("redeem.manualFormatHelp", {
                  defaultValue: "Enter the 6-character code shown under the customer's QR. Spaces and dashes are okay.",
                })}
              </Text>
              {!claimCodeComplete ? (
                <Text style={{ opacity: 0.78, fontSize: 13, lineHeight: 18, color: theme.mutedText }}>
                  {t("redeem.manualIncompleteHint", { defaultValue: "Enter all 6 characters to redeem." })}
                </Text>
              ) : null}
              <PrimaryButton
                title={processing ? t("redeem.redeeming") : t("redeem.redeemButton")}
                onPress={() => void onManualRedeem()}
                disabled={manualRedeemDisabled}
              />
            </ScrollView>
          ) : !permission ? (
            <View style={{ gap: Spacing.sm }}>
              <ActivityIndicator color={theme.primary} />
              <Text style={{ opacity: 0.7, color: theme.text }}>
                {t("redeem.cameraChecking", { defaultValue: "Checking camera permission..." })}
              </Text>
            </View>
          ) : !permission.granted ? (
            <View style={{ gap: Spacing.md }}>
              <Text style={{ opacity: 0.7, color: theme.text }}>
                {cameraPermissionBlocked
                  ? t("redeem.cameraBlocked", {
                      defaultValue:
                        "Camera access is blocked. Open Android settings to allow camera, or enter the ticket code instead.",
                    })
                  : t("redeem.cameraRequired")}
              </Text>
              {cameraPermissionError ? <Banner message={cameraPermissionError} tone="error" /> : null}
              <PrimaryButton
                title={
                  cameraPermissionBlocked
                    ? t("redeem.openCameraSettings", { defaultValue: "Open camera settings" })
                    : cameraPermissionRequesting
                      ? t("redeem.requestingCamera")
                      : t("redeem.grantPermission")
                }
                accessibilityLabel={
                  cameraPermissionBlocked
                    ? t("redeem.openCameraSettings", { defaultValue: "Open camera settings" })
                    : t("redeem.grantPermission")
                }
                testID={cameraPermissionBlocked ? "redeem-open-camera-settings" : "redeem-grant-camera-permission"}
                onPress={() => {
                  if (cameraPermissionBlocked) {
                    void openCameraSettings();
                    return;
                  }
                  void requestCameraAccess();
                }}
                disabled={cameraPermissionRequesting}
              />
              <SecondaryButton
                title={t("redeem.manualFallbackCta", { defaultValue: "Enter ticket code instead" })}
                accessibilityLabel={t("redeem.manualFallbackCta", { defaultValue: "Enter ticket code instead" })}
                testID="redeem-camera-manual-fallback"
                onPress={() => setMode("manual")}
                disabled={processing}
              />
            </View>
          ) : (
            <>
              {!scannerActive ? (
                <View
                  style={{
                    gap: Spacing.md,
                    borderRadius: Radii.lg,
                    borderWidth: 1,
                    borderColor: theme.border,
                    backgroundColor: theme.surface,
                    padding: Spacing.lg,
                  }}
                >
                  <Text style={{ color: theme.text, fontWeight: "800", fontSize: 16 }}>
                    {t("redeem.modeScan")}
                  </Text>
                  <Text style={{ color: theme.mutedText, fontSize: 14, lineHeight: 20 }}>
                    {t("redeem.scanPrimaryHint")}
                  </Text>
                  <PrimaryButton
                    title={t("redeem.modeScan")}
                    onPress={() => {
                      setScanned(false);
                      setScannerActive(true);
                    }}
                    disabled={processing}
                  />
                  <SecondaryButton
                    title={t("redeem.manualFallbackCta", { defaultValue: "Enter ticket code instead" })}
                    onPress={() => setMode("manual")}
                    disabled={processing}
                  />
                </View>
              ) : (
                <>
                  <View
                    style={{
                      borderRadius: 18,
                      overflow: "hidden",
                      backgroundColor: "#000",
                      height: cameraBlockHeight,
                    }}
                  >
                    <CameraView
                      style={{ height: "100%", width: "100%" }}
                      facing="back"
                      onBarcodeScanned={scanned || processing ? undefined : (result) => void onScan(result.data)}
                      barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    />
                    {processing ? (
                      <View
                        style={{
                          position: "absolute",
                          inset: 0,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: "rgba(0,0,0,0.5)",
                        }}
                      >
                        <ActivityIndicator size="large" color="#fff" />
                        <Text style={{ color: "#fff", marginTop: 8 }}>{t("redeem.redeeming")}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => setScanned(false)}
                    style={{
                      marginTop: Spacing.sm,
                      paddingVertical: Spacing.md,
                      borderRadius: 12,
                      backgroundColor: theme.surfaceMuted,
                    }}
                  >
                    <Text style={{ textAlign: "center", fontWeight: "700", color: theme.text }}>{t("redeem.scanNext")}</Text>
                  </Pressable>
                  <SecondaryButton
                    title={t("redeem.manualFallbackCta", { defaultValue: "Enter ticket code instead" })}
                    onPress={() => setMode("manual")}
                  />
                </>
              )}
            </>
          )}
        </View>
      )}
      <ReportSheet
        visible={reportVisible}
        mode="user"
        subjectLabel={success?.dealTitle ?? ""}
        onDismiss={() => setReportVisible(false)}
        onSubmit={async ({ reason, comment }) => {
          if (!success?.claimId) return { ok: false };
          const result = await submitUserReport({
            claimId: success.claimId,
            reason: reason as UserReportReason,
            comment,
          });
          return { ok: result.ok };
        }}
      />
      <IosDoneInputAccessory
        label={
          ownerPinGateActive
            ? ownerPinSubmitting
              ? t("commonUi.unlocking", { defaultValue: "Unlocking..." })
              : t("commonUi.unlock", { defaultValue: "Unlock" })
            : processing
              ? t("redeem.redeeming")
              : t("redeem.redeemButton")
        }
        onPress={() => {
          if (ownerPinGateActive) {
            void unlockOwnerRedeem();
            return;
          }
          void onManualRedeem();
        }}
      />
    </View>
    </KeyboardScreen>
  );
}
