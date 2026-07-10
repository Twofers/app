import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { CardShell } from "@/components/ui/card-shell";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { BUSINESS_START_TRIAL_URL, SUPPORT_URL, openWebsiteUrl } from "@/lib/legal-urls";
import { isNeverActivatedBillingStatus } from "@/lib/merchant-access";
import { Spacing } from "@/lib/screen-layout";

type MerchantAccessBlockedCardProps = {
  /**
   * Current billing status from the merchant access gate. Never-activated
   * statuses (fresh account / unfinished checkout) show the "start free trial"
   * path; every other blocked status keeps the "contact support" message.
   */
  status?: string | null;
};

export function MerchantAccessBlockedCard({ status }: MerchantAccessBlockedCardProps) {
  const { t } = useTranslation();
  const { session } = useAuthSession();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  const email = session?.user?.email ?? null;
  const needsTrial = isNeverActivatedBillingStatus(status);

  if (needsTrial) {
    return (
      <CardShell variant="muted">
        <View style={{ gap: Spacing.sm }}>
          <Text style={{ fontSize: 17, fontWeight: "900", color: theme.text }}>
            {t("merchantAccess.verifyTitle")}
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.mutedText }}>
            {t("merchantAccess.verifyBody")}
          </Text>
          {email ? (
            <View>
              <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.mutedText }}>
                {t("merchantAccess.verifyEmailHint")}
              </Text>
              <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: "800", color: theme.text }}>
                {email}
              </Text>
            </View>
          ) : null}
          <View style={{ marginTop: Spacing.xs, gap: Spacing.sm }}>
            <PrimaryButton
              title={t("merchantAccess.startTrialCta")}
              onPress={() => void openWebsiteUrl(BUSINESS_START_TRIAL_URL)}
              style={{ borderRadius: Radii.md }}
            />
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
