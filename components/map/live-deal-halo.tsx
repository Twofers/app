import { Circle } from "react-native-maps";

type LatLng = { latitude: number; longitude: number };

/**
 * No-op: animation removed to fix Android Map ANR (JS-driven Animated.loop
 * with useNativeDriver:false queued map updates every frame).
 * Hook kept for API compatibility with map-native-screen.tsx.
 */
export function useLiveDealPulse() {
  return null;
}

/**
 * Static blue rings under a live deal pin.
 * Previously pulsed via AnimatedCircle + useNativeDriver:false; that caused
 * an ANR on Android. Static circles preserve live-deal visual emphasis.
 */
export function LiveDealHaloCircles({ center }: Readonly<{ center: LatLng; pulse: unknown }>) {
  return (
    <>
      <Circle
        center={center}
        radius={96}
        strokeColor="rgba(37, 99, 235, 0.78)"
        fillColor="rgba(59, 130, 246, 0.26)"
        strokeWidth={3}
        zIndex={1}
      />
      <Circle
        center={center}
        radius={62}
        strokeColor="rgba(147, 197, 253, 0.75)"
        fillColor="rgba(191, 219, 254, 0.24)"
        strokeWidth={2}
        zIndex={2}
      />
    </>
  );
}
