import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { AdThemeTokens } from "@/lib/ad-theme-tokens";
import type { ComposedAdSecondaryAction } from "./types";

type AdCallToActionProps = {
  label: string;
  tokens: AdThemeTokens;
  disabled?: boolean;
  onPress?: () => void;
  secondaryAction?: ComposedAdSecondaryAction | null;
  /**
   * Stack the primary + secondary buttons vertically. Used by compact layouts
   * (e.g. the poster template's narrow action column) where a side-by-side row
   * would squeeze the primary label to nothing and clip it to an empty chip.
   */
  stacked?: boolean;
};

export function AdCallToAction({ label, tokens, disabled, onPress, secondaryAction, stacked }: AdCallToActionProps) {
  const primaryInteractionDisabled = disabled || !onPress;

  return (
    <View style={stacked ? styles.rootStacked : styles.root}>
      <Pressable
        onPress={onPress}
        disabled={primaryInteractionDisabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.primary,
          stacked ? styles.primaryStacked : null,
          {
            backgroundColor: disabled ? "rgba(156,163,175,0.45)" : tokens.ctaBackground,
            opacity: pressed && !primaryInteractionDisabled ? 0.88 : 1,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
          maxFontSizeMultiplier={1.15}
          style={[styles.primaryText, { color: tokens.ctaText }]}
        >
          {label}
        </Text>
      </Pressable>

      {secondaryAction ? (
        <Pressable
          onPress={secondaryAction.onPress}
          disabled={secondaryAction.disabled}
          accessibilityRole="button"
          accessibilityLabel={secondaryAction.accessibilityLabel ?? secondaryAction.label}
          accessibilityState={{ selected: secondaryAction.selected, disabled: secondaryAction.disabled }}
          style={({ pressed }) => [
            styles.secondary,
            stacked ? styles.secondaryStacked : null,
            {
              borderColor: tokens.border,
              backgroundColor: pressed && !secondaryAction.disabled ? "rgba(255,159,28,0.12)" : "transparent",
              opacity: secondaryAction.disabled ? 0.55 : 1,
            },
          ]}
        >
          <MaterialIcons
            name={secondaryAction.selected ? "favorite" : "favorite-border"}
            size={18}
            color={tokens.panelText}
          />
          <Text numberOfLines={1} maxFontSizeMultiplier={1.15} style={[styles.secondaryText, { color: tokens.panelText }]}>
            {secondaryAction.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rootStacked: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 8,
  },
  secondaryStacked: {
    maxWidth: undefined,
  },
  primaryStacked: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    alignSelf: "stretch",
  },
  primary: {
    flex: 1,
    minHeight: 46,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "900",
    letterSpacing: 0,
  },
  secondary: {
    minHeight: 46,
    maxWidth: 122,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  secondaryText: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    letterSpacing: 0,
  },
});
