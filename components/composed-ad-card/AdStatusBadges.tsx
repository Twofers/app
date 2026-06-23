import { StyleSheet, Text, View } from "react-native";

import type { AdThemeTokens } from "@/lib/ad-theme-tokens";
import type { DealLiveState } from "@/lib/ad-render-content";

type AdStatusBadgesProps = {
  liveState: DealLiveState;
  tokens: AdThemeTokens;
  showLiveStatus: boolean;
  showQuantityRemaining: boolean;
  showTimeRemaining: boolean;
};

function Badge({ label, tokens, accent }: { label: string; tokens: AdThemeTokens; accent?: boolean }) {
  return (
    <View style={[styles.badge, { backgroundColor: accent ? tokens.ctaBackground : tokens.badgeBackground }]}>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.78}
        maxFontSizeMultiplier={1.15}
        style={[styles.badgeText, { color: accent ? tokens.ctaText : tokens.badgeText }]}
      >
        {label}
      </Text>
    </View>
  );
}

export function AdStatusBadges({
  liveState,
  tokens,
  showLiveStatus,
  showQuantityRemaining,
  showTimeRemaining,
}: AdStatusBadgesProps) {
  const labels = [
    showLiveStatus ? { label: liveState.statusLabel, accent: liveState.status === "live" } : null,
    showQuantityRemaining && liveState.quantityRemainingLabel
      ? { label: liveState.quantityRemainingLabel, accent: false }
      : null,
    showTimeRemaining && liveState.timeRemainingLabel ? { label: liveState.timeRemainingLabel, accent: false } : null,
  ].filter((item): item is { label: string; accent: boolean } => Boolean(item?.label));

  if (labels.length === 0) return null;

  return (
    <View style={styles.root}>
      {labels.map((item) => (
        <Badge key={item.label} label={item.label} tokens={tokens} accent={item.accent} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    maxWidth: "100%",
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
});
