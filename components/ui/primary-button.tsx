import { Pressable, Text, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { Fonts, Radii } from "@/constants/theme";
import { springPressOut, triggerLightHaptic } from "@/lib/press-feedback";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PrimaryButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
};

export function PrimaryButton({ title, onPress, disabled, style }: PrimaryButtonProps) {
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
          height: 58,
          minHeight: 58,
          paddingHorizontal: 22,
          borderRadius: Radii.lg,
          backgroundColor: "#F58A07",
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
