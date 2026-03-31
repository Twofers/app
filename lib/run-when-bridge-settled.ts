import { InteractionManager } from "react-native";

/**
 * Defers work until after the first frame and the native idle queue, so cold-start
 * `Linking.getInitialURL()` navigation is less likely to race with React context /
 * dev launcher intent churn on Android.
 */
export function runWhenBridgeSettled(fn: () => void): void {
  requestAnimationFrame(() => {
    void InteractionManager.runAfterInteractions(() => {
      fn();
    });
  });
}
