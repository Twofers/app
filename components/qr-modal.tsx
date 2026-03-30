import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Modal, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import QRCode from "react-native-qrcode-svg";
import { formatAppDateTime } from "../lib/i18n/format-datetime";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { Colors } from "@/constants/theme";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";
import { DEFAULT_CLAIM_GRACE_MINUTES, getClaimRedeemDeadlineIso } from "@/lib/claim-redeem-deadline";

type QrModalProps = {
  visible: boolean;
  token: string | null;
  /** Concrete instance end from the server (`deal_claims.expires_at`). Countdown uses redeem-by = this + grace. */
  expiresAt: string | null;
  shortCode?: string | null;
  graceMinutes?: number;
  successToastNonce?: number;
  onHide: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
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
  onHide,
  onRefresh,
  refreshing,
}: QrModalProps) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [remaining, setRemaining] = useState<string | null>(null);
  const [tick, setTick] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toastOpacity = useSharedValue(0);
  const toastTranslateY = useSharedValue(-14);
  const confettiProgress = useSharedValue(0);

  const particles = useMemo(() => {
    const colors = ["#FF9F1C", "#FFD166", "#FDE68A", "#FFFFFF", "#FFE6C7"];
    const count = 18;
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

  useEffect(() => {
    if (!redeemByIso) {
      setRemaining(null);
      return;
    }
    const tickRemaining = () => {
      const diff = Math.max(0, Math.floor((new Date(redeemByIso).getTime() - Date.now()) / 1000));
      const mins = Math.floor(diff / 60);
      const secs = diff % 60;
      setRemaining(`${mins}:${secs.toString().padStart(2, "0")}`);
      setTick((prev) => !prev);
    };
    tickRemaining();
    const interval = setInterval(tickRemaining, 1000);
    return () => clearInterval(interval);
  }, [redeemByIso]);

  useEffect(() => {
    if (!visible) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
      setToastVisible(false);
      toastOpacity.value = 0;
      toastTranslateY.value = -14;
      confettiProgress.value = 0;
      return;
    }
  }, [visible, toastOpacity, toastTranslateY, confettiProgress]);

  useEffect(() => {
    if (!visible) return;
    if (!successToastNonce) return;

    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;

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
      setTimeout(() => setToastVisible(false), 220);
    }, 3000);

    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    };
  }, [successToastNonce, visible, toastOpacity, toastTranslateY, confettiProgress]);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.6)",
          justifyContent: "center",
          alignItems: "center",
          padding: 16,
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
                boxShadow: "0px 10px 18px rgba(0,0,0,0.18)",
                elevation: 10,
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
                    source={require("../assets/images/splash-icon.png")}
                    style={{ width: 26, height: 26 }}
                    resizeMode="contain"
                    accessibilityIgnoresInvertColors
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16, letterSpacing: -0.2 }}>
                    Deal Claimed!
                  </Text>
                  <Text style={{ color: "rgba(255,255,255,0.72)", marginTop: 2, fontSize: 12, fontWeight: "700" }}>
                    {t("consumerWallet.qrModalTitle")}
                  </Text>
                </View>
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: Colors.light.primary,
                  }}
                >
                  <Text style={{ color: "#11181C", fontWeight: "900", fontSize: 12 }}>OK</Text>
                </View>
              </View>

              {/* Confetti burst */}
              <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: 10, alignItems: "center", pointerEvents: "none" }}>
                <View style={{ position: "absolute", top: 2, width: 1, height: 1 }}>
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

        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 18,
            padding: 16,
            paddingBottom: Math.max(16, insets.bottom + 8),
            width: "100%",
            maxWidth: 400,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 10 }}>
            {t("consumerWallet.qrModalTitle")}
          </Text>
          <View style={{ alignItems: "center", marginBottom: 10 }}>
            {token && redeemByIso && Date.now() < new Date(redeemByIso).getTime() ? (
              <QRCode value={token} size={220} />
            ) : token ? (
              <View
                style={{
                  width: 220,
                  height: 220,
                  backgroundColor: "#f4f4f5",
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#71717a", fontWeight: "700", textAlign: "center", padding: 16 }}>
                  {t("consumerWallet.verifyQrDisabled")}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={{ opacity: 0.75, textAlign: "center" }}>
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

          <View
            style={{
              marginTop: 14,
              padding: 14,
              borderRadius: 14,
              backgroundColor: "#f8fafc",
              borderWidth: 1,
              borderColor: "#e2e8f0",
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "800", opacity: 0.55, letterSpacing: 0.5, color: "#64748b" }}>
              {t("consumerWallet.verifyCodeLabel")}
            </Text>
            <Text
              style={{
                fontSize: 26,
                fontWeight: "900",
                marginTop: 6,
                letterSpacing: 3,
                color: "#0f172a",
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
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: "#111",
                marginBottom: 8,
              }}
            >
              <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>
                {t("consumerWallet.hideQr")}
              </Text>
            </HapticScalePressable>
            {onRefresh ? (
              <HapticScalePressable
                onPress={onRefresh}
                style={{
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: "#eee",
                }}
              >
                <Text style={{ color: "#111", fontWeight: "700", textAlign: "center" }}>
                  {refreshing ? t("consumerWallet.refreshingQrModal") : t("consumerWallet.refreshQr")}
                </Text>
              </HapticScalePressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
