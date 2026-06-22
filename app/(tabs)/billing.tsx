import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { MaterialIcons } from "@expo/vector-icons";
import { openBrowserAsync, WebBrowserPresentationStyle } from "expo-web-browser";

import { Banner } from "@/components/ui/banner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Colors, PrimaryTint, Radii } from "@/constants/theme";
import { useBusiness } from "@/hooks/use-business";
import { useBusinessLocations } from "@/hooks/use-business-locations";
import { useLocationBillingSummary } from "@/hooks/use-location-billing-summary";
import { isSuspendedBillingStatus } from "@/lib/billing/entitlements";
import { canManageBillingInPortal, getTrialReminderWindowDays } from "@/lib/billing/trial-reminders";
import { PAID_BILLING_ENABLED } from "@/lib/billing/access";
import { EDGE_FUNCTION_TIMEOUT_MS } from "@/lib/functions";
import { useScreenInsets } from "@/lib/screen-layout";
import { supabase } from "@/lib/supabase";

type BillingCheckout = "success" | "cancel";

function hoursUntil(targetIso: string | null): number | null {
  if (!targetIso) return null;
  const ms = new Date(targetIso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil((ms - Date.now()) / 3600000));
}

function stripeCheckoutLocale(language: string | undefined): "en" | "es-419" | "ko" {
  const base = String(language ?? "").toLowerCase();
  if (base.startsWith("es")) return "es-419";
  if (base.startsWith("ko")) return "ko";
  return "en";
}

