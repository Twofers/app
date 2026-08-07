import { Text, View, type ViewStyle } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { Colors, PrimaryTint, Radii, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";

type SelectableChipVariant = "chip" | "row";

type SelectableChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  variant: SelectableChipVariant;
  disabled?: boolean;
  /** Optional secondary line under the label (chip variant only). */
  subtitle?: string;
  /** Optional leading icon shown before the label (row variant only). */
  glyph?: keyof typeof MaterialIcons.glyphMap;
  accessibilityRole?: "button" | "radio";
  accessibilityLabel?: string;
  style?: ViewStyle;
};

/**
 * One shared "this option is selected" treatment for the whole app (A1).
 * - variant="chip": horizontal pill for filter/segment/tag rows.
 * - variant="row": full-width option row with a radio glyph.
 */
export function SelectableChip({
  label,
  selected,
  onPress,
  variant,
  disabled,
  subtitle,
  glyph,
  accessibilityRole = "button",
  accessibilityLabel,
  style,
}: SelectableChipProps) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  if (variant === "row") {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole={accessibilityRole}
        accessibilityState={{ selected, disabled }}
        accessibilityLabel={accessibilityLabel ?? label}
        style={[
          {
            borderWidth: 1,
            borderColor: selected ? theme.primary : theme.border,
            borderRadius: Radii.md,
            // 44 = the platform minimum touch target. The inline rows this
            // component replaced pinned it explicitly; padding alone lands
            // at ~40 for a single-line label, so keep the floor here.
            minHeight: 44,
            paddingVertical: 10,
            paddingHorizontal: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: selected ? PrimaryTint.surfaceStrong : theme.surface,
            opacity: disabled ? 0.6 : 1,
          },
          style,
        ]}
      >
        {glyph ? (
          <MaterialIcons name={glyph} size={18} color={selected ? theme.primary : theme.icon} />
        ) : (
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              borderWidth: 2,
              borderColor: selected ? theme.primary : theme.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {selected ? (
              <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: theme.primary }} />
            ) : null}
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text
            style={{ color: theme.text, fontWeight: "800", fontSize: 14, lineHeight: 18 }}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            maxFontSizeMultiplier={1.08}
          >
            {label}
          </Text>
          {subtitle ? (
            <Text style={{ color: theme.mutedText, fontSize: 12, lineHeight: 16, marginTop: 2 }} numberOfLines={2} maxFontSizeMultiplier={1.08}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        {
          paddingVertical: Spacing.sm,
          paddingHorizontal: Spacing.md,
          borderRadius: Radii.pill,
          backgroundColor: selected ? theme.primary : theme.surfaceMuted,
          opacity: disabled ? 0.6 : 1,
        },
        style,
      ]}
    >
      <Text
        style={{ color: selected ? theme.primaryText : theme.text, fontWeight: selected ? "800" : "600", fontSize: 13, textAlign: "center" }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.78}
        maxFontSizeMultiplier={1.15}
      >
        {label}
      </Text>
      {subtitle ? (
        <Text
          style={{ marginTop: 3, color: selected ? theme.primaryText : theme.mutedText, fontWeight: "600", fontSize: 10, textAlign: "center" }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          maxFontSizeMultiplier={1.08}
        >
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}
