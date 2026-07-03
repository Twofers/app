import { useEffect } from "react";
import { Text, View } from "react-native";
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

type ProfileCompletenessBarProps = {
  percentage: number;
  hint: string | null;
};

export function ProfileCompletenessBar({ percentage, hint }: ProfileCompletenessBarProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(percentage, { duration: 600 });
  }, [percentage, progress]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%` as unknown as number,
  }));

  const isComplete = percentage >= 100;
  const label = isComplete
    ? t("profileCompleteness.complete", { defaultValue: "100% complete" })
    : t("profileCompleteness.incomplete", { percentage, defaultValue: "{{percentage}}% complete" });

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontWeight: "700", fontSize: 14, color: theme.text }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
        {label}
      </Text>
      <View
        style={{
          height: 8,
          borderRadius: 4,
          backgroundColor: theme.border,
          overflow: "hidden",
        }}
      >
        <Reanimated.View
          style={[
            {
              height: 8,
              borderRadius: 4,
              backgroundColor: theme.primary,
            },
            barStyle,
          ]}
        />
      </View>
      {hint && !isComplete ? (
        <Text style={{ fontSize: 13, color: theme.mutedText, lineHeight: 18 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
