import { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { openBrowserAsync, WebBrowserPresentationStyle } from "expo-web-browser";

import { useBusiness } from "@/hooks/use-business";
import { supabase } from "@/lib/supabase";
import { Colors, Spacing } from "@/constants/theme";
import { Banner } from "@/components/ui/banner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { EDGE_FUNCTION_TIMEOUT_MS, parseFunctionError } from "@/lib/functions";

export default function ManageSubscriptionScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { subscriptionStatus, subscriptionTier, loading, refresh } = useBusiness();

  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" | "warning" } | null>(null);

  const tierLabel = useMemo(() => {
    if (subscriptionTier === "premium") return "Twofer Premium";
    return "Twofer Pro";
  }, [subscriptionTier]);

  const openCustomerPortal = async (entry: "manage" | "cancel" | "invoices") => {
    if (busy) return;
    setBusy(true);
    setBanner(null);
    try {
      if (entry === "cancel") {
        setBanner({
          message: t("billingManage.cancelHint", {
            defaultValue: "Use Stripe Portal to cancel your subscription.",
          }),
          tone: "info",
        });
      } else if (entry === "invoices") {
        setBanner({
          message: t("billingManage.invoicesHint", {
            defaultValue: "Use Stripe Portal to view invoices and payment history.",
          }),
          tone: "info",
        });
      }
      const { data, error } = await supabase.functions.invoke("stripe-customer-portal-session", {
        body: {},
        timeout: EDGE_FUNCTION_TIMEOUT_MS,
      });
      if (error) throw error;
      const url = data?.url as string | undefined;
      if (!url) {
        throw new Error(
          t("billingManage.errPortal", { defaultValue: "Unable to open Stripe portal." }),
        );
      }
      await openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
    } catch (err) {
      setBanner({
        message:
          err instanceof Error
            ? err.message
            : parseFunctionError(err) ||
              t("billingManage.errPortal", { defaultValue: "Unable to open Stripe portal." }),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const upgrade = async () => {
    if (busy) return;
    setBusy(true);
    setBanner(null);
    try {
      const targetTier = "premium";
      const { data, error } = await supabase.functions.invoke("stripe-create-checkout-session", {
        body: { tier: targetTier },
        timeout: EDGE_FUNCTION_TIMEOUT_MS,
      });
      if (error) throw error;
      const url = data?.checkout_url as string | undefined;
      if (!url) {
        throw new Error(
          t("billingManage.errUpgrade", { defaultValue: "Unable to start upgrade checkout." }),
        );
      }
      await openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
    } catch (err) {
      setBanner({
        message:
          err instanceof Error
            ? err.message
            : parseFunctionError(err) ||
              t("billingManage.errUpgrade", { defaultValue: "Unable to start upgrade checkout." }),
        tone: "error",
      });
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 40 }}>
        <Text style={{ fontSize: 28, fontWeight: "900", letterSpacing: -0.6, color: Colors.light.text }}>
          {t("billingManage.title", { defaultValue: "Manage Subscription" })}
        </Text>

        <Text style={{ marginTop: 10, fontSize: 15, opacity: 0.72, fontWeight: "700", lineHeight: 22 }}>
          {t("billingManage.current", {
            defaultValue: "Current plan: {{tier}} (status: {{status}})",
            tier: tierLabel,
            status: subscriptionStatus,
          })}
        </Text>

        {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

        {loading ? (
          <View style={{ paddingTop: 24 }}>
            <ActivityIndicator color={Colors.light.primary} />
          </View>
        ) : (
          <View style={{ marginTop: 18, gap: 12 }}>
            <Text style={{ fontSize: 13, opacity: 0.7, fontWeight: "700" }}>
              {t("billingManage.actionsTitle", { defaultValue: "Subscription actions" })}
            </Text>
            <PrimaryButton
              title={t("billingManage.openStripePortal", { defaultValue: "Open Stripe Portal" })}
              onPress={() => void openCustomerPortal("manage")}
              disabled={busy}
              style={{ backgroundColor: "#FF9F1C", borderRadius: 22, height: 62, minHeight: 62 }}
            />

            <SecondaryButton
              title={t("billingManage.upgradeToPremium", { defaultValue: "Upgrade" })}
              onPress={() => void upgrade()}
              disabled={busy || subscriptionTier === "premium"}
            />

            <SecondaryButton
              title={t("billingManage.cancelSubscription", { defaultValue: "Cancel Subscription" })}
              onPress={() => void openCustomerPortal("cancel")}
              disabled={busy}
            />

            <SecondaryButton
              title={t("billingManage.viewInvoices", { defaultValue: "View Invoices" })}
              onPress={() => void openCustomerPortal("invoices")}
              disabled={busy}
            />

            <SecondaryButton
              title={t("billingManage.backToBilling", { defaultValue: "Back to Billing" })}
              onPress={() => router.back()}
              disabled={busy}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

