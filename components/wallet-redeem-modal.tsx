import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Modal, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import QRCode from "react-native-qrcode-svg";
import { Colors, Controls, Gray, Radii } from "@/constants/theme";
import { formatAppDateTime } from "@/lib/i18n/format-datetime";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";
import { useColorScheme } from "@/hooks/use-color-scheme";

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
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
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
    <Modal visible={visible} transparent animationType="fade" accessibilityViewIsModal onRequestClose={onHide}>
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
            backgroundColor: expired ? Gray[900] : theme.surface,
            borderRadius: Radii.lg,
            padding: 18,
            paddingBottom: Math.max(18, insets.bottom + 10),
            width: "100%",
            maxWidth: 400,
            borderWidth: 3,
            borderColor: expired ? "#7f1d1d" : theme.primary,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <View
              style={{
                flexShrink: 1,
                backgroundColor: expired ? "#450a0a" : colorScheme === "dark" ? "rgba(255,159,28,0.14)" : "#fff7ed",
                borderWidth: 1,
                borderColor: expired ? "#7f1d1d" : colorScheme === "dark" ? "rgba(255,159,28,0.36)" : "#fed7aa",
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: Radii.sm,
              }}
            >
              <Text
                style={{
                  fontWeight: "900",
                  fontSize: 12,
                  letterSpacing: 0.6,
                  color: expired ? "#fecaca" : theme.accentText,
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                maxFontSizeMultiplier={1.15}
              >
                {expired ? t("consumerWallet.verifyExpired") : t("consumerWallet.verifyActive")}
              </Text>
            </View>
            <Text style={{ fontSize: 12, opacity: 0.65, color: expired ? "#fca5a5" : theme.mutedText, flexShrink: 0 }} maxFontSizeMultiplier={1.15}>
              {formatClock(nowMs, i18n.language)}
            </Text>
          </View>

          <Text style={{ fontSize: 13, opacity: 0.75, color: expired ? "#fca5a5" : theme.mutedText }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
            {businessName}
          </Text>
          <Text
            style={{
              fontSize: 18,
              fontWeight: "800",
              marginTop: 4,
              marginBottom: 12,
              color: expired ? "#fff" : theme.text,
            }}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            maxFontSizeMultiplier={1.15}
          >
            {dealTitle}
          </Text>

          {claimedAt ? (
            <Text style={{ fontSize: 12, opacity: 0.6, marginBottom: 8, color: expired ? Gray[300] : Gray[500] }} numberOfLines={2} maxFontSizeMultiplier={1.15}>
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
            {!expired ? (
              <Text
                style={{ textAlign: "center", fontSize: 12, fontWeight: "900", color: "#9a3412", marginBottom: 8 }}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                maxFontSizeMultiplier={1.15}
              >
                {t("consumerWallet.scanQrAtCounter")}
              </Text>
            ) : null}
            {token && !expired ? (
              <View
                style={{
                  padding: 10,
                  borderRadius: Radii.lg,
                  borderWidth: 2,
              borderColor: theme.primary,
                  backgroundColor: "#fff",
                }}
              >
                <QRCode value={token} size={190} />
              </View>
            ) : null}
            {token && expired ? (
              <View style={{ width: 200, height: 200, backgroundColor: Gray[700], borderRadius: Radii.md, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: Gray[400], fontWeight: "700", textAlign: "center", padding: 16 }} maxFontSizeMultiplier={1.15}>
                  {t("consumerWallet.verifyQrDisabled")}
                </Text>
              </View>
            ) : null}
          </Animated.View>

          <View
            style={{
              backgroundColor: expired ? Gray[800] : Gray[50],
              borderRadius: Radii.md,
              padding: 14,
              marginBottom: 12,
              borderWidth: 1,
              borderColor: expired ? Gray[700] : Gray[200],
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: "800",
                opacity: 0.55,
                letterSpacing: 0.5,
                color: expired ? Gray[400] : Gray[500],
              }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.76}
              maxFontSizeMultiplier={1.15}
            >
              {t("consumerWallet.verifyCountdown")}
            </Text>
            <Text
              style={{ fontSize: 28, fontWeight: "900", marginTop: 4, color: expired ? "#F87171" : Gray[900] }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
              maxFontSizeMultiplier={1.1}
            >
              {expired ? t("consumerWallet.verifyTimeUp") : countdownLabel}
            </Text>
            {expiresAt ? (
              <Text style={{ fontSize: 12, opacity: 0.65, marginTop: 6, color: expired ? Gray[400] : Gray[500] }} numberOfLines={2} maxFontSizeMultiplier={1.15}>
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
                color: expired ? Gray[400] : Gray[500],
              }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.76}
              maxFontSizeMultiplier={1.15}
            >
              {t("consumerWallet.verifyCodeLabel")}
            </Text>
            <Text
              style={{
                fontSize: 32,
                fontWeight: "900",
                letterSpacing: 4,
                marginTop: 6,
                color: expired ? Gray[500] : Gray[900],
              }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.68}
              maxFontSizeMultiplier={1.1}
            >
              {codeDisplay}
            </Text>
            <Text style={{ fontSize: 12, opacity: 0.55, marginTop: 8, textAlign: "center", color: expired ? Gray[400] : Gray[500] }} maxFontSizeMultiplier={1.15}>
              {t("consumerWallet.verifyStaffHint")}
            </Text>
          </View>

          <HapticScalePressable
            onPress={onHide}
            style={{
              minHeight: Controls.buttonHeight,
              justifyContent: "center",
              borderRadius: Radii.md,
              backgroundColor: expired ? Gray[700] : theme.primary,
              marginBottom: 8,
            }}
          >
            <Text
              style={{ color: expired ? "#fff" : theme.primaryText, fontWeight: "800", textAlign: "center" }}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              maxFontSizeMultiplier={1.15}
            >
              {t("consumerWallet.hideQr")}
            </Text>
          </HapticScalePressable>
          {onRefresh && !expired ? (
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
              <Text
                style={{ color: Gray[700], fontWeight: "700", textAlign: "center" }}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                maxFontSizeMultiplier={1.15}
              >
                {refreshing ? t("consumerWallet.refreshingQrModal") : t("consumerWallet.refreshQr")}
              </Text>
            </HapticScalePressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
