import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import { Circle } from "react-native-maps";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const PULSE_MS = 1400;

/**
 * Shared pulse for all live-deal halos (one animation loop, many circles — better than per-marker Reanimated).
 */
export function useLiveDealPulse() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: PULSE_MS, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return pulse;
}

type LatLng = { latitude: number; longitude: number };

/**
 * Pulsing blue rings under a live deal pin (native MapView circles, not inside Marker — keeps tracksViewChanges off).
 */
export function LiveDealHaloCircles({ center, pulse }: { center: LatLng; pulse: Animated.Value }) {
  const radiusOuter = pulse.interpolate({ inputRange: [0, 1], outputRange: [54, 92] });
  const radiusInner = pulse.interpolate({ inputRange: [0, 1], outputRange: [32, 56] });

  return (
    <>
      <AnimatedCircle
        center={center}
        radius={radiusOuter}
        strokeColor="rgba(37, 99, 235, 0.5)"
        fillColor="rgba(59, 130, 246, 0.16)"
        strokeWidth={2}
        zIndex={1}
      />
      <AnimatedCircle
        center={center}
        radius={radiusInner}
        strokeColor="rgba(96, 165, 250, 0.42)"
        fillColor="rgba(147, 197, 253, 0.12)"
        strokeWidth={1}
        zIndex={2}
      />
    </>
  );
}