export default function BusinessBillingScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { checkout, reason } = useLocalSearchParams<{ checkout?: BillingCheckout; reason?: string }>();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const {
    businessId,
    subscriptionTier,
    loading: bizLoading,
  } = useBusiness();
  const {
    visibleLocations,
    loading: locationsLoading,
    error: locationsError,
  } = useBusinessLocations(businessId, subscriptionTier);
  const primaryLocation = visibleLocations[0] ?? null;
  const locationId = primaryLocation?.id ?? null;
  const {
    summary,
    loading: summaryLoading,
    error: summaryError,
    refresh,
  } = useLocationBillingSummary(locationId);

  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" | "warning" } | null>(null);
  const [trialAcknowledged, setTrialAcknowledged] = useState(false);

  const expirePendingCheckout = useCallback(async () => {
    if (
      !locationId ||
      summary.status !== "trial_checkout_pending" ||
      summary.purchaseSurface !== "in_app_link"
    ) {
      return;
    }

    try {
      await supabase.functions.invoke("stripe-expire-pending-checkout", {
        body: { location_id: locationId },
        timeout: EDGE_FUNCTION_TIMEOUT_MS,
      });
      await refresh();
    } catch {
      // Best effort: the owner still sees the canceled-checkout banner and can refresh.
    }
  }, [locationId, refresh, summary.purchaseSurface, summary.status]);

  const remainingTime = useMemo(() => {
    const hours = hoursUntil(summary.trialEndsAt);
    if (hours === null) return null;
    if (hours < 24) {
      return t("billing.hoursRemaining", { hours });
    }
    return t("billing.daysRemaining", { days: Math.ceil(hours / 24) });
  }, [summary.trialEndsAt, t]);

  const statusLabel = t(`billing.status.${summary.status}`, {
    defaultValue: summary.status.replace(/_/g, " "),
  });

  const isSuspended = isSuspendedBillingStatus(summary.status);
  const canStartTrial = summary.status === "trial_eligible" && summary.purchaseSurface === "in_app_link";
  const showPortal = summary.purchaseSurface === "in_app_link" && canManageBillingInPortal(summary.status);
  const trialReminderWindowDays = useMemo(
    () => getTrialReminderWindowDays(summary.status, summary.trialEndsAt),
    [summary.status, summary.trialEndsAt],
  );
  const trialEndDate = useMemo(() => {
    if (!summary.trialEndsAt) return null;
    const date = new Date(summary.trialEndsAt);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toLocaleDateString(i18n.resolvedLanguage ?? i18n.language);
  }, [i18n.language, i18n.resolvedLanguage, summary.trialEndsAt]);
  const disclosureTrialEndDate = useMemo(
    () => new Date(Date.now() + 30 * 86400000).toLocaleDateString(i18n.resolvedLanguage ?? i18n.language),
    [i18n.language, i18n.resolvedLanguage],
  );

  useEffect(() => {
    if (!PAID_BILLING_ENABLED) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (!PAID_BILLING_ENABLED) return;
    if (reason === "reactivate") {
      setBanner({ message: t("billing.locationSuspended"), tone: "warning" });
    }
  }, [reason, t]);

  useEffect(() => {
    if (!PAID_BILLING_ENABLED) return;
    if (checkout === "cancel") {
      setBanner({ message: t("billing.checkoutCanceled"), tone: "info" });
      void expirePendingCheckout();
      return;
    }
    if (checkout !== "success") return;
    setBanner({ message: t("billing.confirmingSubscription"), tone: "info" });
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (cancelled) return;
        await refresh();
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      if (!cancelled) {
        setBanner({ message: t("billing.checkoutSyncDelayed"), tone: "warning" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkout, expirePendingCheckout, refresh, t]);

  const startTrialCheckout = useCallback(async () => {
    if (!locationId || busy) return;
    if (summary.purchaseSurface !== "in_app_link") {
      setBanner({ message: t("billing.purchaseUnavailable"), tone: "info" });
      return;
    }
    if (!trialAcknowledged) {
      setBanner({ message: t("billing.trialConsentRequired"), tone: "warning" });
      return;
    }
    setBusy(true);
    setBanner({ message: t("billing.checkoutLaunching"), tone: "info" });
    try {
      const { data, error } = await supabase.functions.invoke("stripe-create-checkout-session", {
        body: {
          location_id: locationId,
          locale: stripeCheckoutLocale(i18n.resolvedLanguage ?? i18n.language),
          trial_acknowledged: true,
        },
        timeout: EDGE_FUNCTION_TIMEOUT_MS,
      });
      if (error) throw error;
      const url = data?.checkout_url as string | undefined;
      if (!url) throw new Error("Missing checkout URL.");
      await openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
    } catch {
      setBanner({ message: t("billing.errSubscribe"), tone: "error" });
    } finally {
      setBusy(false);
    }
  }, [busy, i18n.language, i18n.resolvedLanguage, locationId, summary.purchaseSurface, t, trialAcknowledged]);

  if (!PAID_BILLING_ENABLED) {
    return <Redirect href="/(tabs)/account" />;
  }

  const loading = bizLoading || locationsLoading || summaryLoading;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: top, paddingHorizontal: horizontal, paddingBottom: scrollBottom }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ fontSize: 28, fontWeight: "900", color: Colors.light.text }}>
          {t("tabs.billing")}
        </Text>

        {loading ? (
          <View style={{ paddingTop: 24 }}>
            <ActivityIndicator color={Colors.light.primary} />
          </View>
        ) : (
          <>
            {locationsError ? <Banner message={locationsError} tone="error" /> : null}
            {summaryError ? <Banner message={t("billing.purchaseUnavailable")} tone="info" /> : null}
            {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}
            {trialReminderWindowDays && trialEndDate ? (
              <Banner
                message={t("billing.trialAutoBillingReminder", { date: trialEndDate })}
                tone="warning"
              />
            ) : null}

            <View
              style={{
                marginTop: 16,
                backgroundColor: Colors.light.surface,
                borderRadius: Radii.lg,
                borderWidth: 1,
                borderColor: Colors.light.border,
                padding: 16,
              }}
            >
              <Text style={{ fontSize: 22, fontWeight: "900", color: Colors.light.text }}>
                {t("billing.planName")}
              </Text>
              <Text style={{ marginTop: 6, fontSize: 28, fontWeight: "900", color: Colors.light.primary }}>
                {t("billing.monthlyPrice")}
              </Text>
              <Text style={{ marginTop: 4, fontSize: 14, fontWeight: "700", color: Colors.light.mutedText }}>
                {t("billing.perLocation")} • {t("billing.plusTaxes")}
              </Text>

              <View style={{ marginTop: 14, gap: 10 }}>
                {[
                  t("billing.paidCredits", { count: summary.configuredPaidAllowance }),
                  t("billing.trialCredits", { count: summary.configuredTrialAllowance }),
                  t("billing.noRollover"),
                  t("billing.additionalImageRevisionCredit"),
                ].map((text) => (
                  <View key={text} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                    <MaterialIcons name="check-circle" size={18} color={Colors.light.primary} />
                    <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: Colors.light.text, opacity: 0.78, fontWeight: "700" }}>
                      {text}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            <View
              style={{
                marginTop: 16,
                backgroundColor: Colors.light.surface,
                borderRadius: Radii.lg,
                borderWidth: 1,
                borderColor: Colors.light.border,
                padding: 16,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "900", color: Colors.light.text }}>
                {t("billing.currentStatus")}
              </Text>
              <Text style={{ marginTop: 6, fontSize: 18, fontWeight: "900", color: isSuspended ? Colors.light.danger : Colors.light.primary }}>
                {statusLabel}
              </Text>
              {remainingTime ? (
                <Text style={{ marginTop: 8, fontSize: 14, lineHeight: 20, fontWeight: "700", color: Colors.light.text }}>
                  {remainingTime}
                </Text>
              ) : null}
              <View style={{ marginTop: 12, borderRadius: Radii.md, backgroundColor: PrimaryTint.surface, padding: 12 }}>
                <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: "800", color: Colors.light.accentText }}>
                  {t("billing.creditsRemaining", {
                    remaining: summary.creditsRemaining,
                    granted: summary.creditsGranted,
                  })}
                </Text>
              </View>
              {isSuspended ? (
                <Text style={{ marginTop: 10, fontSize: 13, lineHeight: 19, color: Colors.light.mutedText, fontWeight: "700" }}>
                  {t("billing.claimsRemainRedeemable")}
                </Text>
              ) : null}
            </View>

            <View style={{ marginTop: 16, gap: 10 }}>
              {canStartTrial ? (
                <View
                  style={{
                    borderRadius: Radii.lg,
                    borderWidth: 1,
                    borderColor: Colors.light.border,
                    backgroundColor: Colors.light.surface,
                    padding: 14,
                    gap: 12,
                  }}
                >
                  <Text style={{ fontSize: 16, lineHeight: 22, fontWeight: "900", color: Colors.light.text }}>
                    {t("billing.trialDisclosureTitle")}
                  </Text>
                  <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: "700", color: Colors.light.mutedText }}>
                    {t("billing.trialDisclosureBody", { date: disclosureTrialEndDate })}
                  </Text>
                  <Pressable
                    onPress={() => setTrialAcknowledged((value) => !value)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: trialAcknowledged }}
                    style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}
                  >
                    <MaterialIcons
                      name={trialAcknowledged ? "check-box" : "check-box-outline-blank"}
                      size={24}
                      color={trialAcknowledged ? Colors.light.primary : Colors.light.mutedText}
                    />
                    <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "800", color: Colors.light.text }}>
                      {t("billing.trialConsentLabel", { date: disclosureTrialEndDate })}
                    </Text>
                  </Pressable>
                  <PrimaryButton
                    title={t("billing.startTrial")}
                    onPress={() => void startTrialCheckout()}
                    disabled={busy || !locationId || !trialAcknowledged}
                  />
                </View>
              ) : null}

              {summary.purchaseSurface === "disabled" ? (
                <Banner message={t("billing.purchaseUnavailable")} tone="info" />
              ) : null}

              {summary.purchaseSurface === "web_only" ? (
                <Banner message={t("billing.webOnlyStatus")} tone="info" />
              ) : null}

              {showPortal ? (
                <SecondaryButton
                  title={t("billing.manageSubscription")}
                  onPress={() => router.push("/(tabs)/billing/manage")}
                  disabled={busy}
                  accessibilityLabel={t("billing.a11yManageSubscriptionLabel")}
                  accessibilityHint={t("billing.a11yManageSubscriptionHint")}
                />
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
