import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

/**
 * Claim/redeem celebration overlay.
 *
 * Lifted out of `qr-modal.tsx` so the confetti survives that modal's removal:
 * claiming no longer reveals a QR (the code is held back until the customer
 * starts the Use Deal pass), but it still deserves a confirmation.
 *
 * Renders absolutely-positioned at the top of whatever it is mounted in, and is
 * pointer-transparent, so it never blocks the screen underneath.
 */
type ClaimSuccessToastProps = {
  /** Bump to replay. `0` renders nothing — no toast on first mount. */
  nonce: number;
  variant?: "claimed" | "redeemed";
  /** Line under the heading. Defaults to the "it's in your wallet" copy. */
  subtitle?: string;
};

type ConfettiParticleSpec = {
  dx: number;
  dy: number;
  size: number;
  rotate: number;
  color: string;
};

const TOAST_DISPLAY_MS = 3000;

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

export function ClaimSuccessToast({ nonce, variant = "claimed", subtitle }: ClaimSuccessToastProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const [visible, setVisible] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-14);
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

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  useEffect(() => {
    if (!nonce) return;

    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;

    setVisible(true);
    opacity.value = 0;
    translateY.value = -14;
    confettiProgress.value = 0;

    opacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) });
    confettiProgress.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.quad) });

    showTimerRef.current = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.cubic) });
      translateY.value = withTiming(-10, { duration: 180, easing: Easing.in(Easing.cubic) });
      hideTimerRef.current = setTimeout(() => setVisible(false), 220);
    }, TOAST_DISPLAY_MS);

    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    };
  }, [nonce, opacity, translateY, confettiProgress]);

  if (!visible) return null;

  const heading = variant === "redeemed" ? t("dealStatus.redeemed") : t("dealStatus.claimed");
  const sub =
    subtitle ??
    (variant === "redeemed"
      ? t("consumerWallet.redeemedConfirmSub")
      : t("dealsBrowse.claimedInWallet", { defaultValue: "Saved to your wallet. Open it at the counter." }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: Math.max(12, insets.top + 10),
          left: 16,
          right: 16,
          alignItems: "center",
          pointerEvents: "none",
          zIndex: 50,
        },
        animatedStyle,
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
        accessibilityLiveRegion="polite"
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
            <Text
              style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              maxFontSizeMultiplier={1.15}
            >
              {heading}
            </Text>
            <Text
              style={{ color: "rgba(255,255,255,0.72)", marginTop: 2, fontSize: 12, fontWeight: "700" }}
              numberOfLines={2}
              maxFontSizeMultiplier={1.15}
            >
              {sub}
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
              <ConfettiParticle key={idx} p={p} progress={confettiProgress} />
            ))}
          </View>
        </View>
      </View>
    </Animated.View>
  );
}
