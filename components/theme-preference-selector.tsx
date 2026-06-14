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
        borderRadius: Radii.lg,
        padding: Spacing.lg,
        gap: Spacing.sm,
        backgroundColor: theme.surface,
      }}
    >
      <Text style={{ fontWeight: "800", fontSize: 17, color: theme.text }}>{t("appearance.sectionTitle")}</Text>
      <Text style={{ color: theme.mutedText, fontSize: 14, lineHeight: 20 }}>{t("appearance.sectionHelp")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: Spacing.sm }}>
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
                minWidth: 96,
                flexGrow: 1,
                flexBasis: 96,
                borderRadius: Radii.md,
                borderWidth: active ? 2 : 1,
                borderColor: active ? theme.primary : theme.border,
                backgroundColor: active
                  ? colorScheme === "dark"
                    ? "rgba(255,159,28,0.18)"
                    : "rgba(255,159,28,0.12)"
                  : theme.surfaceMuted,
                paddingVertical: 10,
                paddingHorizontal: 12,
                marginRight: Spacing.sm,
                marginBottom: Spacing.sm,
              }}
            >
              <Text
                style={{
                  color: active ? theme.accentText : colorScheme === "dark" ? theme.text : Gray[700],
                  fontWeight: "800",
                  fontSize: 14,
                  textAlign: "center",
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
              >
                {label}
              </Text>
              <Text
                style={{
                  marginTop: 3,
                  color: active ? theme.accentText : theme.mutedText,
                  fontWeight: "600",
                  fontSize: 11,
                  textAlign: "center",
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
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
