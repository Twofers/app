import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { useBusiness } from "../../hooks/use-business";
import { PrimaryButton } from "../../components/ui/primary-button";
import { Banner } from "../../components/ui/banner";
import { Image } from "expo-image";
import { resolveDealPosterDisplayUri } from "../../lib/deal-poster-url";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { getBusinessProfileAccessForCurrentUser } from "@/lib/business-profile-access";

export default function CreateDeal() {
  const { t } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const router = useRouter();
  const params = useLocalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const { isLoggedIn, businessId, loading } = useBusiness();
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" } | null>(null);
  const [templates, setTemplates] = useState<{ id: string; title: string | null; description: string | null; poster_url: string | null; price: number | null }[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [profileCheckLoading, setProfileCheckLoading] = useState(false);
  const [hasBusinessProfileAccess, setHasBusinessProfileAccess] = useState(false);

  useEffect(() => {
    const bypass = String(params.skipSetup ?? "") === "1" || String(params.e2e ?? "") === "1";
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
  }, [isLoggedIn, params.skipSetup, params.e2e]);

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
  }, [businessId]);

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("createHub.title")}</Text>
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
          <Pressable
            onPress={() => router.push("/create/quick")}
            style={{
              borderRadius: Radii.lg,
              padding: Spacing.lg,
              backgroundColor: Colors.light.primary,
              boxShadow: "0px 4px 10px rgba(0,0,0,0.10)",
              elevation: 3,
            }}
          >
            <Text style={{ color: Colors.light.primaryText, fontSize: 17, fontWeight: "700" }}>{t("createHub.quickDealTitle")}</Text>
            <Text style={{ color: Colors.light.primaryText, opacity: 0.9, marginTop: Spacing.sm, fontSize: 15, lineHeight: 22 }}>
              {t("createHub.quickDealSubtitle")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/create/ai-compose")}
            style={{
              borderRadius: Radii.lg,
              padding: Spacing.lg,
              backgroundColor: "#1e3a5f",
              boxShadow: "0px 3px 8px rgba(0,0,0,0.08)",
              elevation: 2,
            }}
          >
            <Text style={{ color: "white", fontSize: 17, fontWeight: "700" }}>{t("createHub.aiComposeTitle")}</Text>
            <Text style={{ color: "white", opacity: 0.88, marginTop: Spacing.sm, fontSize: 15, lineHeight: 22 }}>
              {t("createHub.aiComposeSubtitle")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/create/menu-scan" as Href)}
            style={{
              borderRadius: Radii.lg,
              padding: Spacing.md,
              backgroundColor: Colors.light.surface,
              borderWidth: 1,
              borderColor: Colors.light.border,
            }}
          >
            <Text style={{ color: "#111", fontSize: 16, fontWeight: "700" }}>{t("createHub.scanMenuTitle")}</Text>
            <Text style={{ color: "#111", opacity: 0.65, marginTop: Spacing.xs, fontSize: 14, lineHeight: 20 }}>
              {t("createHub.scanMenuSubtitle")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/create/menu-offer" as Href)}
            style={{
              borderRadius: Radii.lg,
              padding: Spacing.md,
              backgroundColor: Colors.light.surfaceMuted,
              borderWidth: 1,
              borderColor: Colors.light.border,
            }}
          >
            <Text style={{ color: "#111", fontSize: 16, fontWeight: "700" }}>{t("createHub.menuOfferTitle")}</Text>
            <Text style={{ color: "#111", opacity: 0.65, marginTop: Spacing.xs, fontSize: 14, lineHeight: 20 }}>
              {t("createHub.menuOfferSubtitle")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/create/reuse")}
            style={{
              borderRadius: Radii.lg,
              padding: Spacing.md,
              backgroundColor: Colors.light.surface,
              borderWidth: 1,
              borderColor: Colors.light.border,
            }}
          >
            <Text style={{ color: "#111", fontSize: 16, fontWeight: "700" }}>{t("createHub.reuseTitle")}</Text>
            <Text style={{ color: "#111", opacity: 0.65, marginTop: Spacing.xs, fontSize: 14, lineHeight: 20 }}>
              {t("createHub.reuseSubtitle")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/create/ai")}
            style={{
              borderRadius: Radii.lg,
              padding: Spacing.lg,
              backgroundColor: Colors.light.surfaceMuted,
            }}
          >
            <Text style={{ color: "#111", fontSize: 17, fontWeight: "700" }}>{t("createHub.aiAdsTitle")}</Text>
            <Text style={{ color: "#111", opacity: 0.72, marginTop: Spacing.sm, fontSize: 15, lineHeight: 22 }}>
              {t("createHub.aiAdsSubtitle")}
            </Text>
          </Pressable>

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
