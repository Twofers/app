import { useEffect } from "react";
import { Modal, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { SecondaryButton } from "@/components/ui/secondary-button";
import { Spacing } from "@/lib/screen-layout";

const PENGUIN_SOURCE = require("../assets/images/penguin-auth-512.png");

type ProgressTheme = {
  border: string;
  mutedText: string;
  primary: string;
  surface: string;
  surfaceMuted: string;
  text: string;
};

type DancingPenguinProgressCardProps = {
  title: string;
  message: string;
  hint?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  theme: ProgressTheme;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function DancingPenguinProgressCard({
  title,
  message,
  hint,
  cancelLabel,
  onCancel,
  theme,
  style,
  testID,
}: DancingPenguinProgressCardProps) {
  const reducedMotion = useReducedMotion();
  const bounce = useSharedValue(0);
  const sway = useSharedValue(0);
  const step = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(bounce);
      cancelAnimation(sway);
      cancelAnimation(step);
      cancelAnimation(scale);
      bounce.value = 0;
      sway.value = 0;
      step.value = 0;
      scale.value = 1;
      return;
    }

    bounce.value = withRepeat(
      withSequence(
        withTiming(-12, { duration: 180, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 190, easing: Easing.in(Easing.quad) }),
        withTiming(-7, { duration: 160, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 170, easing: Easing.in(Easing.quad) }),
      ),
      -1,
      false,
    );
    sway.value = withRepeat(
      withSequence(
        withTiming(-12, { duration: 180, easing: Easing.inOut(Easing.sin) }),
        withTiming(10, { duration: 210, easing: Easing.inOut(Easing.sin) }),
        withTiming(-8, { duration: 170, easing: Easing.inOut(Easing.sin) }),
        withTiming(8, { duration: 190, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 160, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    step.value = withRepeat(
      withSequence(
        withTiming(-9, { duration: 190, easing: Easing.inOut(Easing.sin) }),
        withTiming(9, { duration: 220, easing: Easing.inOut(Easing.sin) }),
        withTiming(-5, { duration: 180, easing: Easing.inOut(Easing.sin) }),
        withTiming(5, { duration: 190, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 160, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    scale.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 180, easing: Easing.out(Easing.quad) }),
        withTiming(0.98, { duration: 190, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.04, { duration: 160, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 170, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );

    return () => {
      cancelAnimation(bounce);
      cancelAnimation(sway);
      cancelAnimation(step);
      cancelAnimation(scale);
    };
  }, [bounce, reducedMotion, scale, step, sway]);

  const penguinStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: step.value },
      { translateY: bounce.value },
      { rotate: `${sway.value}deg` },
      { scale: scale.value },
    ],
  }));

  const accessibilityLabel = hint ? `${title}. ${message} ${hint}` : `${title}. ${message}`;

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      testID={testID}
      style={[
        {
          marginTop: Spacing.sm,
          padding: 16,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
          gap: 12,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 108,
            height: 108,
            borderRadius: 54,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.surfaceMuted,
            borderWidth: 1,
            borderColor: theme.border,
            overflow: "visible",
          }}
        >
          <Animated.View style={penguinStyle}>
            <Image source={PENGUIN_SOURCE} style={{ width: 94, height: 94 }} contentFit="contain" />
          </Animated.View>
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: theme.text, fontSize: 15, fontWeight: "900", lineHeight: 20 }}>
            {title}
          </Text>
          <Text style={{ marginTop: 4, color: theme.text, opacity: 0.78, fontSize: 13, lineHeight: 18 }}>
            {message}
          </Text>
        </View>
      </View>

      {hint ? (
        <Text style={{ color: theme.mutedText, fontSize: 12, lineHeight: 17 }}>
          {hint}
        </Text>
      ) : null}

      {onCancel && cancelLabel ? (
        <SecondaryButton title={cancelLabel} onPress={onCancel} />
      ) : null}
    </View>
  );
}

export function DancingPenguinProgressOverlay(props: DancingPenguinProgressCardProps & { visible: boolean }) {
  const { visible, style, testID, ...cardProps } = props;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={cardProps.onCancel}
    >
      <View
        testID={testID ? `${testID}-overlay` : undefined}
        style={{
          flex: 1,
          justifyContent: "center",
          paddingHorizontal: 24,
          backgroundColor: "rgba(0, 0, 0, 0.42)",
        }}
      >
        <DancingPenguinProgressCard
          {...cardProps}
          testID={testID}
          style={[
            {
              marginTop: 0,
              shadowColor: "#000",
              shadowOpacity: 0.2,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 10 },
              elevation: 8,
            },
            style,
          ]}
        />
      </View>
    </Modal>
  );
}
