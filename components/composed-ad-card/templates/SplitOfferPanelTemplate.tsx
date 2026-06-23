import { Pressable, StyleSheet, Text, View } from "react-native";

import { AdBrandRow } from "../AdBrandRow";
import { AdCallToAction } from "../AdCallToAction";
import { AdHeadline } from "../AdHeadline";
import { AdImageLayer } from "../AdImageLayer";
import { AdStatusBadges } from "../AdStatusBadges";
import { AdSupportingCopy } from "../AdSupportingCopy";
import { LockedOfferLine } from "../LockedOfferLine";
import type { ComposedAdTemplateProps } from "../types";

export function SplitOfferPanelTemplate(props: ComposedAdTemplateProps) {
  const { copy, fallbackVisualLabel, imageUri, liveState, merchant, offerFacts, onCardPress, onPrimaryAction, presentation, secondaryAction, surface, tokens } = props;
  const showTerms = surface !== "consumer_feed" && Boolean(offerFacts.termsLine);

  return (
    <Pressable
      onPress={onCardPress}
      disabled={!onCardPress}
      accessibilityRole={onCardPress ? "button" : undefined}
      accessibilityLabel={props.accessibilityLabel}
      style={[styles.card, { backgroundColor: tokens.cardBackground, borderColor: tokens.border }]}
    >
      <View style={styles.image}>
        <AdImageLayer
          imageUri={imageUri}
          merchantName={merchant.name}
          headline={copy.headline}
          offerLine={offerFacts.primaryOfferLine}
          presentation={presentation}
          tokens={tokens}
          fallbackVisualLabel={fallbackVisualLabel}
        />
      </View>
      <View style={[styles.panel, { backgroundColor: tokens.panelBackground }]}>
        <AdStatusBadges
          liveState={liveState}
          tokens={tokens}
          showLiveStatus={presentation.showLiveStatus}
          showQuantityRemaining={presentation.showQuantityRemaining}
          showTimeRemaining={presentation.showTimeRemaining}
        />
        <AdBrandRow merchant={merchant} tokens={tokens} />
        <AdHeadline tokens={tokens} compact={surface === "consumer_feed"}>{copy.headline}</AdHeadline>
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
  image: {
    height: 220,
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
