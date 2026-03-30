import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { MaterialIcons } from "@expo/vector-icons";
import { openBrowserAsync, WebBrowserPresentationStyle } from "expo-web-browser";

import { useBusiness } from "@/hooks/use-business";
import { supabase } from "@/lib/supabase";
import { Colors, Spacing } from "@/constants/theme";
import { Banner } from "@/components/ui/banner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { EDGE_FUNCTION_TIMEOUT_MS } from "@/lib/functions";
import { loadSubscriptionPricingFromAppConfig, type SubscriptionPricing } from "@/lib/billing/subscription-pricing";
import { devLog } from "@/lib/dev-log";

function daysBetween(nowMs: number, targetIso: string | null): number | null {
  if (!targetIso) return null;
  const ms = new Date(targetIso).getTime();
  if (!Number.isFinite(ms)) return null;
  const rawDays = (ms - nowMs) / 86400000; // ms/day
  return Math.max(0, Math.ceil(rawDays));
}

export default function BusinessBillingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { checkout, reason } = useLocalSearchParams<{ checkout?: string; reason?: string }>();
  const {
    userId,
    subscriptionStatus,
    trialEndsAt,
    subscriptionTier,
    loading: bizLoading,
    refresh,
  } = useBusiness();

  const nowMs = Date.now();
  const trialDaysRemaining = useMemo(() => daysBetween(nowMs, trialEndsAt), [nowMs, trialEndsAt]);

  const [pricing, setPricing] = useState<SubscriptionPricing | null>(null);
  const [pricingLoading, setPricingLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncingCheckout, setSyncingCheckout] = useState(false);
  const [lastSyncMessage, setLastSyncMessage] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" | "warning" } | null>(null);

  const trialExpired = useMemo(() => {
    if (!trialEndsAt) return false;
    const ms = new Date(trialEndsAt).getTime();
    if (!Number.isFinite(ms)) return false;
    return Date.now() > ms;
  }, [trialEndsAt]);

  const warningExpiredOrPastDue = useMemo(() => {
    if (subscriptionStatus === "active") return false;
    if (subscriptionStatus === "trial") return trialExpired;
    return subscriptionStatus === "past_due" || subscriptionStatus === "canceled";
  }, [subscriptionStatus, trialExpired]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPricingLoading(true);
      setPricing(null);
      try {
        const data = await loadSubscriptionPricingFromAppConfig(supabase);
        if (cancelled) return;
        setPricing(data);
      } catch {
        if (cancelled) return;
        setBanner({
          message: t("billing.errLoadPricing", { defaultValue: "Unable to load subscription pricing. Please try again." }),
          tone: "error",
        });
      } finally {
        if (!cancelled) setPricingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void refresh();
      }
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (!checkout) return;
    if (checkout === "cancel") {
      setBanner({
        message: t("billing.checkoutCanceled", { defaultValue: "Subscription purchase canceled." }),
        tone: "info",
      });
      return;
    }
    if (checkout !== "success") return;

    let cancelled = false;
    void (async () => {
      if (!userId) return;
      setSyncingCheckout(true);
      setLastSyncMessage(null);
      setBanner({
        message: t("billing.checkoutSyncing", { defaultValue: "Payment completed — syncing your subscription..." }),
        tone: "info",
      });
      if (__DEV__) devLog("[billing] checkout=success, starting sync refresh loop");

      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (cancelled) return;
        await refresh();
        const { data: profile } = await supabase
          .from("business_profiles")
          .select("subscription_status")
          .or(`user_id.eq.${userId},owner_id.eq.${userId}`)
          .maybeSingle();
        const latest = String(profile?.subscription_status ?? "");
        if (__DEV__) devLog("[billing] sync attempt", attempt + 1, "status=", latest);
        if (latest === "active") {
          setSyncingCheckout(false);
          setBanner({
            message: t("billing.checkoutSuccess", { defaultValue: "Payment successful. Your subscription is active." }),
            tone: "success",
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }

      if (!cancelled) {
        setSyncingCheckout(false);
        setLastSyncMessage(
          t("billing.checkoutSyncDelayed", {
            defaultValue:
              "Payment completed — subscription update may take a moment. Pull to refresh if status does not update.",
          }),
        );
        setBanner({
          message: t("billing.checkoutSyncDelayed", {
            defaultValue:
              "Payment completed — subscription update may take a moment. Pull to refresh if status does not update.",
          }),
          tone: "warning",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [checkout, refresh, t, userId]);

  useEffect(() => {
    if (reason === "reactivate") {
      setBanner({
        message: t("billing.paywallExpiredMessage", {
          defaultValue: "Your trial has ended. Reactivate your account to continue creating deals.",
        }),
        tone: "warning",
      });
    }
  }, [reason, t]);

  const proPrice = pricing?.proMonthlyPrice;
  const premiumPrice = pricing?.premiumMonthlyPrice;

  const subscribe = async (tier: "pro" | "premium") => {
    if (busy) return;
    setBusy(true);
    setBanner(null);
    try {
      setBanner({
        message: t("billing.checkoutLaunching", { defaultValue: "Opening secure checkout..." }),
        tone: "info",
      });
      const { data, error } = await supabase.functions.invoke("stripe-create-checkout-session", {
        body: { tier },
        timeout: EDGE_FUNCTION_TIMEOUT_MS,
      });
      if (error) throw error;
      const url = data?.checkout_url as string | undefined;
      if (!url) throw new Error("Missing checkout_url from checkout session function.");
      await openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("billing.errSubscribe", { defaultValue: "Unable to start checkout. Please try again." });
      setBanner({
        message,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const simulateVisible = __DEV__;

  const simulateSubscribe = async () => {
    if (busy) return;
    setBusy(true);
    setBanner(null);
    try {
      const { error } = await supabase.functions.invoke("simulate-subscribe", {
        body: {},
        timeout: EDGE_FUNCTION_TIMEOUT_MS,
      });
      if (error) throw error;
      await refresh();
      setBanner({
        message: t("billing.simulateSubscribeOk", { defaultValue: "Subscription simulated successfully." }),
        tone: "success",
      });
    } catch {
      setBanner({
        message: t("billing.errSimulateSubscribe", { defaultValue: "Unable to simulate subscription." }),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const trialLine = useMemo(() => {
    if (trialDaysRemaining === null) {
      return t("billing.trialEndsIn", { days: 0, defaultValue: "Your 30-day trial ends in {{days}} days" });
    }
    return t("billing.trialEndsIn", {
      days: trialDaysRemaining,
      defaultValue: "Your 30-day trial ends in {{days}} days",
    });
  }, [t, trialDaysRemaining]);

  const cardShadow = {
    backgroundColor: Colors.light.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
    boxShadow: "0px 6px 18px rgba(0,0,0,0.10)",
    elevation: 6,
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 40 }}>
        {bizLoading || pricingLoading ? (
          <View style={{ paddingTop: 24 }}>
            <ActivityIndicator color={Colors.light.primary} />
          </View>
        ) : !pricing ? (
          <View style={{ paddingTop: 24 }}>
            {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}
          </View>
        ) : (
          <>
            <Text style={{ fontSize: 28, fontWeight: "900", letterSpacing: -0.6, color: Colors.light.text, marginTop: 6 }}>
              {t("tabs.billing", { defaultValue: "Billing" })}
            </Text>

            <Text style={{ marginTop: 12, fontSize: 15, opacity: 0.72, fontWeight: "700", lineHeight: 22 }}>
              {trialLine}
            </Text>

            {syncingCheckout ? (
              <Text style={{ marginTop: 8, color: Colors.light.primary, fontWeight: "800", fontSize: 13 }}>
                {t("billing.syncingStatus", { defaultValue: "Syncing payment status..." })}
              </Text>
            ) : null}

            {warningExpiredOrPastDue ? (
              <Banner
                tone="warning"
                message={t("billing.trialExpiredBanner", { defaultValue: "Reactivate your account" })}
              />
            ) : null}

            {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}
            {lastSyncMessage ? <Banner message={lastSyncMessage} tone="warning" /> : null}

            <View style={{ marginTop: 16, gap: 16 }}>
              <View style={[cardShadow, { padding: 16 }]}>
                <Text style={{ fontSize: 20, fontWeight: "900", color: Colors.light.text }}>Twofer Pro</Text>
                <Text style={{ marginTop: 6, fontSize: 28, fontWeight: "900", color: Colors.light.primary }}>
                  ${proPrice}/mo
                </Text>
                <View style={{ marginTop: 10, gap: 8 }}>
                  {[
                    "Unlimited active deals",
                    "Location limit: 1",
                    "Basic AI deal features",
                    "Analytics & essentials",
                  ].map((feat) => (
                    <View key={feat} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <MaterialIcons name="check-circle" size={18} color={Colors.light.primary} />
                      <Text style={{ fontSize: 14, opacity: 0.78, fontWeight: "700" }}>{feat}</Text>
                    </View>
                  ))}
                </View>
                <View style={{ marginTop: 14 }}>
                  <PrimaryButton
                    title={t("billing.subscribeNow", { defaultValue: "Subscribe Now" })}
                    disabled={busy || subscriptionStatus === "active" && subscriptionTier === "pro"}
                    onPress={() => void subscribe("pro")}
                    style={{ backgroundColor: "#FF9F1C", borderRadius: 22, height: 62, minHeight: 62 }}
                  />
                </View>
              </View>

              <View style={[cardShadow, { padding: 16, borderColor: subscriptionTier === "premium" ? Colors.light.primary : Colors.light.border }]}>
                <Text style={{ fontSize: 20, fontWeight: "900", color: Colors.light.text }}>Twofer Premium</Text>
                <Text style={{ marginTop: 6, fontSize: 28, fontWeight: "900", color: Colors.light.primary }}>
                  ${premiumPrice}/mo
                </Text>
                <View style={{ marginTop: 10, gap: 8 }}>
                  {[
                    "Unlimited active deals",
                    "Location limit: up to 3",
                    "Advanced AI deal features",
                    "Full analytics + expanded tools",
                  ].map((feat) => (
                    <View key={feat} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <MaterialIcons name="check-circle" size={18} color={Colors.light.primary} />
                      <Text style={{ fontSize: 14, opacity: 0.78, fontWeight: "700" }}>{feat}</Text>
                    </View>
                  ))}
                </View>
                <View style={{ marginTop: 14 }}>
                  <PrimaryButton
                    title={t("billing.subscribeNow", { defaultValue: "Subscribe Now" })}
                    disabled={busy || subscriptionStatus === "active" && subscriptionTier === "premium"}
                    onPress={() => void subscribe("premium")}
                    style={{ backgroundColor: "#FF9F1C", borderRadius: 22, height: 62, minHeight: 62 }}
                  />
                </View>
              </View>
            </View>

            <View style={{ marginTop: 16, gap: 12 }}>
              <SecondaryButton
                title={t("billing.manageSubscription", { defaultValue: "Manage Subscription" })}
                onPress={() => router.push("/(tabs)/billing/manage")}
                disabled={busy}
              />
            </View>

            {simulateVisible ? (
              <View
                style={{
                  marginTop: 18,
                  padding: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "rgba(255,159,28,0.4)",
                  backgroundColor: "rgba(255,159,28,0.08)",
                }}
              >
                <Text style={{ fontWeight: "800", color: Colors.light.text, marginBottom: 8 }}>
                  DEV: Billing tools
                </Text>
                <Text style={{ opacity: 0.72, marginBottom: 10 }}>
                  Current status: {subscriptionStatus} ({subscriptionTier})
                </Text>
                <SecondaryButton
                  title={t("billing.simulateSubscribe", { defaultValue: "Simulate Subscribe" })}
                  onPress={() => void simulateSubscribe()}
                  disabled={busy}
                />
              </View>
            ) : null}

            {/* Hidden dev-only button is implemented by gating on env flag; it only renders when enabled. */}
          </>
        )}
      </ScrollView>
    </View>
  );
}

