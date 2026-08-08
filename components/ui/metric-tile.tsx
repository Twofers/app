import { Text } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { CardShell } from "@/components/ui/card-shell";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Spacing } from "@/lib/screen-layout";

export type MetricTileProps = {
  label: string;
  value: string;
  sublabel?: string;
  delay: number;
  fullWidth?: boolean;
};

export function MetricTile({ label, value, sublabel, delay, fullWidth }: MetricTileProps) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  return (
    <Animated.View
      entering={FadeInDown.duration(420).delay(delay).springify()}
      style={[{ flexBasis: fullWidth ? "100%" : "47%", flexGrow: 1 }]}
    >
      <CardShell style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 12,
            fontWeight: "700",
            color: theme.text,
            opacity: 0.48,
            letterSpacing: 0.2,
          }}
          numberOfLines={2}
        >
          {label}
        </Text>
        <Text
          style={{
            fontSize: 26,
            fontWeight: "800",
            marginTop: Spacing.sm,
            color: theme.text,
            letterSpacing: -0.6,
          }}
        >
          {value}
        </Text>
        {sublabel ? (
          <Text style={{ marginTop: 6, fontSize: 12, opacity: 0.5, fontWeight: "600", color: theme.text }}>
            {sublabel}
          </Text>
        ) : null}
      </CardShell>
    </Animated.View>
  );
}
