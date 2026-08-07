import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radii, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useThemePreference } from "@/components/providers/app-theme-provider";
import { SelectableChip } from "@/components/ui/selectable-chip";
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
            <SelectableChip
              key={option}
              variant="chip"
              label={label}
              subtitle={hint}
              selected={active}
              onPress={() => void setPreference(option)}
              accessibilityLabel={`${label}. ${hint}`}
              style={{
                minWidth: 88,
                flexGrow: 1,
                flexBasis: 88,
                borderRadius: Radii.md,
                paddingVertical: 8,
                paddingHorizontal: 8,
                marginRight: 6,
                marginBottom: 6,
              }}
            />
          );
        })}
      </View>
    </View>
  );
}
