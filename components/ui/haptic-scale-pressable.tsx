import { Pressable, type PressableProps } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { springPressIn, springPressOut, triggerLightHaptic } from "@/lib/press-feedback";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type HapticScalePressableProps = PressableProps & {
  disabled?: boolean;
};

export function HapticScalePressable({
  disabled,
  onPressIn,
  onPressOut,
  style,
  ...rest
}: HapticScalePressableProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(ev) => {
        if (!disabled) {
          triggerLightHaptic();
          scale.value = springPressIn();
        }
        onPressIn?.(ev);
      }}
      onPressOut={(ev) => {
        scale.value = springPressOut();
        onPressOut?.(ev);
      }}
      style={
        typeof style === "function"
          ? // Preserve Pressable's "function style" behavior (e.g. `style={({ pressed }) => ... }`)
            // while still layering the animated scale.
            (state) => [style(state), animatedStyle]
          : [style, animatedStyle]
      }
    />
  );
}

