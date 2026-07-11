import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Modal, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import QRCode from "react-native-qrcode-svg";
import { formatAppDateTime } from "../lib/i18n/format-datetime";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { Colors, Controls, Gray, PrimaryTint, Radii } from "@/constants/theme";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";
import { DEFAULT_CLAIM_GRACE_MINUTES, getClaimRedeemDeadlineIso } from "@/lib/claim-redeem-deadline";
import { useColorScheme } from "@/hooks/use-color-scheme";

type QrModalProps = {
  visible: boolean;
  token: string | null;
  /** Concrete instance end from the server (`deal_claims.expires_at`). Countdown uses redeem-by = this + grace. */
  expiresAt: string | null;
  shortCode?: string | null;
  graceMinutes?: number;
  successToastNonce?: number;
  /** Which success toast to show when `successToastNonce` changes. Defaults to "claimed". */
  successToastVariant?: "claimed" | "redeemed";
  onHide: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  onShare?: () => void;
  sharing?: boolean;
  shareError?: string | null;
};

type ConfettiParticleSpec = {
  dx: number;
  dy: number;
  size: number;
  rotate: number;
  color: string;
};

function ConfettiParticle({ p, progress }: { p: ConfettiParticleSpec; progress: SharedValue<number> }) {
  const rStyle = useAnimatedStyle(() => {
    const tVal = progress.value;
    return {
      opacity: 1 - tVal,
      transform: [
        { translateX: p.dx * tVal },
        { translateY: p.dy * tVal },
        { rotate: `${p.rotate * tVal}deg` },
        { scale: 1 - tVal * 0.25 },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: p.size,
          height: p.size,
          borderRadius: 2,
          backgroundColor: p.color,
        },
        rStyle,
      ]}
    />
  );
}

