import { useEffect } from "react";
import { Text, View } from "react-native";
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Colors } from "@/constants/theme";
import { Spacing } from "@/lib/screen-layout";

type ProfileCompletenessBarProps = {
  percentage: number;
  hint: string | null;
};

export function ProfileCompletenessBar({ percentage, hint }: ProfileCompletenessBarProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(percentage, { duration: 600 });
  }, [percentage, progress]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%` as unknown as number,
  }));

  const isComplete = percentage >= 100;

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontWeight: "700", fontSize: 14, color: Colors.light.text }}>
        {isComplete ? "100% \u2014 looking great!" : `${percentage}% complete`}
      </Text>
      <View
        style={{
          height: 8,
          borderRadius: 4,
          backgroundColor: Colors.light.border,
          overflow: "hidden",
        }}
      >
        <Reanimated.View
          style={[
            {
              height: 8,
              borderRadius: 4,
              backgroundColor: isComplete ? "#22C55E" : Colors.light.primary,
            },
            barStyle,
          ]}
        />
      </View>
      {hint && !isComplete ? (
        <Text style={{ fontSize: 13, color: Colors.light.mutedText, lineHeight: 18 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
