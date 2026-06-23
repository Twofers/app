import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
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
import { getCreateTabScrollBottom, getExpandedSectionScrollY } from "@/lib/create-tab-scroll";
import { getDealDisplayTitle } from "@/lib/deal-display-copy";

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
  const [moreToolsOpen, setMoreToolsOpen] = useState(true);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const templatesFolderYRef = useRef(0);
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

  function toggleMoreTools() {
    if (moreToolsOpen) {
      setTemplatesOpen(false);
    }
    setMoreToolsOpen((current) => !current);
  }

  function toggleTemplatesFolder() {
    setTemplatesOpen((current) => {
      const next = !current;
      if (next) {
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({
            y: getExpandedSectionScrollY(templatesFolderYRef.current),
            animated: true,
          });
        });
      }
      return next;
    });
  }

  function rememberTemplatesFolderLayout(event: LayoutChangeEvent) {
    templatesFolderYRef.current = event.nativeEvent.layout.y;
  }

  const createScrollBottom = getCreateTabScrollBottom(scrollBottom);

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title={t("createHub.title")} subtitle={t("createHub.subtitle")} />
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {!isLoggedIn ? (
        <View style={{ marginTop: Spacing.lg }}>
          <Text style={{ color: theme.mutedText }}>{t("createHub.loginPrompt")}</Text>
        </View>
      ) : loading || profileCheckLoading ? (
        <View style={{ marginTop: Spacing.lg }}>
          <ActivityIndicator color={theme.primary} />
          <Text style={{ color: theme.mutedText, marginTop: Spacing.sm }}>{t("createHub.loading")}</Text>
        </View>
      ) : !hasBusinessProfileAccess ? (
        <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
          <Text style={{ fontWeight: "700", fontSize: 16, color: theme.text }}>{t("createHub.createBusinessHeader")}</Text>
          <Text style={{ color: theme.mutedText }}>{t("createHub.createBusinessBody")}</Text>
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
                pathname: PAID_BILLING_ENABLED ? "/(tabs)/account/billing" : "/(tabs)/account",
                params: PAID_BILLING_ENABLED ? { reason: "reactivate" } : {},
              } as unknown as Href)
            }
          />
        </View>
      ) : !businessId ? (
        <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
          <Text style={{ color: theme.mutedText }}>
            {t("createHub.bizProfilePending")}
          </Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1, marginTop: Spacing.lg }}
          contentContainerStyle={{ gap: Spacing.md, paddingBottom: createScrollBottom }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── New Deal (unified AI builder: photo, voice, or text → review → publish) ── */}
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/create/ai",
                params: { fromCreateHub: "1" },
              } as Href)
            }
            style={{
              borderRadius: Radii.lg,
              padding: Spacing.xl,
              backgroundColor: theme.primary,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 20, fontWeight: "900", color: theme.primaryText, letterSpacing: 0.2 }}>
              {t("createHub.newDeal")}
            </Text>
            <Text style={{ fontSize: 14, color: theme.primaryText, opacity: 0.88, marginTop: 6 }}>
              {t("createHub.newDealSub")}
            </Text>
          </Pressable>

          {/* ── Reuse Past Deal ── */}
          <Pressable
            onPress={() => router.push("/create/reuse")}
            style={{
              borderRadius: Radii.lg,
              padding: Spacing.lg,
              backgroundColor: theme.surface,
              borderWidth: 1.5,
              borderColor: theme.border,
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

          {/* ── More Tools ── */}
          <Pressable
            onPress={toggleMoreTools}
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
                onPress={() => router.push("/create/menu" as Href)}
                style={{
                  borderRadius: Radii.md,
                  padding: Spacing.md,
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: theme.border,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: Spacing.md,
                }}
              >
                <MaterialIcons name="restaurant-menu" size={22} color={theme.accentText} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontWeight: "700", fontSize: 15, color: theme.text }}>{t("createHub.menuTitle")}</Text>
                  <Text style={{ color: theme.mutedText, fontSize: 13, marginTop: 2 }}>{t("createHub.menuSubtitle")}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={theme.icon} />
              </Pressable>
              <Pressable
                onPress={toggleTemplatesFolder}
                onLayout={rememberTemplatesFolderLayout}
                accessibilityRole="button"
                accessibilityState={{ expanded: templatesOpen }}
                style={{
                  borderRadius: Radii.md,
                  padding: Spacing.md,
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: theme.border,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: Spacing.md,
                }}
              >
                <MaterialIcons name={templatesOpen ? "folder-open" : "folder"} size={22} color={theme.accentText} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontWeight: "700", fontSize: 15, color: theme.text }}>{t("createHub.templatesTitle")}</Text>
                  <Text style={{ color: theme.mutedText, fontSize: 13, marginTop: 2 }}>{t("reuseHub.templatesSection")}</Text>
                </View>
                <MaterialIcons name={templatesOpen ? "keyboard-arrow-up" : "keyboard-arrow-down"} size={22} color={theme.icon} />
              </Pressable>
            </View>
          ) : null}

          {/* ── Templates ── */}
          {moreToolsOpen && templatesOpen ? (
            <View style={{ gap: Spacing.md, paddingTop: Spacing.xs }}>
            {templatesLoading ? (
              <Text style={{ color: theme.mutedText }}>{t("createHub.templatesLoading")}</Text>
            ) : templates.length === 0 ? (
              <Text style={{ color: theme.mutedText }}>{t("createHub.templatesEmpty")}</Text>
            ) : (
              templates.map((tpl) => {
                const tplPoster = resolveDealPosterDisplayUri(tpl.poster_url, null);
                const tplTitle = getDealDisplayTitle({ title: tpl.title }, tpl.title) || t("createHub.templateUntitled");
                return (
                <View
                  key={tpl.id}
                  style={{
                    borderRadius: Radii.lg,
                    backgroundColor: theme.surface,
                    borderWidth: 1,
                    borderColor: theme.border,
                    overflow: "hidden",
                  }}
                >
                  <Pressable
                    onPress={() => router.push({ pathname: "/create/ai", params: { templateId: tpl.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={t("reuseHub.openTemplateA11y", {
                      defaultValue: "Open template {{title}}",
                      title: tplTitle,
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
                      <View style={{ height: 140, borderRadius: 14, backgroundColor: theme.surfaceMuted }} />
                    )}
                    <Text style={{ marginTop: Spacing.md, fontWeight: "700", fontSize: 16, color: theme.text }}>{tplTitle}</Text>
                    {tpl.price != null ? (
                      <Text style={{ marginTop: Spacing.xs, color: theme.mutedText, fontSize: 15 }}>${Number(tpl.price).toFixed(2)}</Text>
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
                        title: tplTitle,
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
          ) : null}
        </ScrollView>
      )}
      {confirmModal}
    </View>
  );
}
