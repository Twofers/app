import { Pressable, StyleSheet, Text, View } from "react-native";

import { AdPosterCanvas } from "@/components/poster/AdPosterCanvas";
import { AdCallToAction } from "../AdCallToAction";
import { AdStatusBadges } from "../AdStatusBadges";
import type { ComposedAdTemplateProps } from "../types";

export function PosterOfferTemplate(props: ComposedAdTemplateProps) {
  const { copy, imageUri, liveState, merchant, offerFacts, onCardPress, onPrimaryAction, posterSpec, presentation, secondaryAction, surface, tokens } = props;
  const scheduleLine = offerFacts.scheduleSummary || liveState.timeRemainingLabel || liveState.statusLabel;
  const showMerchantLine = surface !== "consumer_feed";

  return (
    <Pressable
      onPress={onCardPress}
      disabled={!onCardPress}
      accessibilityRole={onCardPress ? "button" : undefined}
      accessibilityLabel={props.accessibilityLabel}
      style={[styles.card, { backgroundColor: tokens.cardBackground, borderColor: tokens.border }]}
    >
      <AdPosterCanvas spec={posterSpec} imageUri={imageUri} style={styles.poster} />
      <View style={[styles.panel, { backgroundColor: tokens.panelBackground }]}>
        <AdStatusBadges
          liveState={liveState}
          tokens={tokens}
          showLiveStatus={presentation.showLiveStatus}
          showQuantityRemaining={presentation.showQuantityRemaining}
          showTimeRemaining={presentation.showTimeRemaining}
        />
        <View style={styles.liveRow}>
          <View style={styles.liveCopy}>
            {showMerchantLine ? (
              <Text numberOfLines={1} maxFontSizeMultiplier={1.15} style={[styles.merchant, { color: tokens.panelMutedText }]}>
                {merchant.name}
              </Text>
            ) : null}
            <Text numberOfLines={2} maxFontSizeMultiplier={1.15} style={[styles.schedule, { color: tokens.panelText }]}>
              {scheduleLine}
            </Text>
          </View>
          <View style={styles.action}>
            <AdCallToAction
              label={copy.ctaLabel}
              tokens={tokens}
              disabled={!liveState.claimAvailable}
              onPress={onPrimaryAction}
              secondaryAction={secondaryAction}
            />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  poster: {
    borderRadius: 0,
  },
  panel: {
    padding: 14,
    gap: 9,
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  liveCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  merchant: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  schedule: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
    letterSpacing: 0,
  },
  action: {
    width: 154,
    maxWidth: "44%",
  },
});
