import { Pressable, Text, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { Colors, Fonts, Radii } from "@/constants/theme";
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
    shadowOpacity: 0.2 - pressDepth.value * 0.06,
    shadowRadius: 14 - pressDepth.value * 5,
    elevation: 6 - pressDepth.value * 2,
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
          minHeight: 58,
          paddingVertical: 14,
          paddingHorizontal: 22,
          borderRadius: Radii.lg,
          backgroundColor: theme.primary,
          opacity: disabled ? 0.65 : 1,
          justifyContent: "center",
          alignItems: "center",
          boxShadow: "0px 6px 14px rgba(0,0,0,0.20)",
          elevation: 6,
        },
        style,
        rStyle,
      ]}
    >
      <Text
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={{
          color: "white",
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
