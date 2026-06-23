import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Spacing, useScreenInsets } from "@/lib/screen-layout";

type MenuAction = {
  href: Href;
  iconName: ComponentProps<typeof MaterialIcons>["name"];
  titleKey: string;
  subtitleKey: string;
};

const MENU_ACTIONS: MenuAction[] = [
  {
    href: "/create/menu-offer" as Href,
    iconName: "restaurant-menu",
    titleKey: "createHub.menuDealFastTitle",
    subtitleKey: "createHub.menuDealFastSubtitle",
  },
  {
    href: "/create/menu-scan" as Href,
    iconName: "document-scanner",
    titleKey: "createHub.scanMenuTitle",
    subtitleKey: "createHub.scanMenuSubtitle",
  },
  {
    href: "/create/menu-manager" as Href,
    iconName: "menu-book",
    titleKey: "createHub.menuManagerTitle",
    subtitleKey: "createHub.menuManagerSubtitle",
  },
];

export default function MenuHubScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { horizontal, scrollBottom } = useScreenInsets("stack");
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{
        paddingHorizontal: horizontal,
        paddingTop: Spacing.xxxl,
        paddingBottom: scrollBottom,
        gap: Spacing.md,
      }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={{ color: theme.mutedText, fontSize: 15, lineHeight: 22 }}>
        {t("createHub.menuSubtitle")}
      </Text>

      <View style={{ gap: Spacing.sm }}>
        {MENU_ACTIONS.map((action) => (
          <Pressable
            key={String(action.href)}
            onPress={() => router.push(action.href)}
            accessibilityRole="button"
            style={{
              borderRadius: Radii.md,
              padding: Spacing.md,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              flexDirection: "row",
              alignItems: "center",
              gap: Spacing.md,
            }}
          >
            <MaterialIcons name={action.iconName} size={22} color={theme.accentText} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>
                {t(action.titleKey)}
              </Text>
              <Text style={{ color: theme.mutedText, fontSize: 13, marginTop: 2 }}>
                {t(action.subtitleKey)}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={theme.icon} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
