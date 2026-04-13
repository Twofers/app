import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { MaterialIcons } from "@expo/vector-icons";
import { openBrowserAsync, WebBrowserPresentationStyle } from "expo-web-browser";

import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

import { useBusiness } from "@/hooks/use-business";
import { supabase } from "@/lib/supabase";
import { Colors, Spacing } from "@/constants/theme";
import { Banner } from "@/components/ui/banner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { EDGE_FUNCTION_TIMEOUT_MS, parseFunctionError } from "@/lib/functions";
import type { SubscriptionPricing } from "@/lib/billing/subscription-pricing";
import { devError, devLog } from "@/lib/dev-log";
import { isTrialExpired } from "@/lib/billing/access";

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
  const [retryKey, setRetryKey] = useState(0);

  const trialExpired = useMemo(() => {
    return isTrialExpired(trialEndsAt);
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
      const fnName = "billing-pricing";
      const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
      const fnUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}/functions/v1/${fnName}` : "(unset EXPO_PUBLIC_SUPABASE_URL)";
      try {
        if (__DEV__) {
          devLog("[billing-pricing] invoke start", {
            fnUrl,
            hasExpoPublicSupabaseUrl: Boolean(baseUrl),
            hasExpoPublicSupabaseAnonKey: Boolean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim()),
          });
        }

        const { data, error } = await supabase.functions.invoke(fnName, {
          body: {},
          timeout: EDGE_FUNCTION_TIMEOUT_MS,
        });

        if (__DEV__) {
          if (error instanceof FunctionsHttpError) {
            const res = error.context as Response;
            let bodyText = "";
            try {
              bodyText = await res.clone().text();
            } catch (e) {
              bodyText = `(could not read body: ${e instanceof Error ? e.message : String(e)})`;
            }
            devLog("[billing-pricing] non-2xx from edge function", {
              status: res.status,
              statusText: res.statusText,
              url: res.url,
              body: bodyText,
            });
          } else if (error instanceof FunctionsFetchError) {
            devLog("[billing-pricing] fetch error context", error.context);
          } else if (error) {
            devLog("[billing-pricing] invoke error", {
              name: error.name,
              message: error.message,
              context: (error as { context?: unknown }).context,
            });
          }
          if (data != null) {
            devLog("[billing-pricing] response data", typeof data === "object" ? JSON.stringify(data) : String(data));
          }
        }

        if (error) throw error;
        if (data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string") {
          throw new Error((data as { error: string }).error);
        }
        if (!data) throw new Error("Missing pricing payload.");
        if (cancelled) return;
        setPricing({
          proMonthlyPrice: Number(data.proMonthlyPrice),
          premiumMonthlyPrice: Number(data.premiumMonthlyPrice),
          extraLocationPrice: Number(data.extraLocationPrice),
        });
      } catch (e) {
        if (__DEV__) {
          devError("[billing-pricing] caught error:", e);
          devError("[billing-pricing] parseFunctionError:", parseFunctionError(e));
        }
        if (cancelled) return;
        // Show fallback pricing so the screen is still usable, with an error banner.
        // In dev mode the banner is suppressed for convenience.
        setPricing({
          proMonthlyPrice: 30,
          premiumMonthlyPrice: 79,
          extraLocationPrice: 15,
        });
        if (!__DEV__) {
          setBanner({
            message: t("billing.errLoadPricing"),
            tone: "error",
          });
        }
      } finally {
        if (!cancelled) setPricingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t, retryKey]);

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
        message: t("billing.checkoutCanceled"),
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
        message: t("billing.checkoutSyncing"),
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
            message: t("billing.checkoutSuccess"),
            tone: "success",
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }

      if (!cancelled) {
        setSyncingCheckout(false);
        setLastSyncMessage(
          t("billing.checkoutSyncDelayed"),
        );
        setBanner({
          message: t("billing.checkoutSyncDelayed"),
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
        message: t("billing.paywallExpiredMessage"),
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
        message: t("billing.checkoutLaunching"),
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
      const detail = err instanceof Error ? err.message : parseFunctionError(err);
      setBanner({
        message: detail || t("billing.errSubscribe"),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  /** Show simulate buttons only in dev builds. */
  const simulateVisible = __DEV__;

  const resetTrial = async () => {
    if (busy) return;
    setBusy(true);
    setBanner(null);
    try {
      const trialEnd = new Date(Date.now() + 30 * 86400000).toISOString();
      const { error } = await supabase
        .from("business_profiles")
        .update({
          subscription_status: "trial",
          subscription_tier: "pro",
          trial_ends_at: trialEnd,
          current_period_ends_at: trialEnd,
        })
        .or(`user_id.eq.${userId},owner_id.eq.${userId}`);
      if (error) throw error;
      await refresh();
      setBanner({ message: "Trial reset to 30 days.", tone: "success" });
    } catch {
      setBanner({ message: "Unable to reset trial. Run npm run seed:demo with SUPABASE_SERVICE_ROLE_KEY.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

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
        message: t("billing.simulateSubscribeOk"),
        tone: "success",
      });
    } catch {
      setBanner({
        message: t("billing.errSimulateSubscribe"),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const trialLine = useMemo(() => {
    if (trialDaysRemaining === null) return null;
    if (trialDaysRemaining === 0) {
      return t("billing.trialExpired");
    }
    return t("billing.trialEndsIn", { days: trialDaysRemaining });
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
        <Text style={{ fontSize: 28, fontWeight: "900", letterSpacing: -0.6, color: Colors.light.text, marginTop: 6 }}>
          {t("tabs.billing")}
        </Text>

        {bizLoading || pricingLoading ? (
          <View style={{ paddingTop: 24 }}>
            <ActivityIndicator color={Colors.light.primary} />
          </View>
        ) : !pricing ? (
          <View style={{ paddingTop: 16 }}>
            {banner ? <Banner message={banner.message} tone={banner.tone} onRetry={banner.tone === "error" ? () => { setBanner(null); setRetryKey((k) => k + 1); } : undefined} /> : null}
            <Text style={{ marginTop: 12, fontSize: 15, opacity: 0.72, fontWeight: "700" }}>
              {t("billing.currentStatus")}: {subscriptionStatus} ({subscriptionTier})
            </Text>
            <View style={{ marginTop: 16 }}>
              <PrimaryButton
                title={t("billing.retryLoadPricing")}
                onPress={() => { setBanner(null); setRetryKey((k) => k + 1); }}
                style={{ backgroundColor: "#FF9F1C", borderRadius: 22, height: 62, minHeight: 62 }}
              />
            </View>
          </View>
        ) : (
          <>
            {trialLine ? (
              <Text style={{ marginTop: 12, fontSize: 15, opacity: 0.72, fontWeight: "700", lineHeight: 22 }}>
                {trialLine}
              </Text>
            ) : null}

            {syncingCheckout ? (
              <Text style={{ marginTop: 8, color: Colors.light.primary, fontWeight: "800", fontSize: 13 }}>
                {t("billing.syncingStatus")}
              </Text>
            ) : null}

            {warningExpiredOrPastDue ? (
              <Banner
                tone="warning"
                message={t("billing.trialExpiredBanner")}
              />
            ) : null}

            {banner ? <Banner message={banner.message} tone={banner.tone} onRetry={banner.tone === "error" ? () => { setBanner(null); setRetryKey((k) => k + 1); } : undefined} /> : null}
            {lastSyncMessage ? <Banner message={lastSyncMessage} tone="warning" /> : null}

            <View style={{ marginTop: 16, gap: 16 }}>
              <View style={[cardShadow, { padding: 16 }]}>
                <Text style={{ fontSize: 20, fontWeight: "900", color: Colors.light.text }}>Twofer Pro</Text>
                <Text style={{ marginTop: 6, fontSize: 28, fontWeight: "900", color: Colors.light.primary }}>
                  ${proPrice}/mo
                </Text>
                <View style={{ marginTop: 10, gap: 8 }}>
                  {[
                    t("billing.proFeatureUnlimitedDeals"),
                    t("billing.proFeatureLocationLimit"),
                    t("billing.proFeatureBasicAi"),
                    t("billing.proFeatureAnalytics"),
                  ].map((feat) => (
                    <View key={feat} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <MaterialIcons name="check-circle" size={18} color={Colors.light.primary} />
                      <Text style={{ fontSize: 14, opacity: 0.78, fontWeight: "700" }}>{feat}</Text>
                    </View>
                  ))}
                </View>
                <View style={{ marginTop: 14 }}>
                  {subscriptionStatus === "active" && subscriptionTier === "pro" ? (
                    <View style={{ height: 62, borderRadius: 22, backgroundColor: "#e8f5e9", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontWeight: "800", fontSize: 16, color: "#2e7d32" }}>
                        {t("billing.currentPlan")}
                      </Text>
                    </View>
                  ) : (
                    <PrimaryButton
                      title={t("billing.subscribeNow")}
                      disabled={busy}
                      onPress={() => void subscribe("pro")}
                      accessibilityLabel={t("billing.a11ySubscribeProLabel")}
                      accessibilityHint={t("billing.a11ySubscribeProHint")}
                      style={{ backgroundColor: "#FF9F1C", borderRadius: 22, height: 62, minHeight: 62 }}
                    />
                  )}
                </View>
              </View>

              <View style={[cardShadow, { padding: 16, borderColor: subscriptionTier === "premium" ? Colors.light.primary : Colors.light.border }]}>
                <Text style={{ fontSize: 20, fontWeight: "900", color: Colors.light.text }}>Twofer Premium</Text>
                <Text style={{ marginTop: 6, fontSize: 28, fontWeight: "900", color: Colors.light.primary }}>
                  ${premiumPrice}/mo
                </Text>
                <View style={{ marginTop: 10, gap: 8 }}>
                  {[
                    t("billing.premiumFeatureUnlimitedDeals"),
                    t("billing.premiumFeatureLocationLimit"),
                    t("billing.premiumFeatureAdvancedAi"),
                    t("billing.premiumFeatureAnalytics"),
                  ].map((feat) => (
                    <View key={feat} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <MaterialIcons name="check-circle" size={18} color={Colors.light.primary} />
                      <Text style={{ fontSize: 14, opacity: 0.78, fontWeight: "700" }}>{feat}</Text>
                    </View>
                  ))}
                </View>
                <View style={{ marginTop: 14 }}>
                  {subscriptionStatus === "active" && subscriptionTier === "premium" ? (
                    <View style={{ height: 62, borderRadius: 22, backgroundColor: "#e8f5e9", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontWeight: "800", fontSize: 16, color: "#2e7d32" }}>
                        {t("billing.currentPlan")}
                      </Text>
                    </View>
                  ) : (
                    <PrimaryButton
                      title={t("billing.subscribeNow")}
                      disabled={busy}
                      onPress={() => void subscribe("premium")}
                      accessibilityLabel={t("billing.a11ySubscribePremiumLabel")}
                      accessibilityHint={t("billing.a11ySubscribePremiumHint")}
                      style={{ backgroundColor: "#FF9F1C", borderRadius: 22, height: 62, minHeight: 62 }}
                    />
                  )}
                </View>
              </View>
            </View>

            <View style={{ marginTop: 16, gap: 12 }}>
              <SecondaryButton
                title={t("billing.manageSubscription")}
                onPress={() => router.push("/(tabs)/billing/manage")}
                disabled={busy}
                accessibilityLabel={t("billing.a11yManageSubscriptionLabel")}
                accessibilityHint={t("billing.a11yManageSubscriptionHint")}
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
                <View style={{ gap: 8 }}>
                  <SecondaryButton
                    title={t("billing.simulateSubscribe")}
                    onPress={() => void simulateSubscribe()}
                    disabled={busy}
                  />
                  <SecondaryButton
                    title="Reset Trial (30 days)"
                    onPress={() => void resetTrial()}
                    disabled={busy}
                  />
                </View>
              </View>
            ) : null}

            {/* Hidden dev-only button is implemented by gating on env flag; it only renders when enabled. */}
          </>
        )}
      </ScrollView>
    </View>
  );
}

