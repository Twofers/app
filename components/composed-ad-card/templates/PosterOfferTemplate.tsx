import { Pressable, StyleSheet, Text, View } from "react-native";

import { AdPosterCanvas } from "@/components/poster/AdPosterCanvas";
import { AdBrandRow } from "../AdBrandRow";
import { AdCallToAction } from "../AdCallToAction";
import { AdStatusBadges } from "../AdStatusBadges";
import { AdSupportingCopy } from "../AdSupportingCopy";
import { LockedOfferLine } from "../LockedOfferLine";
import type { ComposedAdTemplateProps } from "../types";

export function PosterOfferTemplate(props: ComposedAdTemplateProps) {
  const { copy, imageUri, liveState, merchant, offerFacts, onCardPress, onPrimaryAction, posterSpec, presentation, secondaryAction, surface, tokens } = props;
  const showTerms = surface !== "consumer_feed" && Boolean(offerFacts.termsLine);

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
        <AdBrandRow merchant={merchant} tokens={tokens} />
        <LockedOfferLine tokens={tokens}>{offerFacts.primaryOfferLine}</LockedOfferLine>
        {presentation.showSupportingCopy ? <AdSupportingCopy tokens={tokens}>{copy.supportingCopy}</AdSupportingCopy> : null}
        {showTerms ? (
          <Text numberOfLines={3} maxFontSizeMultiplier={1.15} style={[styles.terms, { color: tokens.panelMutedText }]}>
            {offerFacts.termsLine}
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
  poster: {
    borderRadius: 0,
  },
  panel: {
    padding: 14,
    gap: 9,
  },
  terms: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    letterSpacing: 0,
  },
});
