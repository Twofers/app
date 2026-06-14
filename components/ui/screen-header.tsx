import type { ReactNode } from "react";
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { Colors, Spacing, Typography } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

export type ScreenHeaderProps = {
  title: string;
  subtitle?: string | null;
  /** Leading content (usually a back button). */
  leftSlot?: ReactNode;
  /** Trailing content (icon button, single affordance). */
  rightSlot?: ReactNode;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
};

/**
 * Standard screen title row: one primary heading, optional subtitle, optional trailing slot.
 */
export function ScreenHeader({
  title,
  subtitle,
  leftSlot,
  rightSlot,
  style,
  titleStyle,
  subtitleStyle,
}: ScreenHeaderProps) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  return (
    <View style={[{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: Spacing.md }, style]}>
      {leftSlot ? <View style={{ paddingTop: 2, flexShrink: 0 }}>{leftSlot}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[
            Typography.screenTitle,
            { color: theme.text },
            titleStyle,
          ]}
          accessibilityRole="header"
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          maxFontSizeMultiplier={1.15}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[
              {
                marginTop: 6,
                fontSize: 15,
                lineHeight: 22,
                opacity: 0.62,
                color: theme.text,
              },
              subtitleStyle,
            ]}
            numberOfLines={4}
            maxFontSizeMultiplier={1.2}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {rightSlot ? <View style={{ paddingTop: 2, flexShrink: 0 }}>{rightSlot}</View> : null}
    </View>
  );
}
