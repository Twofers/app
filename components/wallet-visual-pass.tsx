import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { Spacing } from "@/lib/screen-layout";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";
import { useBrandedConfirm } from "@/hooks/use-branded-confirm";

const PASS_VISIBLE_MS = 30_000;

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
  nowMs: number;
  onClose: () => void;
};

function formatClock(ms: number, lang: string) {
  return new Intl.DateTimeFormat(lang, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(ms));
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
  nowMs,
  onClose,
}: WalletVisualPassModalProps) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { confirm, confirmModal } = useBrandedConfirm();
  const pulseScale = useSharedValue(1);
  const [windowStartedAtMs, setWindowStartedAtMs] = useState(() => Date.now());
  const previousClaimIdRef = useRef(claimId);

  useEffect(() => {
    if (visible && previousClaimIdRef.current !== claimId) {
      previousClaimIdRef.current = claimId;
      setWindowStartedAtMs(Date.now());
    }
    if (visible) setWindowStartedAtMs(Date.now());
  }, [claimId, visible]);

  const windowEndsAtMs = useMemo(() => windowStartedAtMs + PASS_VISIBLE_MS, [windowStartedAtMs]);

  const remainingSec = useMemo(() => {
    if (!visible) return 30;
    return Math.max(0, Math.ceil((windowEndsAtMs - nowMs) / 1000));
  }, [visible, windowEndsAtMs, nowMs]);
  const qrWindowActive = remainingSec > 0;

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

  const codeDisplay = shortCode
    ? `${shortCode.slice(0, 3)} ${shortCode.slice(3)}`
    : t("consumerWallet.codeLegacyQrOnly");

  function confirmClose() {
    if (qrWindowActive) {
      confirm({
        iconName: "schedule",
        title: t("consumerWallet.passCloseEarlyTitle"),
        message: t("consumerWallet.passCloseEarlyBody"),
        confirmLabel: t("consumerWallet.passCloseEarlyConfirm"),
        onConfirm: () => onClose(),
        cancelLabel: t("commonUi.cancel"),
      });
      return;
    }
    onClose();
  }

  const redeployPass = useCallback(() => {
    setWindowStartedAtMs(Date.now());
  }, []);

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
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: Spacing.sm, marginBottom: 16 }}>
          <View
            style={{
              flexShrink: 1,
              backgroundColor: "#22c55e",
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 10,
            }}
          >
            <Text
              style={{ color: "#052e16", fontWeight: "900", fontSize: 12, letterSpacing: 1 }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              maxFontSizeMultiplier={1.15}
            >
            {t("consumerWallet.passRedeemingBadge")}
            </Text>
          </View>
          <Text style={{ color: "#86efac", fontSize: 13, fontWeight: "600", flexShrink: 0 }} maxFontSizeMultiplier={1.15}>
            {formatClock(nowMs, i18n.language)}
          </Text>
        </View>

        <Text style={{ color: "#bbf7d0", fontSize: 14 }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
          {businessName}
        </Text>
        <Text
          style={{ color: "#fff", fontSize: 22, fontWeight: "900", marginTop: 6, marginBottom: 16 }}
          numberOfLines={3}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
          maxFontSizeMultiplier={1.15}
        >
          {dealTitle}
        </Text>

        {claimedAt ? (
          <Text style={{ color: "#86efac", fontSize: 12, opacity: 0.85, marginBottom: 8 }} numberOfLines={2} maxFontSizeMultiplier={1.15}>
            {t("consumerWallet.claimedRecord", { datetime: formatAppDateTime(claimedAt, i18n.language) })}
          </Text>
        ) : null}
        {redeemByIso ? (
          <Text style={{ color: "#86efac", fontSize: 12, opacity: 0.85, marginBottom: 20 }} numberOfLines={2} maxFontSizeMultiplier={1.15}>
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
          <Text
            style={{ color: "#bbf7d0", fontSize: 12, fontWeight: "800", letterSpacing: 0.5 }}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.76}
            maxFontSizeMultiplier={1.15}
          >
            {qrWindowActive ? t("consumerWallet.passStaffCountdown") : t("consumerWallet.passTimedOutTitle")}
          </Text>
          {qrWindowActive ? (
            <Text style={{ color: "#fff", fontSize: 56, fontWeight: "900", marginTop: 8 }}>
              {remainingSec}
              <Text style={{ fontSize: 22 }}> {t("consumerWallet.passSecondsUnit")}</Text>
            </Text>
          ) : (
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800", marginTop: 12, lineHeight: 25 }}>
              {t("consumerWallet.passTimedOutBody")}
            </Text>
          )}
        </View>

        {qrWindowActive ? (
          <Animated.View style={[{ alignSelf: "center", marginBottom: 16 }, pulseAnimatedStyle]}>
            {token ? <QRCode value={token} size={140} backgroundColor="#fff" /> : null}
          </Animated.View>
        ) : null}

        <View style={{ alignItems: "center", marginBottom: 24, opacity: qrWindowActive ? 1 : 0.48 }}>
          <Text
            style={{ color: "#86efac", fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textAlign: "center" }}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            maxFontSizeMultiplier={1.15}
          >
            {t("consumerWallet.verifyCodeLabel")}
          </Text>
          <Text
            style={{ color: "#fff", fontSize: 28, fontWeight: "900", letterSpacing: 6, marginTop: 8 }}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            maxFontSizeMultiplier={1.1}
          >
            {codeDisplay}
          </Text>
          <Text style={{ color: "#86efac", fontSize: 12, marginTop: 12, textAlign: "center", opacity: 0.9 }} maxFontSizeMultiplier={1.15}>
            {qrWindowActive ? t("consumerWallet.passStaffHint") : t("consumerWallet.passTimedOutHint")}
          </Text>
        </View>

        <View style={{ flex: 1 }} />

        {!qrWindowActive ? (
          <HapticScalePressable
            onPress={redeployPass}
            style={{
              paddingVertical: Spacing.md,
              borderRadius: 14,
              backgroundColor: "#22c55e",
              marginBottom: Spacing.sm,
            }}
          >
            <Text
              style={{ color: "#052e16", fontWeight: "900", textAlign: "center" }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              maxFontSizeMultiplier={1.15}
            >
              {t("consumerWallet.passShowAgain")}
            </Text>
          </HapticScalePressable>
        ) : null}
        <HapticScalePressable
          onPress={confirmClose}
          style={{
            paddingVertical: Spacing.md,
            borderRadius: 14,
            backgroundColor: "#166534",
          }}
        >
          <Text
            style={{ color: "#fff", fontWeight: "800", textAlign: "center" }}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            maxFontSizeMultiplier={1.15}
          >
            {qrWindowActive ? t("consumerWallet.passCloseEarly") : t("consumerWallet.passDone")}
          </Text>
        </HapticScalePressable>
      </View>
      {confirmModal}
    </Modal>
  );
}
