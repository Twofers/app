import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { withSpring } from "react-native-reanimated";

export const PRESS_SCALE = 0.97;

export const PRESS_SPRING_IN = {
  damping: 22,
  stiffness: 420,
  mass: 0.45,
};

export const PRESS_SPRING_OUT = {
  damping: 20,
  stiffness: 360,
  mass: 0.4,
};

export function triggerLightHaptic() {
  if (Platform.OS === "web") return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
    // Ignore haptic failures to keep interactions smooth.
  });
}

export function springPressIn() {
  return withSpring(PRESS_SCALE, PRESS_SPRING_IN);
}

export function springPressOut() {
  return withSpring(1, PRESS_SPRING_OUT);
}
