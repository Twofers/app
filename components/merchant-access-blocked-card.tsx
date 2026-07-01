import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { SecondaryButton } from "@/components/ui/secondary-button";
import { CardShell } from "@/components/ui/card-shell";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { SUPPORT_URL, openWebsiteUrl } from "@/lib/legal-urls";
import { Spacing } from "@/lib/screen-layout";

export function MerchantAccessBlockedCard() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  return (
    <CardShell variant="muted">
      <View style={{ gap: Spacing.sm }}>
        <Text style={{ fontSize: 17, fontWeight: "900", color: theme.text }}>
          {t("merchantAccess.inactiveTitle")}
        </Text>
        <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.mutedText }}>
          {t("merchantAccess.inactiveBody")}
        </Text>
        <View style={{ marginTop: Spacing.xs }}>
          <SecondaryButton
            title={t("merchantAccess.contactSupport")}
            onPress={() => void openWebsiteUrl(SUPPORT_URL)}
            style={{ borderRadius: Radii.md }}
          />
        </View>
      </View>
    </CardShell>
  );
}
