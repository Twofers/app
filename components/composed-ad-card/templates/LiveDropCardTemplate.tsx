import { Pressable, StyleSheet, View } from "react-native";

import { AdBrandRow } from "../AdBrandRow";
import { AdCallToAction } from "../AdCallToAction";
import { AdHeadline } from "../AdHeadline";
import { AdImageLayer } from "../AdImageLayer";
import { AdStatusBadges } from "../AdStatusBadges";
import { AdSupportingCopy } from "../AdSupportingCopy";
import { LockedOfferLine } from "../LockedOfferLine";
import type { ComposedAdTemplateProps } from "../types";

export function LiveDropCardTemplate(props: ComposedAdTemplateProps) {
  const { copy, fallbackVisualLabel, imageUri, liveState, merchant, offerFacts, onCardPress, onPrimaryAction, presentation, secondaryAction, tokens } = props;

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
        <View style={styles.badgeBand}>
          <AdStatusBadges
            liveState={liveState}
            tokens={tokens}
            showLiveStatus={presentation.showLiveStatus}
            showQuantityRemaining={presentation.showQuantityRemaining}
            showTimeRemaining={presentation.showTimeRemaining}
          />
        </View>
        <AdBrandRow merchant={merchant} tokens={tokens} compact />
        <AdHeadline tokens={tokens}>{copy.headline}</AdHeadline>
        <LockedOfferLine tokens={tokens}>{offerFacts.primaryOfferLine}</LockedOfferLine>
        {presentation.showSupportingCopy ? <AdSupportingCopy tokens={tokens}>{copy.supportingCopy}</AdSupportingCopy> : null}
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
    aspectRatio: 1,
  },
  panel: {
    padding: 14,
    gap: 9,
  },
  badgeBand: {
    marginBottom: 1,
  },
});
