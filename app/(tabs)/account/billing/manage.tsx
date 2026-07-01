import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { openBrowserAsync, WebBrowserPresentationStyle } from "expo-web-browser";

import { Banner } from "@/components/ui/banner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Colors, Radii } from "@/constants/theme";
import { useBusiness } from "@/hooks/use-business";
import { useBusinessLocations } from "@/hooks/use-business-locations";
import { useLocationBillingSummary } from "@/hooks/use-location-billing-summary";
import { isMobilePaidBillingEnabled } from "@/lib/billing/access";
import { EDGE_FUNCTION_TIMEOUT_MS } from "@/lib/functions";
import { useScreenInsets } from "@/lib/screen-layout";
import { supabase } from "@/lib/supabase";

export default function ManageSubscriptionScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const mobileBillingEnabled = isMobilePaidBillingEnabled();
  const { businessId, subscriptionTier, loading: bizLoading } = useBusiness();
  const { visibleLocations, loading: locationsLoading } = useBusinessLocations(
    mobileBillingEnabled ? businessId : null,
    subscriptionTier,
  );
  const locationId = visibleLocations[0]?.id ?? null;
  const { summary, loading: summaryLoading, refresh } = useLocationBillingSummary(
    mobileBillingEnabled ? locationId : null,
  );

  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" | "warning" } | null>(null);

  const openCustomerPortal = async (entry: "manage" | "cancel" | "invoices") => {
    if (busy || !locationId) return;
    if (summary.purchaseSurface !== "in_app_link") {
      setBanner({ message: t("billing.purchaseUnavailable"), tone: "info" });
      return;
    }

    setBusy(true);
    setBanner(null);
    try {
      if (entry === "cancel") {
        setBanner({ message: t("billingManage.cancelHint"), tone: "info" });
      } else if (entry === "invoices") {
        setBanner({ message: t("billingManage.invoicesHint"), tone: "info" });
      }
      const { data, error } = await supabase.functions.invoke("stripe-customer-portal-session", {
        body: { location_id: locationId },
        timeout: EDGE_FUNCTION_TIMEOUT_MS,
      });
      if (error) throw error;
      const url = data?.url as string | undefined;
      if (!url) throw new Error("Missing portal URL.");
      await openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
    } catch {
      setBanner({ message: t("billingManage.errPortal"), tone: "error" });
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const cancelTrialSubscription = async () => {
    if (busy || !locationId || summary.status !== "trial_active") return;
    if (summary.purchaseSurface !== "in_app_link") {
      setBanner({ message: t("billing.purchaseUnavailable"), tone: "info" });
      return;
    }

    setBusy(true);
    setBanner({ message: t("billingManage.cancelTrialRequesting"), tone: "info" });
    try {
      const { error } = await supabase.functions.invoke("stripe-cancel-trial-subscription", {
        body: { location_id: locationId },
        timeout: EDGE_FUNCTION_TIMEOUT_MS,
      });
      if (error) throw error;
      setBanner({ message: t("billingManage.cancelTrialConfirmed"), tone: "success" });
      await refresh();
    } catch {
      setBanner({ message: t("billingManage.errCancelTrial"), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const confirmTrialCancellation = () => {
    if (busy || summary.status !== "trial_active") return;
    Alert.alert(
      t("billingManage.cancelTrialConfirmTitle"),
      t("billingManage.cancelTrialConfirmBody"),
      [
        { text: t("commonUi.cancel"), style: "cancel" },
        {
          text: t("billingManage.cancelTrial"),
          style: "destructive",
          onPress: () => void cancelTrialSubscription(),
        },
      ],
    );
  };

  const cancelPaidSubscription = async () => {
    if (busy || !locationId || (summary.status !== "pro_active" && summary.status !== "paid_active")) return;
    if (summary.purchaseSurface !== "in_app_link") {
      setBanner({ message: t("billing.purchaseUnavailable"), tone: "info" });
      return;
    }

    setBusy(true);
    setBanner({ message: t("billingManage.cancelPaidRequesting"), tone: "info" });
    try {
      const { error } = await supabase.functions.invoke("stripe-cancel-paid-subscription", {
        body: { location_id: locationId },
        timeout: EDGE_FUNCTION_TIMEOUT_MS,
      });
      if (error) throw error;
      setBanner({ message: t("billingManage.cancelPaidConfirmed"), tone: "success" });
      await refresh();
    } catch {
      setBanner({ message: t("billingManage.errCancelPaid"), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const confirmPaidCancellation = () => {
    if (busy || (summary.status !== "pro_active" && summary.status !== "paid_active")) return;
    Alert.alert(
      t("billingManage.cancelPaidConfirmTitle"),
      t("billingManage.cancelPaidConfirmBody"),
      [
        { text: t("commonUi.cancel"), style: "cancel" },
        {
          text: t("billingManage.cancelPaid"),
          style: "destructive",
          onPress: () => void cancelPaidSubscription(),
        },
      ],
    );
  };

  const requestIntroductoryRefund = async () => {
    if (busy || !locationId || !summary.refundEligible) return;
    if (summary.purchaseSurface !== "in_app_link") {
      setBanner({ message: t("billing.purchaseUnavailable"), tone: "info" });
      return;
    }

    setBusy(true);
    setBanner({ message: t("billing.refundRequesting"), tone: "info" });
    try {
      const { error } = await supabase.functions.invoke("stripe-request-introductory-refund", {
        body: { location_id: locationId },
        timeout: EDGE_FUNCTION_TIMEOUT_MS,
      });
      if (error) throw error;
      setBanner({ message: t("billing.refundConfirmed"), tone: "success" });
      await refresh();
    } catch {
      setBanner({ message: t("billing.errRefund"), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const confirmIntroductoryRefund = () => {
    if (busy || !summary.refundEligible) return;
    Alert.alert(
      t("billing.refundConfirmTitle"),
      t("billing.refundConfirmBody"),
      [
        { text: t("commonUi.cancel"), style: "cancel" },
        {
          text: t("billing.cancelNowRefund"),
          style: "destructive",
          onPress: () => void requestIntroductoryRefund(),
        },
      ],
    );
  };

  if (!mobileBillingEnabled) {
    return <Redirect href="/(tabs)/account" />;
  }

  const loading = bizLoading || locationsLoading || summaryLoading;
  const statusLabel = t(`billing.status.${summary.status}`, {
    defaultValue: summary.status.replace(/_/g, " "),
  });
  const canCancelTrial = summary.status === "trial_active";
  const canCancelPaid = summary.status === "pro_active" || summary.status === "paid_active";
  const cancelButtonTitle = canCancelTrial
    ? t("billingManage.cancelTrial")
    : canCancelPaid
      ? t("billingManage.cancelPaid")
      : t("billingManage.cancelSubscription");
  const cancelButtonAction = canCancelTrial
    ? confirmTrialCancellation
    : canCancelPaid
      ? confirmPaidCancellation
      : () => void openCustomerPortal("cancel");

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: top, paddingHorizontal: horizontal, paddingBottom: scrollBottom }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ fontSize: 28, fontWeight: "900", color: Colors.light.text }}>
          {t("billingManage.title")}
        </Text>

        {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

        {loading ? (
          <View style={{ paddingTop: 24 }}>
            <ActivityIndicator color={Colors.light.primary} />
          </View>
        ) : (
          <View style={{ marginTop: 18, gap: 12 }}>
            <View
              style={{
                borderRadius: Radii.lg,
                borderWidth: 1,
                borderColor: Colors.light.border,
                backgroundColor: Colors.light.surface,
                padding: 16,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "900", color: Colors.light.text }}>
                {t("billing.planName")}
              </Text>
              <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 20, color: Colors.light.mutedText, fontWeight: "700" }}>
                {t("billingManage.current", { status: statusLabel })}
              </Text>
            </View>

            {summary.purchaseSurface !== "in_app_link" ? (
              <Banner message={t("billing.purchaseUnavailable")} tone="info" />
            ) : null}

            {summary.refundEligible ? (
              <Banner message={t("billing.refundEligibility")} tone="info" />
            ) : null}

            {summary.status === "trial_canceling" ? (
              <Banner message={t("billingManage.trialCanceling")} tone="success" />
            ) : null}

            {summary.status === "pro_canceling" || summary.status === "paid_canceling" ? (
              <Banner message={t("billingManage.paidCanceling")} tone="success" />
            ) : null}

            <Text style={{ fontSize: 13, opacity: 0.7, fontWeight: "700" }}>
              {t("billingManage.actionsTitle")}
            </Text>
            <PrimaryButton
              title={t("billingManage.openStripePortal")}
              onPress={() => void openCustomerPortal("manage")}
              disabled={busy || summary.purchaseSurface !== "in_app_link"}
            />

            <SecondaryButton
              title={cancelButtonTitle}
              onPress={cancelButtonAction}
              disabled={busy || summary.purchaseSurface !== "in_app_link"}
            />

            {summary.refundEligible ? (
              <SecondaryButton
                title={t("billing.cancelNowRefund")}
                onPress={confirmIntroductoryRefund}
                disabled={busy || summary.purchaseSurface !== "in_app_link"}
              />
            ) : null}

            <SecondaryButton
              title={t("billingManage.viewInvoices")}
              onPress={() => void openCustomerPortal("invoices")}
              disabled={busy || summary.purchaseSurface !== "in_app_link"}
            />

            <SecondaryButton
              title={t("billingManage.backToBilling")}
              onPress={() => router.back()}
              disabled={busy}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
