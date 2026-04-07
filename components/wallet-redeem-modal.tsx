import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Modal, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import QRCode from "react-native-qrcode-svg";
import { formatAppDateTime } from "@/lib/i18n/format-datetime";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";

type WalletRedeemModalProps = {
  visible: boolean;
  token: string | null;
  shortCode: string | null;
  expiresAt: string | null;
  claimedAt: string | null;
  businessName: string;
  dealTitle: string;
  nowMs: number;
  onHide: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
};

function formatClock(ms: number, lang: string) {
  return new Intl.DateTimeFormat(lang, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(ms));
}

export function WalletRedeemModal({
  visible,
  token,
  shortCode,
  expiresAt,
  claimedAt,
  businessName,
  dealTitle,
  nowMs,
  onHide,
  onRefresh,
  refreshing,
}: WalletRedeemModalProps) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.04,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    if (visible) loop.start();
    else loop.stop();
    return () => loop.stop();
  }, [visible, pulse]);

  const expired = useMemo(() => {
    if (!expiresAt) return true;
    return new Date(expiresAt).getTime() <= nowMs;
  }, [expiresAt, nowMs]);

  const remainingSec = useMemo(() => {
    if (!expiresAt || expired) return 0;
    return Math.max(0, Math.floor((new Date(expiresAt).getTime() - nowMs) / 1000));
  }, [expiresAt, nowMs, expired]);

  const countdownLabel = useMemo(() => {
    const m = Math.floor(remainingSec / 60);
    const s = remainingSec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, [remainingSec]);

  const codeDisplay = shortCode
    ? `${shortCode.slice(0, 3)} ${shortCode.slice(3)}`
    : t("consumerWallet.codeLegacyQrOnly");

  return (
    <Modal visible={visible} transparent animationType="fade" accessibilityViewIsModal>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.65)",
          justifyContent: "center",
          alignItems: "center",
          padding: 16,
        }}
      >
        <View
          style={{
            backgroundColor: expired ? "#1a1a1a" : "#fff",
            borderRadius: 20,
            padding: 18,
            paddingBottom: Math.max(18, insets.bottom + 10),
            width: "100%",
            maxWidth: 400,
            borderWidth: 3,
            borderColor: expired ? "#7f1d1d" : "#16a34a",
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <View
              style={{
                backgroundColor: expired ? "#450a0a" : "#dcfce7",
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 8,
              }}
            >
              <Text
                style={{
                  fontWeight: "900",
                  fontSize: 12,
                  letterSpacing: 0.6,
                  color: expired ? "#fecaca" : "#166534",
                }}
              >
                {expired ? t("consumerWallet.verifyExpired") : t("consumerWallet.verifyActive")}
              </Text>
            </View>
            <Text style={{ fontSize: 12, opacity: 0.65, color: expired ? "#fca5a5" : "#444" }}>
              {formatClock(nowMs, i18n.language)}
            </Text>
          </View>

          <Text style={{ fontSize: 13, opacity: 0.75, color: expired ? "#fca5a5" : "#444" }} numberOfLines={1}>
            {businessName}
          </Text>
          <Text
            style={{
              fontSize: 18,
              fontWeight: "800",
              marginTop: 4,
              marginBottom: 12,
              color: expired ? "#fff" : "#111",
            }}
            numberOfLines={2}
          >
            {dealTitle}
          </Text>

          {claimedAt ? (
            <Text style={{ fontSize: 12, opacity: 0.6, marginBottom: 8, color: expired ? "#cbd5e1" : "#64748b" }}>
              {t("consumerWallet.claimedRecord", { datetime: formatAppDateTime(claimedAt, i18n.language) })}
            </Text>
          ) : null}

          <Animated.View
            style={{
              alignSelf: "center",
              marginBottom: 12,
              transform: [{ scale: expired ? 1 : pulse }],
              opacity: expired ? 0.35 : 1,
            }}
          >
            {token && !expired ? <QRCode value={token} size={200} /> : null}
            {token && expired ? (
              <View style={{ width: 200, height: 200, backgroundColor: "#333", borderRadius: 12, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#94a3b8", fontWeight: "700", textAlign: "center", padding: 16 }}>
                  {t("consumerWallet.verifyQrDisabled")}
                </Text>
              </View>
            ) : null}
          </Animated.View>

          <View
            style={{
              backgroundColor: expired ? "#292524" : "#f8fafc",
              borderRadius: 14,
              padding: 14,
              marginBottom: 12,
              borderWidth: 1,
              borderColor: expired ? "#44403c" : "#e2e8f0",
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: "800",
                opacity: 0.55,
                letterSpacing: 0.5,
                color: expired ? "#a8a29e" : "#64748b",
              }}
            >
              {t("consumerWallet.verifyCountdown")}
            </Text>
            <Text style={{ fontSize: 28, fontWeight: "900", marginTop: 4, color: expired ? "#f87171" : "#0f172a" }}>
              {expired ? t("consumerWallet.verifyTimeUp") : countdownLabel}
            </Text>
            {expiresAt ? (
              <Text style={{ fontSize: 12, opacity: 0.65, marginTop: 6, color: expired ? "#a8a29e" : "#64748b" }}>
                {t("consumerWallet.verifyRedeemBy", {
                  datetime: formatAppDateTime(expiresAt, i18n.language),
                })}
              </Text>
            ) : null}
          </View>

          <View style={{ alignItems: "center", marginBottom: 14 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: "800",
                opacity: 0.5,
                letterSpacing: 0.5,
                color: expired ? "#a8a29e" : "#64748b",
              }}
            >
              {t("consumerWallet.verifyCodeLabel")}
            </Text>
            <Text
              style={{
                fontSize: 32,
                fontWeight: "900",
                letterSpacing: 4,
                marginTop: 6,
                color: expired ? "#78716c" : "#111",
              }}
            >
              {codeDisplay}
            </Text>
            <Text style={{ fontSize: 12, opacity: 0.55, marginTop: 8, textAlign: "center", color: expired ? "#a8a29e" : "#64748b" }}>
              {t("consumerWallet.verifyStaffHint")}
            </Text>
          </View>

          <HapticScalePressable
            onPress={onHide}
            style={{
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor: expired ? "#44403c" : "#111",
              marginBottom: 8,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "800", textAlign: "center" }}>{t("consumerWallet.hideQr")}</Text>
          </HapticScalePressable>
          {onRefresh && !expired ? (
            <HapticScalePressable
              onPress={onRefresh}
              style={{
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: "#e5e5e5",
              }}
            >
              <Text style={{ color: "#111", fontWeight: "700", textAlign: "center" }}>
                {refreshing ? t("consumerWallet.refreshingQrModal") : t("consumerWallet.refreshQr")}
              </Text>
            </HapticScalePressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
