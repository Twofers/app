import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Text,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import QRCode from "react-native-qrcode-svg";
import { formatAppDateTime } from "@/lib/i18n/format-datetime";
import { completeVisualRedeem } from "@/lib/functions";
import { Spacing } from "@/lib/screen-layout";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";

type WalletVisualPassModalProps = {
  visible: boolean;
  claimId: string;
  businessName: string;
  dealTitle: string;
  shortCode: string | null;
  token: string | null;
  claimedAt: string | null;
  /** Last moment the claim can be redeemed (instance end + grace), for display. */
  redeemByIso: string | null;
  minCompleteAtIso: string;
  nowMs: number;
  onClose: () => void;
  onRedeemed: () => void;
  onError: (message: string) => void;
};

function formatClock(ms: number, lang: string) {
  return new Intl.DateTimeFormat(lang, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(ms));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function WalletVisualPassModal({
  visible,
  claimId,
  businessName,
  dealTitle,
  shortCode,
  token,
  claimedAt,
  redeemByIso,
  minCompleteAtIso,
  nowMs,
  onClose,
  onRedeemed,
  onError,
}: WalletVisualPassModalProps) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const pulseScale = useSharedValue(1);
  const [completing, setCompleting] = useState(false);
  const completingRef = useRef(false);
  const completeOnce = useRef(false);

  useEffect(() => {
    if (!visible) {
      completeOnce.current = false;
      completingRef.current = false;
      setCompleting(false);
    }
  }, [visible]);

  const minCompleteMs = useMemo(() => new Date(minCompleteAtIso).getTime(), [minCompleteAtIso]);

  const remainingSec = useMemo(() => {
    if (!visible) return 15;
    return Math.max(0, Math.ceil((minCompleteMs - nowMs) / 1000));
  }, [visible, minCompleteMs, nowMs]);

  const pulseAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  useEffect(() => {
    if (visible) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.03, { duration: 900, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        ),
        -1, // infinite
      );
    } else {
      cancelAnimation(pulseScale);
      pulseScale.value = 1;
    }
    return () => cancelAnimation(pulseScale);
  }, [visible, pulseScale]);

  const runComplete = useCallback(async () => {
    if (completingRef.current) return;
    completingRef.current = true;
    setCompleting(true);
    try {
      for (let i = 0; i < 10; i++) {
        try {
          await completeVisualRedeem(claimId);
          completingRef.current = false;
          setCompleting(false);
          onRedeemed();
          return;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "";
          if (msg.includes("not finished yet") || msg.includes("Redemption window")) {
            await sleep(600);
            continue;
          }
          throw e;
        }
      }
      throw new Error(t("consumerWallet.passCompleteError"));
    } catch (e: unknown) {
      completingRef.current = false;
      setCompleting(false);
      onError(e instanceof Error ? e.message : t("consumerWallet.passCompleteError"));
    }
  }, [claimId, onRedeemed, onError, t]);

  useEffect(() => {
    if (!visible || completeOnce.current || completingRef.current) return;
    if (nowMs >= minCompleteMs) {
      completeOnce.current = true;
      void runComplete();
    }
  }, [visible, minCompleteMs, nowMs, runComplete]);

  const codeDisplay = shortCode
    ? `${shortCode.slice(0, 3)} ${shortCode.slice(3)}`
    : t("consumerWallet.codeLegacyQrOnly");

  function confirmClose() {
    if (completing || completingRef.current) return;
    if (remainingSec > 0) {
      Alert.alert(t("consumerWallet.passCloseEarlyTitle"), t("consumerWallet.passCloseEarlyBody"), [
        { text: t("commonUi.cancel"), style: "cancel" },
        {
          text: t("consumerWallet.passCloseEarlyConfirm"),
          style: "default",
          onPress: () => onClose(),
        },
      ]);
      return;
    }
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={confirmClose} accessibilityViewIsModal>
      <View
        style={{
          flex: 1,
          backgroundColor: "#052e16",
          paddingTop: insets.top + 12,
          paddingBottom: Math.max(insets.bottom, 16),
          paddingHorizontal: 20,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <View
            style={{
              backgroundColor: "#22c55e",
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 10,
            }}
          >
            <Text style={{ color: "#052e16", fontWeight: "900", fontSize: 12, letterSpacing: 1 }}>
              {t("consumerWallet.passRedeemingBadge")}
            </Text>
          </View>
          <Text style={{ color: "#86efac", fontSize: 13, fontWeight: "600" }}>
            {formatClock(nowMs, i18n.language)}
          </Text>
        </View>

        <Text style={{ color: "#bbf7d0", fontSize: 14 }} numberOfLines={1}>
          {businessName}
        </Text>
        <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900", marginTop: 6, marginBottom: 16 }} numberOfLines={3}>
          {dealTitle}
        </Text>

        {claimedAt ? (
          <Text style={{ color: "#86efac", fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
            {t("consumerWallet.claimedRecord", { datetime: formatAppDateTime(claimedAt, i18n.language) })}
          </Text>
        ) : null}
        {redeemByIso ? (
          <Text style={{ color: "#86efac", fontSize: 12, opacity: 0.85, marginBottom: 20 }}>
            {t("consumerWallet.passRedeemByLine", { datetime: formatAppDateTime(redeemByIso, i18n.language) })}
          </Text>
        ) : null}

        <View
          style={{
            backgroundColor: "#14532d",
            borderRadius: 20,
            padding: 20,
            borderWidth: 2,
            borderColor: "#22c55e",
            marginBottom: 20,
          }}
        >
          <Text style={{ color: "#bbf7d0", fontSize: 12, fontWeight: "800", letterSpacing: 0.5 }}>
            {t("consumerWallet.passStaffCountdown")}
          </Text>
          {completing ? (
            <View style={{ marginTop: 16, alignItems: "center", gap: 12 }}>
              <ActivityIndicator color="#fff" size="large" />
              <Text style={{ color: "#fff", fontWeight: "700" }}>{t("consumerWallet.passCompleting")}</Text>
            </View>
          ) : (
            <Text style={{ color: "#fff", fontSize: 56, fontWeight: "900", marginTop: 8 }}>
              {remainingSec}
              <Text style={{ fontSize: 22 }}> {t("consumerWallet.passSecondsUnit")}</Text>
            </Text>
          )}
        </View>

        <Animated.View style={[{ alignSelf: "center", marginBottom: 16 }, pulseAnimatedStyle]}>
          {token ? <QRCode value={token} size={140} backgroundColor="#fff" /> : null}
        </Animated.View>

        <View style={{ alignItems: "center", marginBottom: 24 }}>
          <Text style={{ color: "#86efac", fontSize: 11, fontWeight: "800", letterSpacing: 0.5 }}>
            {t("consumerWallet.verifyCodeLabel")}
          </Text>
          <Text style={{ color: "#fff", fontSize: 28, fontWeight: "900", letterSpacing: 6, marginTop: 8 }}>{codeDisplay}</Text>
          <Text style={{ color: "#86efac", fontSize: 12, marginTop: 12, textAlign: "center", opacity: 0.9 }}>
            {t("consumerWallet.passStaffHint")}
          </Text>
        </View>

        <View style={{ flex: 1 }} />

        <HapticScalePressable
          onPress={confirmClose}
          disabled={completing}
          style={{
            paddingVertical: Spacing.md,
            borderRadius: 14,
            backgroundColor: "#166534",
            opacity: completing ? 0.5 : 1,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "800", textAlign: "center" }}>
            {remainingSec > 0 ? t("consumerWallet.passCloseEarly") : t("consumerWallet.passDone")}
          </Text>
        </HapticScalePressable>
      </View>
    </Modal>
  );
}
