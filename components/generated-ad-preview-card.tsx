import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";
import { buildDeterministicAdFallbackVisual } from "@/lib/deterministic-ad-fallback-visual";

type GeneratedAdPreviewCardTheme = {
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  mutedText: string;
  primary: string;
  primaryText: string;
  accentText: string;
};

export type GeneratedAdPreviewCardProps = {
  imageUri: string | null;
  businessName?: string | null;
  headline: string;
  body: string;
  imageAltText?: string | null;
  offerLine?: string | null;
  termsLine?: string | null;
  cta: string;
  scheduleSummary: string;
  maxClaimsLabel: string;
  maxClaimsValue: number | string;
  termsLabel: string;
  termsHelper: string;
  noImageLabel: string;
  fallbackVisualLabel?: string | null;
  addressLine?: string | null;
  theme: GeneratedAdPreviewCardTheme;
  darkMode: boolean;
};

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function GeneratedAdPreviewCard({
  imageUri,
  businessName,
  headline,
  body,
  imageAltText,
  offerLine,
  termsLine,
  cta,
  scheduleSummary,
  maxClaimsLabel,
  maxClaimsValue,
  termsLabel,
  termsHelper,
  noImageLabel,
  fallbackVisualLabel,
  addressLine,
  theme,
  darkMode,
}: GeneratedAdPreviewCardProps) {
  const cleanBusiness = clean(businessName);
  const cleanImageAltText = clean(imageAltText);
  const cleanOffer = clean(offerLine);
  const cleanTerms = clean(termsLine);
  const cleanBody = clean(body);
  const cleanAddress = clean(addressLine);
  const fallbackVisual = buildDeterministicAdFallbackVisual({
    businessName,
    headline,
    offerLine,
  });
  const fallbackLabel = clean(fallbackVisualLabel) || noImageLabel;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          shadowOpacity: darkMode ? 0 : 0.12,
        },
      ]}
    >
      <View style={styles.hero}>
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessibilityLabel={cleanImageAltText || headline}
          />
        ) : (
          <View style={StyleSheet.absoluteFill}>
            <LinearGradient
              colors={fallbackVisual.palette.background}
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
              <View
                style={[
                  styles.fallbackMark,
                  { backgroundColor: fallbackVisual.palette.markBackground },
                ]}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
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
                {fallbackLabel}
              </Text>
            </View>
          </View>
        )}

      </View>

      <View style={styles.footer}>
        <View style={styles.footerHeader}>
          <Text style={[styles.footerBrand, { color: theme.accentText }]}>Twofer</Text>
          {cleanBusiness ? (
            <Text numberOfLines={1} style={[styles.footerBusiness, { color: theme.mutedText }]}>
              {cleanBusiness}
            </Text>
          ) : null}
        </View>
        {cleanOffer ? (
          <Text numberOfLines={2} style={[styles.footerOffer, { color: theme.accentText }]}>
            {cleanOffer}
          </Text>
        ) : null}
        <Text numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.82} style={[styles.footerHeadline, { color: theme.text }]}>
          {headline}
        </Text>
        {cleanBody ? (
          <Text numberOfLines={3} style={[styles.footerBody, { color: theme.mutedText }]}>
            {cleanBody}
          </Text>
        ) : null}

        <View style={styles.chipRow}>
          <View style={[styles.chip, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
            <Text numberOfLines={1} style={[styles.chipText, { color: theme.text }]}>
              {scheduleSummary}
            </Text>
          </View>
          <View style={[styles.chip, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
            <Text numberOfLines={1} style={[styles.chipText, { color: theme.text }]}>
              {maxClaimsLabel} {maxClaimsValue}
            </Text>
          </View>
        </View>

        <View style={styles.ctaRow}>
          <View style={[styles.cta, { backgroundColor: theme.primary }]}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.86} style={[styles.ctaText, { color: theme.primaryText }]}>
              {cta}
            </Text>
          </View>
          {cleanAddress ? (
            <Text numberOfLines={2} style={[styles.address, { color: theme.mutedText }]}>
              {cleanAddress}
            </Text>
          ) : null}
        </View>

        {cleanTerms ? (
          <View style={[styles.terms, { borderTopColor: theme.border }]}>
            <Text style={[styles.termsLabel, { color: theme.mutedText }]}>{termsLabel}</Text>
            <Text style={[styles.termsLine, { color: theme.text }]}>{cleanTerms}</Text>
            <Text style={[styles.termsHelper, { color: theme.mutedText }]}>{termsHelper}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 3,
  },
  hero: {
    height: 300,
    overflow: "hidden",
  },
  fallbackPattern: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.34,
  },
  fallbackStripe: {
    position: "absolute",
    height: 58,
    width: "125%",
    left: "-10%",
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.18)",
    transform: [{ rotate: "-16deg" }],
  },
  fallbackStripeOne: {
    top: 82,
  },
  fallbackStripeTwo: {
    top: 190,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  fallbackBlock: {
    position: "absolute",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.34)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  fallbackBlockOne: {
    width: 92,
    height: 92,
    right: 22,
    top: 58,
    transform: [{ rotate: "9deg" }],
  },
  fallbackBlockTwo: {
    width: 58,
    height: 58,
    left: 28,
    top: 184,
    transform: [{ rotate: "-11deg" }],
  },
  fallbackArt: {
    position: "absolute",
    top: 82,
    left: 18,
    right: 18,
    alignItems: "center",
    gap: 10,
  },
  fallbackMark: {
    width: 88,
    height: 88,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 3,
  },
  fallbackMarkText: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "900",
    letterSpacing: 0,
  },
  fallbackLabel: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  brandBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  brandBadgeText: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
  },
  businessBadge: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.42)",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  businessBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
  },
  heroCopy: {
    gap: 10,
    paddingHorizontal: 18,
    paddingBottom: 20,
  },
  offerBadge: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    maxWidth: "100%",
  },
  offerBadgeText: {
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 17,
    letterSpacing: 0,
  },
  headline: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "900",
    lineHeight: 37,
    letterSpacing: 0,
  },
  body: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
    letterSpacing: 0,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 13,
  },
  footerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  footerBrand: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  footerBusiness: {
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
  },
  footerOffer: {
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 18,
    letterSpacing: 0,
  },
  footerHeadline: {
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 31,
    letterSpacing: 0,
  },
  footerBody: {
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 21,
    letterSpacing: 0,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 7,
    maxWidth: "100%",
  },
  chipText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
  },
  ctaRow: {
    gap: 8,
  },
  cta: {
    alignSelf: "flex-start",
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 11,
    maxWidth: "100%",
  },
  ctaText: {
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
  },
  address: {
    fontSize: 13,
    lineHeight: 18,
  },
  terms: {
    borderTopWidth: 1,
    paddingTop: 12,
  },
  termsLabel: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0,
  },
  termsLine: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  termsHelper: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
  },
});
