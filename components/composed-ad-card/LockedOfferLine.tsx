import { StyleSheet, Text } from "react-native";

import type { AdThemeTokens } from "@/lib/ad-theme-tokens";

type LockedOfferLineProps = {
  children: string;
  tokens: AdThemeTokens;
  compact?: boolean;
};

export function LockedOfferLine({ children, tokens, compact }: LockedOfferLineProps) {
  // ComposedAdCard blanks the locked line when it merely repeats the headline, so
  // an empty value here means "already said above" — render nothing rather than an
  // empty bold row that still consumes the panel's gap spacing.
  if (!children?.trim()) return null;
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
