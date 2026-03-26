import { useRef } from "react";
import { Animated, LayoutChangeEvent, PanResponder, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Spacing } from "@/lib/screen-layout";

type SlideToUseDealProps = {
  onConfirmed: () => void;
  disabled?: boolean;
};

const KNOB = 52;
const THRESHOLD_RATIO = 0.72;

export function SlideToUseDeal({ onConfirmed, disabled }: SlideToUseDealProps) {
  const { t } = useTranslation();
  const trackW = useRef(0);
  const pan = useRef(new Animated.Value(0)).current;
  const fired = useRef(false);

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
      <Text style={{ fontSize: 13, opacity: 0.65, textAlign: "center" }}>{t("consumerWallet.slideHint")}</Text>
      <View
        onLayout={onLayout}
        style={{
          height: KNOB + 12,
          borderRadius: 999,
          backgroundColor: "#e5e5e5",
          justifyContent: "center",
          paddingHorizontal: 6,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text
          style={{
            position: "absolute",
            alignSelf: "center",
            pointerEvents: "none",
            fontWeight: "800",
            fontSize: 14,
            color: "#888",
            letterSpacing: 0.3,
          }}
        >
          {t("consumerWallet.slideLabel")}
        </Text>
        <Animated.View
          {...panResponder.panHandlers}
          style={{
            width: KNOB,
            height: KNOB,
            borderRadius: KNOB / 2,
            backgroundColor: "#111",
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
