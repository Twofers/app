import { StyleSheet, Text } from "react-native";

import type { AdThemeTokens } from "@/lib/ad-theme-tokens";

type AdHeadlineProps = {
  children: string;
  tokens: AdThemeTokens;
  compact?: boolean;
};

export function AdHeadline({ children, tokens, compact }: AdHeadlineProps) {
  return (
    <Text
      numberOfLines={2}
      adjustsFontSizeToFit
      minimumFontScale={0.82}
      maxFontSizeMultiplier={1.15}
      style={[styles.headline, compact ? styles.compact : null, { color: tokens.panelText }]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  headline: {
    fontSize: 25,
    lineHeight: 30,
    fontWeight: "900",
    letterSpacing: 0,
  },
  compact: {
    fontSize: 21,
    lineHeight: 26,
  },
});
