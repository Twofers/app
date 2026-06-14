import { Pressable, Text, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { Colors, Controls, Fonts, Radii } from "@/constants/theme";
import { springPressIn, springPressOut, triggerLightHaptic } from "@/lib/press-feedback";
import { useColorScheme } from "@/hooks/use-color-scheme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type SecondaryButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

export function SecondaryButton({
  title,
  onPress,
  disabled,
  style,
  accessibilityLabel,
  accessibilityHint,
}: SecondaryButtonProps) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const scale = useSharedValue(1);
  const rStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

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
        scale.value = springPressIn();
      }}
      onPressOut={() => {
        scale.value = springPressOut();
      }}
      style={[
        {
          width: "100%",
          alignSelf: "stretch",
          minHeight: Controls.buttonHeight,
          paddingVertical: 12,
          paddingHorizontal: 20,
          borderRadius: Radii.md,
          backgroundColor: theme.surface,
          borderWidth: 1.5,
          borderColor: theme.border,
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
          color: theme.text,
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
