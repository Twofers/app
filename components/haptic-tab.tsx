import { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import { PlatformPressable } from "@react-navigation/elements";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { springPressIn, springPressOut, triggerLightHaptic } from "@/lib/press-feedback";

const AnimatedPlatformPressable = Animated.createAnimatedComponent(PlatformPressable);

export function HapticTab(props: BottomTabBarButtonProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPlatformPressable
      {...props}
      style={[props.style, animatedStyle]}
      onPressIn={(ev) => {
        triggerLightHaptic();
        scale.value = springPressIn();
        props.onPressIn?.(ev);
      }}
      onPressOut={(ev) => {
        scale.value = springPressOut();
        props.onPressOut?.(ev);
      }}
    />
  );
}
