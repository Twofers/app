import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import type { AdThemeTokens } from "@/lib/ad-theme-tokens";
import type { MerchantDisplayIdentity } from "@/lib/ad-render-content";

type AdBrandRowProps = {
  merchant: MerchantDisplayIdentity;
  tokens: AdThemeTokens;
  compact?: boolean;
};

export function AdBrandRow({ merchant, tokens, compact }: AdBrandRowProps) {
  const showLogo = Boolean(merchant.logoVerified && merchant.logoUri);
  const supportingLine = merchant.locationName || merchant.addressLine || null;

  return (
    <View style={styles.root}>
      {showLogo ? (
        <Image source={{ uri: merchant.logoUri! }} style={styles.logo} contentFit="cover" accessibilityLabel={`${merchant.name} logo`} />
      ) : (
        <View style={[styles.logoFallback, { backgroundColor: tokens.ctaBackground }]}>
          <Text style={[styles.logoFallbackText, { color: tokens.ctaText }]} numberOfLines={1}>
            {merchant.name.trim().charAt(0).toUpperCase() || "T"}
          </Text>
        </View>
      )}
      <View style={styles.copy}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          maxFontSizeMultiplier={1.15}
          style={[styles.name, compact ? styles.nameCompact : null, { color: tokens.panelText }]}
        >
          {merchant.name}
        </Text>
        {supportingLine && !compact ? (
          <Text numberOfLines={1} maxFontSizeMultiplier={1.15} style={[styles.location, { color: tokens.panelMutedText }]}>
            {supportingLine}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  logo: {
    width: 30,
    height: 30,
    borderRadius: 8,
  },
  logoFallback: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  logoFallbackText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
    letterSpacing: 0,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
    letterSpacing: 0,
  },
  nameCompact: {
    fontSize: 13,
    lineHeight: 17,
  },
  location: {
    marginTop: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    letterSpacing: 0,
  },
});
