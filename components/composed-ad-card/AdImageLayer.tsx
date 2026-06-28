import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";

import { buildDeterministicAdFallbackVisual } from "@/lib/deterministic-ad-fallback-visual";
import type { AdPresentationSpec } from "@/lib/ad-presentation-spec";
import type { AdThemeTokens } from "@/lib/ad-theme-tokens";

type AdImageLayerProps = {
  imageUri?: string | null;
  merchantName: string;
  headline: string;
  offerLine: string;
  presentation: AdPresentationSpec;
  tokens: AdThemeTokens;
  fallbackVisualLabel?: string | null;
  rounded?: boolean;
};

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function AdImageLayer({
  imageUri,
  merchantName,
  headline,
  offerLine,
  presentation,
  tokens,
  fallbackVisualLabel,
  rounded,
}: AdImageLayerProps) {
  const fallbackVisual = buildDeterministicAdFallbackVisual({
    businessName: merchantName,
    headline,
    offerLine,
  });
  const showImage = Boolean(clean(imageUri)) && presentation.imageSourceType !== "deterministic_fallback";
  const label = clean(fallbackVisualLabel) || "Twofer offer";

  return (
    <View style={[styles.root, rounded ? styles.rounded : null]}>
      {showImage ? (
        <Image
          source={{ uri: imageUri! }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          accessibilityLabel={headline}
        />
      ) : (
        <>
          <LinearGradient
            colors={tokens.fallbackGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.fallbackPattern} pointerEvents="none">
            <View style={[styles.fallbackStripe, styles.fallbackStripeOne]} />
            <View style={[styles.fallbackStripe, styles.fallbackStripeTwo]} />
            <View style={[styles.fallbackBlock, styles.fallbackBlockOne]} />
            <View style={[styles.fallbackBlock, styles.fallbackBlockTwo]} />
          </View>
          <View style={styles.fallbackArt}>
            <View style={[styles.fallbackMark, { backgroundColor: fallbackVisual.palette.markBackground }]}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                style={[styles.fallbackMarkText, { color: fallbackVisual.palette.markText }]}
              >
                {fallbackVisual.initials}
              </Text>
            </View>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              style={[styles.fallbackLabel, { color: fallbackVisual.palette.accent }]}
            >
              {label}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: "hidden",
  },
  rounded: {
    borderRadius: 8,
  },
  fallbackPattern: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.3,
  },
  fallbackStripe: {
    position: "absolute",
    height: 42,
    width: "128%",
    left: "-12%",
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.16)",
    transform: [{ rotate: "-14deg" }],
  },
  fallbackStripeOne: {
    top: 50,
  },
  fallbackStripeTwo: {
    top: 142,
    backgroundColor: "rgba(255,255,255,0.11)",
  },
  fallbackBlock: {
    position: "absolute",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.32)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  fallbackBlockOne: {
    width: 84,
    height: 84,
    right: 18,
    top: 44,
    transform: [{ rotate: "8deg" }],
  },
  fallbackBlockTwo: {
    width: 54,
    height: 54,
    left: 22,
    bottom: 44,
    transform: [{ rotate: "-10deg" }],
  },
  fallbackArt: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 18,
  },
  fallbackMark: {
    width: 82,
    height: 82,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackMarkText: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "900",
    letterSpacing: 0,
  },
  fallbackLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
});
