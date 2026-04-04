import { Pressable, Text, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { Colors, Fonts, Radii } from "@/constants/theme";
import { springPressIn, springPressOut, triggerLightHaptic } from "@/lib/press-feedback";

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
  const scale = useSharedValue(1);
  const rStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
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
          minHeight: 58,
          paddingVertical: 14,
          paddingHorizontal: 22,
          borderRadius: Radii.lg,
          backgroundColor: "#ffffff",
          borderWidth: 1.5,
          borderColor: "rgba(17,24,28,0.18)",
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
        style={{
          color: Colors.light.text,
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
