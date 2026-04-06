import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { CardShell } from "@/components/ui/card-shell";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { useBusiness } from "../../hooks/use-business";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { Banner } from "../../components/ui/banner";
import { Image } from "expo-image";
import { resolveDealPosterDisplayUri } from "../../lib/deal-poster-url";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { getBusinessProfileAccessForCurrentUser } from "@/lib/business-profile-access";
import { canCreateDeal, isBillingBypassEnabled } from "@/lib/billing/access";


export default function CreateDeal() {
  const { t } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const router = useRouter();
  const params = useLocalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const { isLoggedIn, businessId, loading, subscriptionStatus, trialEndsAt } = useBusiness();
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" } | null>(null);
  const [templates, setTemplates] = useState<{ id: string; title: string | null; description: string | null; poster_url: string | null; price: number | null }[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [profileCheckLoading, setProfileCheckLoading] = useState(false);
  const [hasBusinessProfileAccess, setHasBusinessProfileAccess] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  const bypass = isBillingBypassEnabled(params.skipSetup, params.e2e);
  const blockedSubscription = !canCreateDeal({
    isLoggedIn,
    subscriptionStatus,
    trialEndsAt,
    bypass,
  });

  useEffect(() => {
    if (!isLoggedIn || bypass) {
      setHasBusinessProfileAccess(bypass);
      setProfileCheckLoading(false);
      return;
    }
    let cancelled = false;
    setProfileCheckLoading(true);
    void getBusinessProfileAccessForCurrentUser()
      .then((access) => {
        if (cancelled) return;
        setHasBusinessProfileAccess(access.isComplete);
      })
      .finally(() => {
        if (!cancelled) setProfileCheckLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, params.skipSetup, params.e2e, bypass]);

  useEffect(() => {
    if (!businessId) return;
    (async () => {
      setTemplatesLoading(true);
      const { data, error } = await supabase
        .from("deal_templates")
        .select("id,title,description,poster_url,price")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) {
        setBanner({ message: t("createHub.templatesLoadError"), tone: "error" });
      } else {
        setTemplates(data ?? []);
      }
      setTemplatesLoading(false);
    })();
  }, [businessId, t]);

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title={t("createHub.title")} subtitle={t("createHub.subtitle")} />
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {!isLoggedIn ? (
        <View style={{ marginTop: Spacing.lg }}>
          <Text style={{ opacity: 0.7 }}>{t("createHub.loginPrompt")}</Text>
        </View>
      ) : loading || profileCheckLoading ? (
        <View style={{ marginTop: Spacing.lg }}>
          <ActivityIndicator />
          <Text style={{ opacity: 0.7, marginTop: Spacing.sm }}>{t("createHub.loading")}</Text>
        </View>
      ) : !hasBusinessProfileAccess ? (
        <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("createHub.createBusinessHeader")}</Text>
          <Text style={{ opacity: 0.7 }}>{t("createHub.createBusinessBody")}</Text>
          <PrimaryButton
            title={t("account.startBusinessSetup")}
            onPress={() => router.push("/business-setup" as Href)}
          />
        </View>
      ) : blockedSubscription ? (
        <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
          <Banner
            tone="warning"
            message={t("billing.paywallExpiredMessage", {
              defaultValue:
                "Your trial has ended. Reactivate your account to continue creating deals.",
            })}
          />
          <PrimaryButton
            title={t("billing.goToBilling", { defaultValue: "Go to Billing" })}
            onPress={() =>
              router.replace({
                pathname: "/(tabs)/billing",
                params: { reason: "reactivate" },
              } as unknown as Href)
            }
          />
        </View>
      ) : !businessId ? (
        <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
          <Text style={{ opacity: 0.7 }}>
            {t("createHub.bizProfilePending")}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1, marginTop: Spacing.lg }}
          contentContainerStyle={{ gap: Spacing.md, paddingBottom: scrollBottom }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── New Deal ── */}
          <Pressable
            onPress={() => router.push("/create/ai")}
            style={{
              borderRadius: Radii.card,
              padding: Spacing.xl,
              backgroundColor: Colors.light.primary,
              alignItems: "center",
              boxShadow: "0px 4px 14px rgba(255,159,28,0.35)",
              elevation: 4,
            }}
          >
            <Text style={{ fontSize: 20, fontWeight: "900", color: "#fff", letterSpacing: 0.2 }}>
              {t("createHub.newDeal")}
            </Text>
            <Text style={{ fontSize: 14, color: "#fff", opacity: 0.88, marginTop: 6 }}>
              {t("createHub.newDealSub")}
            </Text>
          </Pressable>

          {/* ── Reuse Past Deal ── */}
          <Pressable
            onPress={() => router.push("/create/reuse")}
            style={{
              borderRadius: Radii.lg,
              padding: Spacing.lg,
              backgroundColor: Colors.light.surface,
              borderWidth: 1.5,
              borderColor: Colors.light.border,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "700", color: theme.text }}>
              {t("createHub.reuseDeal")}
            </Text>
            <Text style={{ fontSize: 13, color: theme.mutedText, marginTop: 4 }}>
              {t("createHub.reuseDealSub")}
            </Text>
          </Pressable>

          {/* ── More Tools (menu features) ── */}
          <Pressable
            onPress={() => setMoreToolsOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: moreToolsOpen }}
          >
            <CardShell variant="muted">
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: "700" }}>{t("createHub.moreToolsTitle")}</Text>
              <Text style={{ color: theme.mutedText, marginTop: 2, fontSize: 12 }}>
                {moreToolsOpen ? t("createHub.moreToolsHide") : t("createHub.moreToolsShow")}
              </Text>
            </CardShell>
          </Pressable>

          {moreToolsOpen ? (
            <View style={{ gap: Spacing.sm }}>
              <Pressable
                onPress={() => router.push("/create/menu-offer" as Href)}
                style={{ borderRadius: Radii.md, padding: Spacing.md, backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.border }}
              >
                <Text style={{ fontWeight: "700", fontSize: 15 }}>{t("createHub.menuDealFastTitle")}</Text>
                <Text style={{ opacity: 0.6, fontSize: 13, marginTop: 2 }}>{t("createHub.menuDealFastSubtitle")}</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push("/create/menu-scan" as Href)}
                style={{ borderRadius: Radii.md, padding: Spacing.md, backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.border }}
              >
                <Text style={{ fontWeight: "700", fontSize: 15 }}>{t("createHub.scanMenuTitle")}</Text>
                <Text style={{ opacity: 0.6, fontSize: 13, marginTop: 2 }}>{t("createHub.scanMenuSubtitle")}</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push("/create/menu-manager" as Href)}
                style={{ borderRadius: Radii.md, padding: Spacing.md, backgroundColor: Colors.light.surfaceMuted, borderWidth: 1, borderColor: Colors.light.border }}
              >
                <Text style={{ fontWeight: "700", fontSize: 15 }}>{t("createHub.menuManagerTitle")}</Text>
                <Text style={{ opacity: 0.6, fontSize: 13, marginTop: 2 }}>{t("createHub.menuManagerSubtitle")}</Text>
              </Pressable>
            </View>
          ) : null}

          {/* ── Templates ── */}
          <View style={{ marginTop: Spacing.sm }}>
            <Text style={{ fontSize: 17, fontWeight: "700", marginBottom: Spacing.md }}>{t("createHub.templatesTitle")}</Text>
            {templatesLoading ? (
              <Text style={{ opacity: 0.7 }}>{t("createHub.templatesLoading")}</Text>
            ) : templates.length === 0 ? (
              <Text style={{ opacity: 0.7 }}>{t("createHub.templatesEmpty")}</Text>
            ) : (
              templates.map((tpl) => {
                const tplPoster = resolveDealPosterDisplayUri(tpl.poster_url, null);
                return (
                <Pressable
                  key={tpl.id}
                  onPress={() => router.push({ pathname: "/create/ai", params: { templateId: tpl.id } })}
                  style={{
                    borderRadius: Radii.lg,
                    backgroundColor: Colors.light.surface,
                    padding: Spacing.md,
                    marginBottom: Spacing.md,
                    boxShadow: "0px 4px 8px rgba(0,0,0,0.08)",
                    elevation: 2,
                    borderWidth: 1,
                    borderColor: Colors.light.border,
                  }}
                >
                  {tplPoster ? (
                    <Image
                      source={{ uri: tplPoster }}
                      style={{ height: 140, width: "100%", borderRadius: 14 }}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={{ height: 140, borderRadius: 14, backgroundColor: "#eee" }} />
                  )}
                  <Text style={{ marginTop: Spacing.md, fontWeight: "700", fontSize: 16 }}>{tpl.title ?? t("createHub.templateUntitled")}</Text>
                  {tpl.price != null ? (
                    <Text style={{ marginTop: Spacing.xs, opacity: 0.7, fontSize: 15 }}>${Number(tpl.price).toFixed(2)}</Text>
                  ) : null}
                </Pressable>
              );
              })
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
