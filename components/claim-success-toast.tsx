import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

/**
 * Claim/redeem celebration — a big dancing penguin throwing confetti across
 * the whole screen. Claiming a deal should feel like a small win, not just
 * flip a button.
 *
 * Rendered in a native `Modal` (same pattern as BrandedConfirmModal /
 * DancingPenguinProgressOverlay) rather than an absolutely-positioned sibling
 * View: a Modal owns its own native window, so it can't get lost behind
 * FlatList/Animated.View layering the way a plain overlay View can.
 */
type ClaimSuccessToastProps = {
  /** Bump to replay. `0` renders nothing — no celebration on first mount. */
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
  delay: number;
};

const CELEBRATION_DISPLAY_MS = 2600;
const PENGUIN_SOURCE = require("../assets/images/penguin-master-transparent-1024.png");
const CONFETTI_COLORS = ["#FF9F1C", "#FFD166", "#FDE68A", "#FFFFFF", "#FFE6C7", "#FB923C"];
const CONFETTI_COUNT = 46;

function ConfettiParticle({ p, progress }: { p: ConfettiParticleSpec; progress: SharedValue<number> }) {
  const rStyle = useAnimatedStyle(() => {
    const raw = (progress.value - p.delay) / (1 - p.delay);
    const t = Math.max(0, Math.min(1, raw));
    return {
      opacity: t <= 0 ? 0 : 1 - t * t,
      transform: [
        { translateX: p.dx * t },
        { translateY: p.dy * t + 260 * t * t },
        { rotate: `${p.rotate * t}deg` },
        { scale: 0.6 + 0.4 * (1 - t) },
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
  const reducedMotion = useReducedMotion();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [visible, setVisible] = useState(false);

  const bounce = useSharedValue(0);
  const sway = useSharedValue(0);
  const step = useSharedValue(0);
  const danceScale = useSharedValue(1);
  const entrance = useSharedValue(0);
  const confettiProgress = useSharedValue(0);

  // Fill nearly the whole width and most of the height reserved for the
  // penguin (the text card below gets its own fixed space, see the flex
  // layout in the render below).
  const penguinSize = Math.min(screenW * 0.98, screenH * 0.66, 900);

  const particles = useMemo(() => {
    return Array.from({ length: CONFETTI_COUNT }, (_, idx) => {
      // Thrown outward from the penguin, spreading across the full screen —
      // some short bursts near the penguin, some flung all the way to the edges.
      const angle = (idx / CONFETTI_COUNT) * Math.PI * 2 + (idx % 3) * 0.35;
      const radius = screenW * (0.22 + (idx % 9) * 0.09);
      const dx = Math.cos(angle) * radius;
      const dyBase = Math.sin(angle) * radius * 0.55 - screenH * 0.1;
      const size = 6 + (idx % 5) * 3;
      const rotate = (idx * 53) % 360;
      const delay = (idx % 10) * 0.04;
      return { dx, dy: dyBase, size, rotate, color: CONFETTI_COLORS[idx % CONFETTI_COLORS.length], delay };
    });
  }, [screenW, screenH]);

  const stageStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
  }));

  const penguinStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: step.value },
      { translateY: bounce.value },
      { rotate: `${sway.value}deg` },
      { scale: danceScale.value * (0.7 + 0.3 * entrance.value) },
    ],
  }));

  useEffect(() => {
    if (!nonce) return;

    setVisible(true);
    entrance.value = 0;
    confettiProgress.value = 0;
    bounce.value = 0;
    sway.value = 0;
    step.value = 0;
    danceScale.value = 1;

    entrance.value = withSequence(
      withTiming(1, { duration: 260, easing: Easing.out(Easing.back(1.6)) }),
      withTiming(1, { duration: CELEBRATION_DISPLAY_MS - 260 - 260 }),
      withTiming(0, { duration: 260, easing: Easing.in(Easing.cubic) }),
    );
    confettiProgress.value = withTiming(1, { duration: CELEBRATION_DISPLAY_MS - 300, easing: Easing.out(Easing.quad) });

    if (!reducedMotion) {
      const cycles = Math.max(1, Math.round(CELEBRATION_DISPLAY_MS / 740));
      bounce.value = withRepeat(
        withSequence(
          withTiming(-30, { duration: 200, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 210, easing: Easing.in(Easing.quad) }),
          withTiming(-18, { duration: 180, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 190, easing: Easing.in(Easing.quad) }),
        ),
        cycles,
        false,
      );
      sway.value = withRepeat(
        withSequence(
          withTiming(-14, { duration: 200, easing: Easing.inOut(Easing.sin) }),
          withTiming(14, { duration: 230, easing: Easing.inOut(Easing.sin) }),
          withTiming(-9, { duration: 190, easing: Easing.inOut(Easing.sin) }),
          withTiming(9, { duration: 200, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 170, easing: Easing.inOut(Easing.sin) }),
        ),
        cycles,
        false,
      );
      step.value = withRepeat(
        withSequence(
          withTiming(-16, { duration: 210, easing: Easing.inOut(Easing.sin) }),
          withTiming(16, { duration: 240, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 180, easing: Easing.inOut(Easing.sin) }),
        ),
        cycles,
        false,
      );
      danceScale.value = withRepeat(
        withSequence(
          withTiming(1.12, { duration: 200, easing: Easing.out(Easing.quad) }),
          withTiming(0.94, { duration: 210, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 180, easing: Easing.inOut(Easing.quad) }),
        ),
        cycles,
        false,
      );
    }

    const hideTimer = setTimeout(() => {
      cancelAnimation(bounce);
      cancelAnimation(sway);
      cancelAnimation(step);
      cancelAnimation(danceScale);
      setVisible(false);
    }, CELEBRATION_DISPLAY_MS);

    return () => {
      clearTimeout(hideTimer);
      cancelAnimation(bounce);
      cancelAnimation(sway);
      cancelAnimation(step);
      cancelAnimation(danceScale);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, reducedMotion]);

  const heading = variant === "redeemed" ? t("dealStatus.redeemed") : t("dealStatus.claimed");
  const sub =
    subtitle ??
    (variant === "redeemed"
      ? t("consumerWallet.redeemedConfirmSub")
      : t("dealsBrowse.claimedInWallet", { defaultValue: "Saved to your wallet. Open it at the counter." }));

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={() => setVisible(false)}>
      <Pressable
        onPress={() => setVisible(false)}
        style={{ flex: 1, backgroundColor: "rgba(10,10,14,0.55)" }}
        accessibilityRole="button"
        accessibilityLabel={heading}
      >
        <Animated.View style={[{ flex: 1 }, stageStyle]}>
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {particles.map((p, idx) => (
              <ConfettiParticle key={idx} p={p} progress={confettiProgress} />
            ))}
          </View>

          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Animated.View style={penguinStyle}>
              <Image
                source={PENGUIN_SOURCE}
                style={{ width: penguinSize, height: penguinSize }}
                contentFit="contain"
                accessibilityIgnoresInvertColors
              />
            </Animated.View>
          </View>

          <View style={{ alignItems: "center", paddingBottom: 36 }}>
            <View
              style={{
                maxWidth: screenW * 0.82,
                borderRadius: 20,
                backgroundColor: "#11181C",
                borderWidth: 1,
                borderColor: "rgba(255,159,28,0.4)",
                paddingVertical: 14,
                paddingHorizontal: 24,
                alignItems: "center",
              }}
              accessibilityLiveRegion="polite"
            >
              <Text
                style={{ color: "#fff", fontWeight: "900", fontSize: 24, textAlign: "center" }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                maxFontSizeMultiplier={1.15}
              >
                {heading}
              </Text>
              <Text
                style={{ color: "rgba(255,255,255,0.8)", marginTop: 4, fontSize: 14, fontWeight: "700", textAlign: "center" }}
                numberOfLines={2}
                maxFontSizeMultiplier={1.15}
              >
                {sub}
              </Text>
            </View>
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
