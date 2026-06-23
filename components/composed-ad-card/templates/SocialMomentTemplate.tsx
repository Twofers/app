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

export function SocialMomentTemplate(props: ComposedAdTemplateProps) {
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
        <LinearGradient
          colors={["rgba(0,0,0,0.04)", "rgba(0,0,0,0.62)"]}
          start={{ x: 0, y: 0.1 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.status}>
          <AdStatusBadges
            liveState={liveState}
            tokens={tokens}
            showLiveStatus={presentation.showLiveStatus}
            showQuantityRemaining={presentation.showQuantityRemaining}
            showTimeRemaining={presentation.showTimeRemaining}
          />
        </View>
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
    height: 265,
    overflow: "hidden",
  },
  status: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
  },
  panel: {
    padding: 14,
    gap: 9,
  },
});
