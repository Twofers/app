import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { CardShell } from "@/components/ui/card-shell";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { useBusiness } from "../../hooks/use-business";
import { PrimaryButton } from "../../components/ui/primary-button";
import { Banner } from "../../components/ui/banner";
import { Image } from "expo-image";
import { resolveDealPosterDisplayUri } from "../../lib/deal-poster-url";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { getBusinessProfileAccessForCurrentUser } from "@/lib/business-profile-access";
import { PAID_BILLING_ENABLED, canCreateDeal, isBillingBypassEnabled } from "@/lib/billing/access";
import { useBrandedConfirm } from "@/hooks/use-branded-confirm";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";

type TemplateRow = {
  id: string;
  title: string | null;
  description: string | null;
  poster_url: string | null;
  price: number | null;
};

export default function CreateDeal() {
  const { t } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const router = useRouter();
  const params = useLocalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const { isLoggedIn, businessId, loading, subscriptionStatus, trialEndsAt } = useBusiness();
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" } | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [profileCheckLoading, setProfileCheckLoading] = useState(false);
  const [hasBusinessProfileAccess, setHasBusinessProfileAccess] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const { confirm, confirmModal } = useBrandedConfirm();

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

  const loadTemplates = useCallback(async () => {
    if (!businessId) {
      setTemplates([]);
      setTemplatesLoading(false);
      return;
    }
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
      setTemplates((data ?? []) as TemplateRow[]);
    }
    setTemplatesLoading(false);
  }, [businessId, t]);

  useFocusEffect(
    useCallback(() => {
      void loadTemplates();
    }, [loadTemplates]),
  );

  function confirmDeleteTemplate(row: TemplateRow) {
    if (!businessId || deletingTemplateId) return;
    confirm({
      iconName: "delete",
      title: t("reuseHub.deleteTemplateTitle", { defaultValue: "Delete template?" }),
      message: t("reuseHub.deleteTemplateBody", {
        defaultValue: "This removes the saved template. Past and live deals stay unchanged.",
      }),
      confirmLabel: t("reuseHub.deleteTemplateCta", { defaultValue: "Delete template" }),
      cancelLabel: t("commonUi.cancel"),
      onConfirm: () => void deleteTemplate(row.id),
    });
  }

  async function deleteTemplate(templateId: string) {
    if (!businessId) return;
    setDeletingTemplateId(templateId);
    setBanner(null);
    try {
      const { error } = await supabase
        .from("deal_templates")
        .delete()
        .eq("id", templateId)
        .eq("business_id", businessId);
      if (error) throw error;
      setTemplates((current) => current.filter((row) => row.id !== templateId));
      setBanner({ message: t("reuseHub.templateDeleted", { defaultValue: "Template deleted." }), tone: "success" });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : t("reuseHub.deleteTemplateFailed", { defaultValue: "Couldn't delete this template." });
      setBanner({ message: translateKnownApiMessage(message, t), tone: "error" });
    } finally {
      setDeletingTemplateId(null);
    }
  }

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
            message={t("billing.paywallExpiredMessage")}
          />
          <PrimaryButton
            title={t("billing.goToBilling")}
            onPress={() =>
              router.replace({
                pathname: PAID_BILLING_ENABLED ? "/(tabs)/billing" : "/(tabs)/account",
                params: PAID_BILLING_ENABLED ? { reason: "reactivate" } : {},
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
          {/* ── New Deal (express flow: photo/item → AI draft → publish) ── */}
          <Pressable
            onPress={() => router.push("/create/quick")}
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
                <View
                  key={tpl.id}
                  style={{
                    borderRadius: Radii.lg,
                    backgroundColor: Colors.light.surface,
                    marginBottom: Spacing.md,
                    boxShadow: "0px 4px 8px rgba(0,0,0,0.08)",
                    elevation: 2,
                    borderWidth: 1,
                    borderColor: Colors.light.border,
                    overflow: "hidden",
                  }}
                >
                  <Pressable
                    onPress={() => router.push({ pathname: "/create/ai", params: { templateId: tpl.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={t("reuseHub.openTemplateA11y", {
                      defaultValue: "Open template {{title}}",
                      title: tpl.title ?? t("createHub.templateUntitled"),
                    })}
                    style={{ padding: Spacing.md }}
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
                  <View
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: theme.border,
                      paddingHorizontal: Spacing.md,
                      paddingBottom: Spacing.md,
                      paddingTop: Spacing.sm,
                      alignItems: "flex-end",
                    }}
                  >
                    <Pressable
                      onPress={() => confirmDeleteTemplate(tpl)}
                      disabled={deletingTemplateId !== null}
                      accessibilityRole="button"
                      accessibilityLabel={t("reuseHub.deleteTemplateA11y", {
                        defaultValue: "Delete template {{title}}",
                        title: tpl.title ?? t("createHub.templateUntitled"),
                      })}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={{
                        minHeight: 44,
                        paddingHorizontal: Spacing.md,
                        borderRadius: 22,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: Spacing.xs,
                        backgroundColor: theme.surfaceMuted,
                        borderWidth: 1,
                        borderColor: theme.border,
                        opacity: deletingTemplateId === tpl.id ? 0.45 : 1,
                      }}
                    >
                      <MaterialIcons name="delete-outline" size={19} color={theme.danger} />
                      <Text style={{ color: theme.danger, fontWeight: "800", fontSize: 13 }}>
                        {t("reuseHub.deleteTemplateShort", { defaultValue: "Delete" })}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
              })
            )}
          </View>
        </ScrollView>
      )}
      {confirmModal}
    </View>
  );
}
