import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { CardShell } from "@/components/ui/card-shell";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTrialActivation } from "@/hooks/use-trial-activation";
import { isNeverActivatedBillingStatus } from "@/lib/merchant-access";
import { Spacing } from "@/lib/screen-layout";
import { openSupportEmail } from "@/lib/support-contact";

type MerchantAccessBlockedCardProps = {
  /**
   * Current billing status from the merchant access gate. Never-activated
   * statuses (fresh account / unfinished checkout) show the "start free trial"
   * path; every other blocked status keeps the "contact support" message.
   */
  status?: string | null;
  reason?: string | null;
  /**
   * Owner's business. When present and both iOS gates permit it, the CTA mints
   * and opens an allowlisted Stripe Checkout URL. Missing ids and failures stay
   * on this approval-email/support card.
   */
  businessId?: string | null;
};

export function MerchantAccessBlockedCard({ status, reason, businessId }: MerchantAccessBlockedCardProps) {
  const { t } = useTranslation();
  const { session } = useAuthSession();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const {
    checkoutEnabled,
    failed: checkoutFailed,
    opening: openingCheckout,
    start: startActivation,
  } = useTrialActivation(businessId);

  const email = session?.user?.email ?? null;
  const needsTrial =
    reason === "approved_not_activated" &&
    isNeverActivatedBillingStatus(status);

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
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 14, lineHeight: 20, color: theme.text }}>
              {t("merchantAccess.setupProgressProfile")}
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 20, color: theme.text }}>
              {t("merchantAccess.setupProgressMenu")}
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 20, color: theme.mutedText }}>
              {t("merchantAccess.setupProgressLocked")}
            </Text>
          </View>
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
            {checkoutEnabled ? (
              <PrimaryButton
                title={openingCheckout ? t("merchantAccess.startTrialOpening") : t("merchantAccess.startTrialCta")}
                onPress={() => void startActivation()}
                disabled={openingCheckout}
                style={{ borderRadius: Radii.md }}
              />
            ) : null}
            {checkoutFailed ? (
              <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: "600", color: theme.mutedText }}>
                {t("merchantAccess.checkoutUnavailable")}
              </Text>
            ) : null}
            <SecondaryButton
              title={t("merchantAccess.contactSupport")}
              onPress={() => void openSupportEmail()}
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
            onPress={() => void openSupportEmail()}
            style={{ borderRadius: Radii.md }}
          />
        </View>
      </View>
    </CardShell>
  );
}
