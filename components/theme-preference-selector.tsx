import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Colors, Gray, Radii, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useThemePreference } from "@/components/providers/app-theme-provider";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import type { ThemePreference } from "@/lib/theme-preference";

const OPTIONS: ThemePreference[] = ["system", "light", "dark"];

export function ThemePreferenceSelector() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const { preference, setPreference } = useThemePreference();

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: Radii.md,
        padding: Spacing.md,
        gap: Spacing.xs,
        backgroundColor: theme.surface,
      }}
    >
      <Text style={{ fontWeight: "800", fontSize: 16, lineHeight: 20, color: theme.text }} maxFontSizeMultiplier={1.08}>
        {t("appearance.sectionTitle")}
      </Text>
      <Text style={{ color: theme.mutedText, fontSize: 13, lineHeight: 17 }} numberOfLines={2} maxFontSizeMultiplier={1.08}>
        {t("appearance.sectionHelp")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 2 }}>
        {OPTIONS.map((option) => {
          const active = preference === option;
          const label = t(`appearance.${option}`);
          const hint = t(`appearance.${option}Hint`);
          return (
            <Pressable
              key={option}
              onPress={() => void setPreference(option)}
              accessibilityRole="button"
              accessibilityLabel={`${label}. ${hint}`}
              accessibilityState={{ selected: active }}
              style={{
                minWidth: 88,
                flexGrow: 1,
                flexBasis: 88,
                borderRadius: Radii.md,
                borderWidth: active ? 2 : 1,
                borderColor: active ? theme.primary : theme.border,
                backgroundColor: active
                  ? colorScheme === "dark"
                    ? "rgba(255,159,28,0.18)"
                    : "rgba(255,159,28,0.12)"
                  : theme.surfaceMuted,
                paddingVertical: 8,
                paddingHorizontal: 8,
                marginRight: 6,
                marginBottom: 6,
              }}
            >
              <Text
                style={{
                  color: active ? theme.accentText : colorScheme === "dark" ? theme.text : Gray[700],
                  fontWeight: "800",
                  fontSize: 13,
                  textAlign: "center",
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                maxFontSizeMultiplier={1.08}
              >
                {label}
              </Text>
              <Text
                style={{
                  marginTop: 3,
                  color: active ? theme.accentText : theme.mutedText,
                  fontWeight: "600",
                  fontSize: 10,
                  textAlign: "center",
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                maxFontSizeMultiplier={1.08}
              >
                {hint}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
