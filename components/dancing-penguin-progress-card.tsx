import { useEffect } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { SecondaryButton } from "@/components/ui/secondary-button";
import { Spacing } from "@/lib/screen-layout";

const PENGUIN_SOURCE = require("../assets/images/penguin-auth-512.png");

type ProgressTheme = {
  border: string;
  mutedText: string;
  primary: string;
  surface: string;
  surfaceMuted: string;
  text: string;
};

type DancingPenguinProgressCardProps = {
  title: string;
  message: string;
  hint?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  theme: ProgressTheme;
  style?: ViewStyle;
  testID?: string;
};

export function DancingPenguinProgressCard({
  title,
  message,
  hint,
  cancelLabel,
  onCancel,
  theme,
  style,
  testID,
}: DancingPenguinProgressCardProps) {
  const reducedMotion = useReducedMotion();
  const bounce = useSharedValue(0);
  const sway = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(bounce);
      cancelAnimation(sway);
      bounce.value = 0;
      sway.value = 0;
      return;
    }

    bounce.value = withRepeat(
      withSequence(
        withTiming(-7, { duration: 260, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 280, easing: Easing.in(Easing.quad) }),
      ),
      -1,
      false,
    );
    sway.value = withRepeat(
      withSequence(
        withTiming(-5, { duration: 320, easing: Easing.inOut(Easing.sin) }),
        withTiming(5, { duration: 420, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 320, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );

    return () => {
      cancelAnimation(bounce);
      cancelAnimation(sway);
    };
  }, [bounce, reducedMotion, sway]);

  const penguinStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bounce.value }, { rotate: `${sway.value}deg` }],
  }));

  const accessibilityLabel = hint ? `${title}. ${message} ${hint}` : `${title}. ${message}`;

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      testID={testID}
      style={[
        {
          marginTop: Spacing.sm,
          padding: 14,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
          gap: 12,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 76,
            height: 76,
            borderRadius: 38,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.surfaceMuted,
            borderWidth: 1,
            borderColor: theme.border,
            overflow: "hidden",
          }}
        >
          <Animated.View style={penguinStyle}>
            <Image source={PENGUIN_SOURCE} style={{ width: 66, height: 66 }} contentFit="contain" />
          </Animated.View>
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: theme.text, fontSize: 15, fontWeight: "900", lineHeight: 20 }}>
            {title}
          </Text>
          <Text style={{ marginTop: 4, color: theme.text, opacity: 0.78, fontSize: 13, lineHeight: 18 }}>
            {message}
          </Text>
        </View>
      </View>

      {hint ? (
        <Text style={{ color: theme.mutedText, fontSize: 12, lineHeight: 17 }}>
          {hint}
        </Text>
      ) : null}

      {onCancel && cancelLabel ? (
        <SecondaryButton title={cancelLabel} onPress={onCancel} />
      ) : null}
    </View>
  );
}
