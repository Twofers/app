import { StyleSheet, Text } from "react-native";

import type { AdThemeTokens } from "@/lib/ad-theme-tokens";

type LockedOfferLineProps = {
  children: string;
  tokens: AdThemeTokens;
  compact?: boolean;
};

export function LockedOfferLine({ children, tokens, compact }: LockedOfferLineProps) {
  return (
    <Text
      numberOfLines={2}
      adjustsFontSizeToFit
      minimumFontScale={0.84}
      maxFontSizeMultiplier={1.15}
      style={[styles.offer, compact ? styles.compact : null, { color: tokens.panelText }]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  offer: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    letterSpacing: 0,
  },
  compact: {
    fontSize: 15,
    lineHeight: 20,
  },
});
