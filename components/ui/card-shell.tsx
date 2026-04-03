import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { Colors, Radii, Shadows, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

export type CardShellProps = {
  children: ReactNode;
  variant?: "elevated" | "outlined" | "muted";
  style?: StyleProp<ViewStyle>;
};

/**
 * Consistent card container: 24px corners, padding, border/shadow per variant.
 */
export function CardShell({ children, variant = "elevated", style }: CardShellProps) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  const base: ViewStyle = {
    borderRadius: Radii.card,
    padding: Spacing.lg,
    overflow: "hidden",
  };

  const variantStyle: ViewStyle =
    variant === "elevated"
      ? {
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
          ...Shadows.soft,
        }
      : variant === "muted"
        ? {
            backgroundColor: theme.surfaceMuted,
            borderWidth: 1,
            borderColor: theme.border,
          }
        : {
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
          };

  return <View style={[base, variantStyle, style]}>{children}</View>;
}
