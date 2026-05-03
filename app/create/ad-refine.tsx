import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radii, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

export default function AdRefinePlaceholderScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingHorizontal: Spacing.lg,
        justifyContent: "center",
        gap: Spacing.md,
      }}
    >
      <Text style={{ fontSize: 22, fontWeight: "700", color: theme.text }}>
        {t("adRefine.title")}
      </Text>
      <Text style={{ fontSize: 15, lineHeight: 22, color: theme.text, opacity: 0.8 }}>
        {t("adRefine.redirectMessage")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace("/create/ai")}
        style={{
          marginTop: Spacing.sm,
          backgroundColor: theme.primary,
          borderRadius: Radii.md,
          paddingVertical: Spacing.md,
          paddingHorizontal: Spacing.lg,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
          {t("adRefine.continueToCreate")}
        </Text>
      </Pressable>
    </View>
  );
}