export function QrModal({
  visible,
  token,
  expiresAt,
  shortCode = null,
  graceMinutes = DEFAULT_CLAIM_GRACE_MINUTES,
  successToastNonce = 0,
  successToastVariant = "claimed",
  onHide,
  onRefresh,
  refreshing,
  onShare,
  sharing,
  shareError,
}: QrModalProps) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const compactModal = height < 760;
  const qrSize = compactModal ? 180 : 210;
  const qrBoxSize = qrSize + 24;
  const [remaining, setRemaining] = useState<string | null>(null);
  const tick = false;
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toastOpacity = useSharedValue(0);
  const toastTranslateY = useSharedValue(-14);
  const confettiProgress = useSharedValue(0);

  const particles = useMemo(() => {
    const colors = ["#FF9F1C", "#FFD166", "#FDE68A", "#FFFFFF", "#FFE6C7"];
    const count = 12;
    return Array.from({ length: count }, (_, idx) => {
      const angle = (idx / count) * Math.PI * 2;
      const radius = 46 + (idx % 6) * 6;
      const dx = Math.cos(angle) * radius;
      const dy = Math.sin(angle) * radius - 12;
      const size = 4 + (idx % 4);
      const rotate = (idx * 27) % 360;
      return { dx, dy, size, rotate, color: colors[idx % colors.length] };
    });
  }, []);

  const toastAnimatedStyle = useAnimatedStyle(() => ({
    opacity: toastOpacity.value,
    transform: [{ translateY: toastTranslateY.value }],
  }));

  const redeemByIso = useMemo(() => {
    if (!expiresAt) return null;
    return getClaimRedeemDeadlineIso(expiresAt, graceMinutes);
  }, [expiresAt, graceMinutes]);

  const codeDisplay = shortCode
    ? `${shortCode.slice(0, 3)} ${shortCode.slice(3)}`
    : t("consumerWallet.codeLegacyQrOnly");
  const qrExpired = !redeemByIso || Date.now() >= new Date(redeemByIso).getTime();

  useEffect(() => {
    if (!redeemByIso) {
      setRemaining(null);
      return;
    }
    const tickRemaining = () => {
      const diff = Math.max(0, Math.floor((new Date(redeemByIso).getTime() - Date.now()) / 1000));
      const hrs = Math.floor(diff / 3600);
      const mins = Math.floor((diff % 3600) / 60);
      const secs = diff % 60;
      if (hrs > 0) {
        setRemaining(`${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`);
      } else {
        setRemaining(`${mins}:${secs.toString().padStart(2, "0")}`);
      }
    };
    tickRemaining();
    const interval = setInterval(tickRemaining, 1000);
    return () => clearInterval(interval);
  }, [redeemByIso]);

  useEffect(() => {
    if (!visible) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
      if (toastHideRef.current) clearTimeout(toastHideRef.current);
      toastHideRef.current = null;
      setToastVisible(false);
      toastOpacity.value = 0;
      toastTranslateY.value = -14;
      confettiProgress.value = 0;
      return;
    }
  }, [visible, toastOpacity, toastTranslateY, confettiProgress]);

  const TOAST_DISPLAY_MS = 3000;

  useEffect(() => {
    if (!visible) return;
    if (!successToastNonce) return;

    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    if (toastHideRef.current) clearTimeout(toastHideRef.current);
    toastHideRef.current = null;

    setToastVisible(true);
    toastOpacity.value = 0;
    toastTranslateY.value = -14;
    confettiProgress.value = 0;

    toastOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
    toastTranslateY.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) });
    confettiProgress.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.quad) });

    toastTimerRef.current = setTimeout(() => {
      toastOpacity.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.cubic) });
      toastTranslateY.value = withTiming(-10, { duration: 180, easing: Easing.in(Easing.cubic) }, () => {});
      toastHideRef.current = setTimeout(() => setToastVisible(false), 220);
    }, TOAST_DISPLAY_MS);

    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
      if (toastHideRef.current) clearTimeout(toastHideRef.current);
      toastHideRef.current = null;
    };
  }, [successToastNonce, visible, toastOpacity, toastTranslateY, confettiProgress]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      accessibilityViewIsModal
      statusBarTranslucent
      onRequestClose={onHide}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.6)",
          paddingHorizontal: 16,
          paddingTop: Math.max(24, insets.top + 12),
          paddingBottom: Math.max(24, insets.bottom + 16),
        }}
      >
        {toastVisible ? (
          <Animated.View
            style={[
              {
                position: "absolute",
                top: Math.max(12, insets.top + 10),
                left: 16,
                right: 16,
                alignItems: "center",
                pointerEvents: "none",
              },
              toastAnimatedStyle,
            ]}
          >
            <View
              style={{
                width: "100%",
                maxWidth: 420,
                borderRadius: 18,
                backgroundColor: "#11181C",
                borderWidth: 1,
                borderColor: "rgba(255,159,28,0.35)",
                paddingVertical: 12,
                paddingHorizontal: 14,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 12,
                    backgroundColor: "rgba(255,159,28,0.14)",
                    borderWidth: 1,
                    borderColor: "rgba(255,159,28,0.35)",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  <Image
                    source={require("../assets/images/twofer-mark-512.png")}
                    style={{ width: 26, height: 26 }}
                    resizeMode="contain"
                    accessibilityIgnoresInvertColors
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} maxFontSizeMultiplier={1.15}>
                    {successToastVariant === "redeemed" ? t("dealStatus.redeemed") : t("dealStatus.claimed")}
                  </Text>
                  <Text style={{ color: "rgba(255,255,255,0.72)", marginTop: 2, fontSize: 12, fontWeight: "700" }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                    {successToastVariant === "redeemed"
                      ? t("consumerWallet.redeemedConfirmSub")
                      : t("consumerWallet.qrModalTitle")}
                  </Text>
                </View>
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: theme.primary,
                  }}
                >
                  <Text style={{ color: "#11181C", fontWeight: "900", fontSize: 12 }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                    {t("commonUi.ok")}
                  </Text>
                </View>
              </View>

              {/* Confetti burst */}
              <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: 10, alignItems: "center", pointerEvents: "none" }}>
                <View renderToHardwareTextureAndroid style={{ position: "absolute", top: 2, width: 1, height: 1 }}>
                  {particles.map((p, idx) => (
                    <ConfettiParticle
                      key={idx}
                      p={p}
                      progress={confettiProgress}
                    />
                  ))}
                </View>
              </View>
            </View>
          </Animated.View>
        ) : null}

        <ScrollView
          style={{ width: "100%" }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center" }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: Radii.lg,
            padding: compactModal ? 14 : 16,
            paddingBottom: 16,
            width: "100%",
            maxWidth: 400,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <Text style={{ flex: 1, fontSize: 18, fontWeight: "800", color: "#11181C" }} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82} maxFontSizeMultiplier={1.15}>
              {t("consumerWallet.qrModalTitle")}
            </Text>
            <View
              style={{
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 5,
                backgroundColor: qrExpired ? "#FEF2F2" : PrimaryTint.surfaceStrong,
                borderWidth: 1,
                borderColor: qrExpired ? "#FECACA" : PrimaryTint.border,
              }}
            >
              <Text
                style={{ fontSize: 11, fontWeight: "900", color: qrExpired ? "#B91C1C" : Colors.light.accentText }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.76}
                maxFontSizeMultiplier={1.15}
              >
                {qrExpired ? t("consumerWallet.verifyExpired") : t("consumerWallet.verifyActive")}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: "center", marginBottom: 10 }}>
            {token && !qrExpired ? (
              <View
                style={{
                  padding: 12,
                  borderRadius: Radii.lg,
                  borderWidth: 2,
                  borderColor: theme.primary,
                  backgroundColor: "#fff",
                }}
              >
                <QRCode value={token} size={qrSize} />
              </View>
            ) : token ? (
              <View
                style={{
                  width: qrBoxSize,
                  height: qrBoxSize,
                  backgroundColor: Gray[100],
                  borderRadius: Radii.md,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: Gray[500], fontWeight: "700", textAlign: "center", padding: 16 }}>
                  {t("consumerWallet.verifyQrDisabled")}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={{ opacity: qrExpired ? 0.95 : 0.75, textAlign: "center", fontWeight: qrExpired ? "800" : "600" }}>
            {t("consumerWallet.qrValidUntil", {
              time: `${remaining ?? "--"}${tick ? " •" : " "}`,
            })}
          </Text>
          {redeemByIso ? (
            <Text style={{ opacity: 0.6, textAlign: "center", marginTop: 4 }}>
              {t("consumerWallet.passRedeemByLine", {
                datetime: formatAppDateTime(redeemByIso, i18n.language),
              })}
            </Text>
          ) : null}
          <Text style={{ opacity: 0.62, textAlign: "center", marginTop: 8, lineHeight: 18, fontSize: 12, color: Gray[600] }}>
            {t("consumerWallet.verifyStaffHint")}
          </Text>

          <View
            style={{
              marginTop: 14,
              padding: 14,
              borderRadius: Radii.md,
              backgroundColor: Gray[50],
              borderWidth: 1,
              borderColor: Gray[200],
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "800", opacity: 0.55, letterSpacing: 0.5, color: Gray[500] }}>
              {t("consumerWallet.verifyCodeLabel")}
            </Text>
            <Text
              style={{
                fontSize: 26,
                fontWeight: "900",
                marginTop: 6,
                letterSpacing: 3,
                color: Gray[900],
                textAlign: "center",
              }}
            >
              {codeDisplay}
            </Text>
          </View>

          <View style={{ marginTop: 14 }}>
            <HapticScalePressable
              onPress={onHide}
              style={{
                minHeight: Controls.buttonHeight,
                justifyContent: "center",
                borderRadius: Radii.md,
                backgroundColor: theme.primary,
                marginBottom: 8,
              }}
            >
              <Text style={{ color: theme.primaryText, fontWeight: "700", textAlign: "center" }} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.15}>
                {t("consumerWallet.hideQr")}
              </Text>
            </HapticScalePressable>
            {onRefresh ? (
              <HapticScalePressable
                onPress={onRefresh}
                disabled={refreshing}
                style={{
                  minHeight: Controls.buttonHeight,
                  justifyContent: "center",
                  borderRadius: Radii.md,
                  backgroundColor: Gray[100],
                  opacity: refreshing ? 0.6 : 1,
                }}
              >
                <Text style={{ color: Gray[700], fontWeight: "700", textAlign: "center" }} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.15}>
                  {refreshing ? t("consumerWallet.refreshingQrModal") : t("consumerWallet.refreshQr")}
                </Text>
              </HapticScalePressable>
            ) : null}
            {onShare ? (
              <>
                <Text style={{ marginTop: 10, color: Gray[600], fontSize: 13, fontWeight: "700", textAlign: "center" }} maxFontSizeMultiplier={1.15}>
                  {t("shareDeal.friendOwnCode", { defaultValue: "They'll get their own claim code." })}
                </Text>
                <HapticScalePressable
                  onPress={onShare}
                  disabled={sharing}
                  style={{
                    marginTop: 8,
                    minHeight: Controls.buttonHeight,
                    justifyContent: "center",
                    borderRadius: Radii.md,
                    borderWidth: 2,
                    borderColor: theme.primary,
                    backgroundColor: "#fff",
                    opacity: sharing ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: theme.primary, fontWeight: "800", textAlign: "center" }} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.15}>
                    {sharing
                      ? t("shareDeal.preparing", { defaultValue: "Preparing link..." })
                      : t("shareDeal.sendToFriend", { defaultValue: "Send to a friend" })}
                  </Text>
                </HapticScalePressable>
                {shareError ? (
                  <Text style={{ marginTop: 8, color: theme.danger, fontSize: 13, fontWeight: "700", textAlign: "center" }} maxFontSizeMultiplier={1.15}>
                    {shareError}
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
