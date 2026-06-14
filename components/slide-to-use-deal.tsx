import { useEffect, useRef } from "react";
import { Animated, LayoutChangeEvent, PanResponder, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Colors } from "@/constants/theme";
import { Spacing } from "@/lib/screen-layout";
import { useColorScheme } from "@/hooks/use-color-scheme";

type SlideToUseDealProps = {
  onConfirmed: () => void;
  disabled?: boolean;
  /** Reset key — when this changes the slider resets to the start position. */
  resetKey?: string | number;
};

const KNOB = 52;
const THRESHOLD_RATIO = 0.72;

export function SlideToUseDeal({ onConfirmed, disabled, resetKey }: SlideToUseDealProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const trackW = useRef(0);
  const pan = useRef(new Animated.Value(0)).current;
  const fired = useRef(false);

  // Reset slider when the parent signals a new deal / new context.
  useEffect(() => {
    fired.current = false;
    pan.setValue(0);
  }, [resetKey, pan]);

  const onLayout = (e: LayoutChangeEvent) => {
    trackW.current = e.nativeEvent.layout.width;
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled && !fired.current,
      onMoveShouldSetPanResponder: (_, g) => !disabled && !fired.current && Math.abs(g.dx) > 4,
      onPanResponderMove: (_, g) => {
        const max = Math.max(0, trackW.current - KNOB - 8);
        const x = Math.min(Math.max(0, g.dx), max);
        pan.setValue(x);
      },
      onPanResponderRelease: (_, g) => {
        if (disabled || fired.current) return;
        const max = Math.max(0, trackW.current - KNOB - 8);
        const need = max * THRESHOLD_RATIO;
        if (g.dx >= need) {
          fired.current = true;
          Animated.spring(pan, { toValue: max, friction: 8, useNativeDriver: false }).start(() => {
            onConfirmed();
          });
        } else {
          Animated.spring(pan, { toValue: 0, friction: 8, useNativeDriver: false }).start();
        }
      },
    }),
  ).current;

  return (
    <View style={{ gap: Spacing.sm }}>
      <Text style={{ fontSize: 13, opacity: 0.65, textAlign: "center", color: theme.text }} maxFontSizeMultiplier={1.15}>
        {t("consumerWallet.slideHint")}
      </Text>
      <View
        onLayout={onLayout}
        accessibilityRole="adjustable"
        accessibilityLabel={t("consumerWallet.slideLabel")}
        style={{
          height: KNOB + 12,
          borderRadius: 999,
          backgroundColor: theme.surfaceMuted,
          justifyContent: "center",
          paddingHorizontal: 6,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text
          style={{
            position: "absolute",
            left: KNOB + 8,
            right: KNOB + 8,
            textAlign: "center",
            pointerEvents: "none",
            fontWeight: "800",
            fontSize: 14,
            color: theme.mutedText,
            letterSpacing: 0.3,
          }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          maxFontSizeMultiplier={1.1}
        >
          {t("consumerWallet.slideLabel")}
        </Text>
        <Animated.View
          {...panResponder.panHandlers}
          style={{
            width: KNOB,
            height: KNOB,
            borderRadius: KNOB / 2,
            backgroundColor: theme.primary,
            transform: [{ translateX: pan }],
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 20 }}>→</Text>
        </Animated.View>
      </View>
    </View>
  );
}
