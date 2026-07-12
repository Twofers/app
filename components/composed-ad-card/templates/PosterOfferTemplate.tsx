import { Pressable, StyleSheet, Text, View } from "react-native";

import { AdPosterCanvas } from "@/components/poster/AdPosterCanvas";
import { AdCallToAction } from "../AdCallToAction";
import { AdFavoriteButton } from "../AdFavoriteButton";
import { AdStatusBadges } from "../AdStatusBadges";
import type { ComposedAdTemplateProps } from "../types";

export function PosterOfferTemplate(props: ComposedAdTemplateProps) {
  const { contentLocale, copy, favoriteAction, imageUri, liveState, merchant, offerFacts, onCardPress, onPrimaryAction, posterSpec, presentation, secondaryAction, surface, tokens } = props;
  // Only a real recurring schedule ("Weekdays 2–5 PM") belongs here; never fall back
  // to the countdown, which the urgency line already carries.
  const scheduleLine = offerFacts.scheduleSummary?.trim() || null;
  const showMerchantLine = surface !== "consumer_feed";

  return (
    <Pressable
      onPress={onCardPress}
      disabled={!onCardPress}
      accessibilityRole={onCardPress ? "button" : undefined}
      accessibilityLabel={props.accessibilityLabel}
      style={[styles.card, { backgroundColor: tokens.cardBackground, borderColor: tokens.border }]}
    >
      <View style={styles.posterWrap}>
        <AdPosterCanvas spec={posterSpec} imageUri={imageUri} contentLocale={contentLocale} style={styles.poster} />
        {favoriteAction ? <AdFavoriteButton action={favoriteAction} /> : null}
      </View>
      <View style={[styles.panel, { backgroundColor: tokens.panelBackground }]}>
        <AdStatusBadges
          liveState={liveState}
          tokens={tokens}
          showLiveStatus={presentation.showLiveStatus}
          showQuantityRemaining={presentation.showQuantityRemaining}
          showTimeRemaining={presentation.showTimeRemaining}
        />
        {showMerchantLine ? (
          <Text numberOfLines={1} maxFontSizeMultiplier={1.15} style={[styles.merchant, { color: tokens.panelMutedText }]}>
            {merchant.name}
          </Text>
        ) : null}
        {scheduleLine ? (
          <Text numberOfLines={2} maxFontSizeMultiplier={1.15} style={[styles.schedule, { color: tokens.panelText }]}>
            {scheduleLine}
          </Text>
        ) : null}
        <AdCallToAction
          label={copy.ctaLabel}
          tokens={tokens}
          disabled={!liveState.claimAvailable}
          onPress={onPrimaryAction}
          secondaryAction={secondaryAction}
        />
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
  posterWrap: {
    position: "relative",
  },
  poster: {
    borderRadius: 0,
  },
  panel: {
    padding: 14,
    gap: 9,
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
});
