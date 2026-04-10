import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
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
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";

type RedeemMode = "scan" | "manual";

function normalizeClaimCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export default function RedeemScanner() {
  const { t, i18n } = useTranslation();
  const { height: winH } = useWindowDimensions();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const router = useRouter();
  const { isLoggedIn, businessId, loading } = useBusiness();
  const [banner, setBanner] = useState<{ message: string; tone?: "error" | "success" | "info" } | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<RedeemMode>("scan");
  const [scanned, setScanned] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState<{ dealTitle: string; redeemedAt: string } | null>(null);
  const [claimCodeInput, setClaimCodeInput] = useState("");

  // Clear stale success/error state when tab regains focus
  useFocusEffect(
    useCallback(() => {
      setSuccess(null);
      setBanner(null);
      setScanned(false);
    }, []),
  );

  useEffect(() => {
    setBanner(null);
    setScanned(false);
  }, [mode]);

  async function runRedeem(body: { token?: string; short_code?: string }) {
    if (processing) return;
    setProcessing(true);
    setBanner(null);
    try {
      const result = await redeemToken(body);
      setSuccess({
        dealTitle: result.deal_title ?? t("redeem.defaultDealTitle"),
        redeemedAt: result.redeemed_at,
      });
      setClaimCodeInput("");
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : t("redeem.errRedeemFailed");
      setBanner({ message: translateKnownApiMessage(String(raw), t), tone: "error" });
      setScanned(false);
    } finally {
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
    const code = normalizeClaimCode(claimCodeInput);
    if (code.length < 4) {
      setBanner({ message: t("redeem.errCodeRequired"), tone: "error" });
      return;
    }
    await runRedeem({ short_code: code });
  }

  const cameraBlockHeight = Math.round(Math.min(420, Math.max(260, winH * 0.42)));

  return (
    <KeyboardScreen>
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("redeem.title")}</Text>
      {!success ? (
        <Text style={{ marginTop: Spacing.sm, fontSize: 14, opacity: 0.72, lineHeight: 20 }}>
          {mode === "scan" ? t("redeem.scanPrimaryHint") : t("redeem.manualFallbackHint")}
        </Text>
      ) : null}
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {!isLoggedIn ? (
        <Text style={{ marginTop: Spacing.lg, opacity: 0.7 }}>{t("redeem.loginPrompt")}</Text>
      ) : loading ? (
        <Text style={{ marginTop: Spacing.lg, opacity: 0.7 }}>{t("redeem.loading")}</Text>
      ) : !businessId ? (
        <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("redeem.createHeader")}</Text>
          <Text style={{ opacity: 0.7 }}>{t("redeem.createBody")}</Text>
          <PrimaryButton title={t("redeem.startBusinessSetup")} onPress={() => router.push("/business-setup")} />
        </View>
      ) : success ? (
        <View style={{ marginTop: Spacing.lg, paddingBottom: scrollBottom }}>
          <View
            style={{
              borderRadius: 18,
              padding: Spacing.lg,
              backgroundColor: "#e8f5e9",
            }}
          >
            <Text style={{ fontWeight: "700", fontSize: 17 }}>{t("redeem.redeemed")}</Text>
            <Text style={{ marginTop: Spacing.sm, fontSize: 16 }}>{success.dealTitle}</Text>
            <Text style={{ marginTop: Spacing.sm, opacity: 0.72, fontSize: 14 }}>
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
        </View>
      ) : (
        <View style={{ marginTop: Spacing.lg, flex: 1, paddingBottom: scrollBottom, gap: Spacing.md }}>
          <View style={{ flexDirection: "row", gap: Spacing.sm }}>
            <Pressable
              onPress={() => setMode("scan")}
              style={{
                flex: 1,
                paddingVertical: Spacing.sm,
                borderRadius: 12,
                backgroundColor: mode === "scan" ? "#111" : "#eee",
                alignItems: "center",
              }}
            >
              <Text style={{ fontWeight: "700", color: mode === "scan" ? "#fff" : "#333" }}>{t("redeem.modeScan")}</Text>
            </Pressable>
            <Pressable
              onPress={() => setMode("manual")}
              style={{
                flex: 1,
                paddingVertical: Spacing.sm,
                borderRadius: 12,
                backgroundColor: mode === "manual" ? "#111" : "#eee",
                alignItems: "center",
              }}
            >
              <Text style={{ fontWeight: "700", color: mode === "manual" ? "#fff" : "#333" }}>{t("redeem.modeManual")}</Text>
            </Pressable>
          </View>

          {mode === "manual" ? (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ gap: Spacing.md, paddingBottom: scrollBottom }}
              {...FORM_SCROLL_KEYBOARD_PROPS}
            >
              <Text style={{ opacity: 0.72, fontSize: 14, lineHeight: 20 }}>{t("redeem.manualHelp")}</Text>
              <TextInput
                value={claimCodeInput}
                onChangeText={setClaimCodeInput}
                placeholder={t("redeem.manualPlaceholder")}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={8}
                editable={!processing}
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  fontSize: 18,
                  fontWeight: "700",
                  letterSpacing: 2,
                }}
              />
              <PrimaryButton
                title={processing ? t("redeem.redeeming") : t("redeem.redeemButton")}
                onPress={() => void onManualRedeem()}
                disabled={processing}
              />
            </ScrollView>
          ) : !permission ? (
            <View>
              <Text style={{ opacity: 0.7 }}>{t("redeem.requestingCamera")}</Text>
            </View>
          ) : !permission.granted ? (
            <View>
              <Text style={{ opacity: 0.7, marginBottom: Spacing.md }}>{t("redeem.cameraRequired")}</Text>
              <PrimaryButton title={t("redeem.grantPermission")} onPress={requestPermission} />
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
                  backgroundColor: "#eee",
                }}
              >
                <Text style={{ textAlign: "center", fontWeight: "700" }}>{t("redeem.scanNext")}</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
    </KeyboardScreen>
  );
}
