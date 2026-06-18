import { Platform, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { MobileOnlyWebFallback } from "@/components/mobile-only-web-fallback";
import { EmptyState } from "@/components/ui/empty-state";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";

export default function NotFoundScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const { top, horizontal } = useScreenInsets("stack");

  if (Platform.OS === "web") {
    return <MobileOnlyWebFallback />;
  }

  return (
    <View
      style={{
        flex: 1,
        paddingTop: top,
        paddingHorizontal: horizontal,
        backgroundColor: theme.background,
        justifyContent: "center",
        gap: Spacing.md,
      }}
    >
      <EmptyState
        title={t("webFallback.loadErrorTitle", { defaultValue: "We couldn't load this page." })}
        message={t("webFallback.notFoundBody", { defaultValue: "The link may be old or typed incorrectly." })}
        actionLabel={t("commonUi.tryAgain")}
        onAction={() => router.replace("/" as Href)}
      />
      <SecondaryButton
        title={t("commonUi.goBack", { defaultValue: "Back" })}
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/" as Href);
        }}
      />
    </View>
  );
}
