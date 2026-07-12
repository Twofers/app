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

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/**
 * A single, readable urgency line for the deal card — replaces the old row of tiny
 * uppercase chips. Live deals get an accent dot plus status · time left · quantity;
 * calmer states (claimed / expired) render the same line without the dot.
 */
export function AdStatusBadges({
  liveState,
  tokens,
  showLiveStatus,
  showQuantityRemaining,
  showTimeRemaining,
}: AdStatusBadgesProps) {
  const isLive = liveState.status === "live";
  const statusLabel = clean(liveState.statusLabel);
  const timeLabel = clean(liveState.timeRemainingLabel);
  const quantityLabel = clean(liveState.quantityRemainingLabel);

  const parts: { key: string; label: string; strong: boolean }[] = [];
  if (showLiveStatus && statusLabel) {
    parts.push({ key: "status", label: statusLabel, strong: isLive });
  }
  if (showTimeRemaining && timeLabel && timeLabel !== statusLabel) {
    parts.push({ key: "time", label: timeLabel, strong: true });
  }
  if (showQuantityRemaining && quantityLabel) {
    parts.push({ key: "quantity", label: quantityLabel, strong: true });
  }

  if (parts.length === 0) return null;

  return (
    <View style={styles.root}>
      {isLive ? <View style={[styles.dot, { backgroundColor: tokens.ctaBackground }]} /> : null}
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        maxFontSizeMultiplier={1.15}
        style={[styles.line, { color: tokens.panelText }]}
      >
        {parts.map((part, index) => (
          <Text
            key={part.key}
            style={{
              color: part.strong ? tokens.panelText : tokens.panelMutedText,
              fontWeight: part.strong ? "800" : "700",
            }}
          >
            {index > 0 ? <Text style={{ color: tokens.panelMutedText, fontWeight: "600" }}>{"   ·   "}</Text> : null}
            {part.label}
          </Text>
        ))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  line: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    letterSpacing: 0,
  },
});
