import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, View } from "react-native";

import { AdBrandRow } from "../AdBrandRow";
import { AdCallToAction } from "../AdCallToAction";
import { AdHeadline } from "../AdHeadline";
import { AdImageLayer } from "../AdImageLayer";
import { AdStatusBadges } from "../AdStatusBadges";
import { AdSupportingCopy } from "../AdSupportingCopy";
import { LockedOfferLine } from "../LockedOfferLine";
import type { ComposedAdTemplateProps } from "../types";

export function HeroImageOverlayTemplate(props: ComposedAdTemplateProps) {
  const { copy, fallbackVisualLabel, imageUri, liveState, merchant, offerFacts, onCardPress, onPrimaryAction, presentation, secondaryAction, tokens } = props;

  return (
    <Pressable
      onPress={onCardPress}
      disabled={!onCardPress}
      accessibilityRole={onCardPress ? "button" : undefined}
      accessibilityLabel={props.accessibilityLabel}
      style={[styles.card, { backgroundColor: tokens.cardBackground, borderColor: tokens.border }]}
    >
      <View style={styles.hero}>
        <AdImageLayer
          imageUri={imageUri}
          merchantName={merchant.name}
          headline={copy.headline}
          offerLine={offerFacts.primaryOfferLine}
          presentation={presentation}
          tokens={tokens}
          fallbackVisualLabel={fallbackVisualLabel}
        />
        <LinearGradient
          colors={[tokens.imageScrimTop, tokens.imageScrimBottom]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.topBadges}>
          <AdStatusBadges
            liveState={liveState}
            tokens={tokens}
            showLiveStatus={presentation.showLiveStatus}
            showQuantityRemaining={presentation.showQuantityRemaining}
            showTimeRemaining={presentation.showTimeRemaining}
          />
        </View>
        <View style={[styles.panel, { backgroundColor: tokens.panelBackground }]}>
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
  hero: {
    aspectRatio: 1,
    overflow: "hidden",
  },
  topBadges: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
  },
  panel: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
});
