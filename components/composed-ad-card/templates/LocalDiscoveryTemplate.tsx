import { Pressable, StyleSheet, Text, View } from "react-native";

import { AdBrandRow } from "../AdBrandRow";
import { AdCallToAction } from "../AdCallToAction";
import { AdHeadline } from "../AdHeadline";
import { AdImageLayer } from "../AdImageLayer";
import { AdStatusBadges } from "../AdStatusBadges";
import { AdSupportingCopy } from "../AdSupportingCopy";
import { LockedOfferLine } from "../LockedOfferLine";
import type { ComposedAdTemplateProps } from "../types";

export function LocalDiscoveryTemplate(props: ComposedAdTemplateProps) {
  const { copy, fallbackVisualLabel, imageUri, liveState, merchant, offerFacts, onCardPress, onPrimaryAction, presentation, secondaryAction, tokens } = props;
  const locationLine = merchant.locationName || merchant.addressLine || null;

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
        <View style={styles.topRow}>
          <AdBrandRow merchant={merchant} tokens={tokens} compact />
          <AdStatusBadges
            liveState={liveState}
            tokens={tokens}
            showLiveStatus={presentation.showLiveStatus}
            showQuantityRemaining={presentation.showQuantityRemaining}
            showTimeRemaining={false}
          />
        </View>
        {locationLine ? (
          <Text numberOfLines={1} maxFontSizeMultiplier={1.15} style={[styles.location, { color: tokens.panelMutedText }]}>
            {locationLine}
          </Text>
        ) : null}
        <AdHeadline tokens={tokens} compact>{copy.headline}</AdHeadline>
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
    gap: 8,
  },
  topRow: {
    gap: 8,
  },
  location: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
});
