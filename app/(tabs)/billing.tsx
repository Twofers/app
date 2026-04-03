import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { Colors, Radii } from "../../constants/theme";
import { useBusiness } from "../../hooks/use-business";
import { supabase } from "../../lib/supabase";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";

type Subscription = {
  plan_tier: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
};

export default function BillingScreen() {
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const { t } = useTranslation();
  const { isLoggedIn, businessId, loading } = useBusiness();

  const [sub, setSub] = useState<Subscription | null>(null);
  const [subLoading, setSubLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [banner, setBanner] = useState<{
    message: string;
    tone: "error" | "success" | "info";
  } | null>(null);

  const loadSubscription = useCallback(async () => {
    if (!businessId) return;
    setSubLoading(true);
    try {
      const { data, error } = await supabase
        .from("billing_subscriptions")
        .select("plan_tier, status, trial_ends_at, current_period_end, canceled_at")
        .eq("business_id", businessId)
        .maybeSingle();
      if (error) throw error;
      setSub(data);
    } catch {
      setBanner({ message: t("billing.errLoad"), tone: "error" });
    } finally {
      setSubLoading(false);
    }
  }, [businessId, t]);

  useFocusEffect(
    useCallback(() => {
      void loadSubscription();
    }, [loadSubscription]),
  );

  async function startCheckout() {
    setActionLoading(true);
    setBanner(null);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout-session", {
        body: {},
      });
      if (error) throw error;
      if (data?.url) {
        await Linking.openURL(data.url);
      } else {
        setBanner({ message: t("billing.errCheckout"), tone: "error" });
      }
    } catch (err: any) {
      setBanner({ message: err?.message ?? t("billing.errCheckout"), tone: "error" });
    } finally {
      setActionLoading(false);
    }
  }

  async function openPortal() {
    setActionLoading(true);
    setBanner(null);
    try {
      const { data, error } = await supabase.functions.invoke("manage-subscription", {
        body: { action: "portal" },
      });
      if (error) throw error;
      if (data?.url) {
        await Linking.openURL(data.url);
      }
    } catch (err: any) {
      setBanner({ message: err?.message ?? t("billing.errPortal"), tone: "error" });
    } finally {
      setActionLoading(false);
    }
  }

  function trialDaysRemaining(): number {
    if (!sub?.trial_ends_at) return 0;
    const diff = new Date(sub.trial_ends_at).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  function formatDate(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString();
  }

  if (!isLoggedIn || loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>
        {t("billing.title")}
      </Text>
      <Text style={{ marginTop: 6, opacity: 0.7, lineHeight: 20 }}>
        {t("billing.subtitle")}
      </Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {subLoading ? (
        <View style={{ marginTop: Spacing.xl }}>
          <ActivityIndicator />
        </View>
      ) : !sub ? (
        <View style={{ marginTop: Spacing.xl }}>
          <Text style={{ opacity: 0.6 }}>{t("billing.noSubscription")}</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1, marginTop: Spacing.lg }}
          contentContainerStyle={{ gap: Spacing.lg, paddingBottom: scrollBottom }}
          showsVerticalScrollIndicator={false}
        >
          {/* Current Plan Card */}
          <View
            style={{
              borderRadius: Radii.card,
              padding: Spacing.xl,
              backgroundColor:
                sub.plan_tier === "pro" ? Colors.light.primary : "#1e3a5f",
              gap: Spacing.sm,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: "800",
                color: "rgba(255,255,255,0.7)",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {t("billing.currentPlan")}
            </Text>
            <Text style={{ fontSize: 32, fontWeight: "800", color: "#fff" }}>
              {sub.plan_tier === "pro"
                ? t("billing.proPlan")
                : t("billing.trialPlan")}
            </Text>

            {sub.plan_tier === "trial" && sub.status === "trialing" ? (
              <>
                <Text style={{ fontSize: 18, color: "rgba(255,255,255,0.9)", fontWeight: "600" }}>
                  {t("billing.trialDaysLeft", { days: trialDaysRemaining() })}
                </Text>
                <Text style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
                  {t("billing.trialEnds", { date: formatDate(sub.trial_ends_at) })}
                </Text>
              </>
            ) : null}

            {sub.plan_tier === "pro" && sub.status === "active" ? (
              <Text style={{ fontSize: 14, color: "rgba(255,255,255,0.8)" }}>
                {t("billing.nextBilling", { date: formatDate(sub.current_period_end) })}
              </Text>
            ) : null}

            {sub.status === "canceled" ? (
              <Text style={{ fontSize: 14, color: "#ffa0a0", fontWeight: "600" }}>
                {t("billing.canceled")}
              </Text>
            ) : null}

            {sub.status === "past_due" ? (
              <Text style={{ fontSize: 14, color: "#ffa0a0", fontWeight: "600" }}>
                {t("billing.pastDue")}
              </Text>
            ) : null}
          </View>

          {/* Pricing Info */}
          <View
            style={{
              borderRadius: Radii.lg,
              padding: Spacing.lg,
              backgroundColor: Colors.light.surfaceMuted,
              gap: Spacing.sm,
            }}
          >
            <Text style={{ fontWeight: "700", fontSize: 18 }}>
              {t("billing.proPrice")}
            </Text>
            <Text style={{ opacity: 0.7, lineHeight: 20 }}>
              {t("billing.proFeatures")}
            </Text>
          </View>

          {/* Actions */}
          {sub.plan_tier === "trial" || sub.status === "canceled" ? (
            <PrimaryButton
              title={
                actionLoading
                  ? t("billing.processing")
                  : t("billing.upgradeToPro")
              }
              onPress={startCheckout}
              disabled={actionLoading}
              style={{ height: 66, borderRadius: 20 }}
            />
          ) : null}

          {sub.plan_tier === "pro" && sub.status === "active" ? (
            <SecondaryButton
              title={
                actionLoading
                  ? t("billing.processing")
                  : t("billing.manageSubscription")
              }
              onPress={openPortal}
              disabled={actionLoading}
            />
          ) : null}

          {sub.status === "past_due" ? (
            <PrimaryButton
              title={
                actionLoading
                  ? t("billing.processing")
                  : t("billing.updatePayment")
              }
              onPress={openPortal}
              disabled={actionLoading}
              style={{ height: 66, borderRadius: 20 }}
            />
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
