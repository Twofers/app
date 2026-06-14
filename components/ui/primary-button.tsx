import { Pressable, Text, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { Colors, Controls, Fonts, Radii } from "@/constants/theme";
import { springPressOut, triggerLightHaptic } from "@/lib/press-feedback";
import { useColorScheme } from "@/hooks/use-color-scheme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PrimaryButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

export function PrimaryButton({ title, onPress, disabled, style, accessibilityLabel, accessibilityHint }: PrimaryButtonProps) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const scale = useSharedValue(1);
  const pressDepth = useSharedValue(0);
  const rStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: pressDepth.value }],
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      onPressIn={() => {
        if (disabled) return;
        triggerLightHaptic();
        scale.value = withSpring(0.955, { damping: 20, stiffness: 480, mass: 0.42 });
        pressDepth.value = withSpring(1.5, { damping: 18, stiffness: 420, mass: 0.42 });
      }}
      onPressOut={() => {
        scale.value = springPressOut();
        pressDepth.value = withSpring(0, { damping: 18, stiffness: 360, mass: 0.4 });
      }}
      style={[
        {
          width: "100%",
          alignSelf: "stretch",
          minHeight: Controls.buttonHeight,
          paddingVertical: 12,
          paddingHorizontal: 20,
          borderRadius: Radii.md,
          backgroundColor: theme.primary,
          opacity: disabled ? 0.65 : 1,
          justifyContent: "center",
          alignItems: "center",
        },
        style,
        rStyle,
      ]}
    >
      <Text
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        maxFontSizeMultiplier={1.15}
        style={{
          color: theme.primaryText,
          fontSize: 17,
          fontWeight: "800",
          textAlign: "center",
          letterSpacing: -0.2,
          ...(Fonts.sans ? { fontFamily: Fonts.sans } : {}),
        }}
      >
        {title}
      </Text>
    </AnimatedPressable>
  );
}
