import { StyleSheet, Text } from "react-native";

import type { AdThemeTokens } from "@/lib/ad-theme-tokens";

type AdSupportingCopyProps = {
  children?: string | null;
  tokens: AdThemeTokens;
};

export function AdSupportingCopy({ children, tokens }: AdSupportingCopyProps) {
  const text = typeof children === "string" ? children.trim() : "";
  if (!text) return null;

  return (
    <Text numberOfLines={2} maxFontSizeMultiplier={1.15} style={[styles.copy, { color: tokens.panelMutedText }]}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  copy: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    letterSpacing: 0,
  },
});
