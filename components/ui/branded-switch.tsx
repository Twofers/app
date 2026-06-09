import { Platform, Switch, type SwitchProps } from "react-native";

import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

export function BrandedSwitch({
  ios_backgroundColor,
  thumbColor,
  trackColor,
  ...props
}: SwitchProps) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  return (
    <Switch
      ios_backgroundColor={ios_backgroundColor ?? theme.border}
      thumbColor={thumbColor ?? (Platform.OS === "android" ? theme.primaryText : undefined)}
      trackColor={trackColor ?? { false: theme.border, true: theme.primary }}
      {...props}
    />
  );
}
