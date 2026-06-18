import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
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

type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];

type CreateToolRow = {
  key: string;
  icon: MaterialIconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  expanded?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
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
  const secondaryTools: CreateToolRow[] = [
    {
      key: "photo",
      icon: "photo-camera",
      title: t("createHub.aiAdsTitle"),
      subtitle: t("createHub.aiAdsSubtitle"),
      onPress: () => router.push("/create/ai" as Href),
    },
    {
      key: "menu-offer",
      icon: "restaurant-menu",
      title: t("createHub.menuDealFastTitle"),
      subtitle: t("createHub.menuDealFastSubtitle"),
      onPress: () => router.push("/create/menu-offer" as Href),
    },
    {
      key: "menu-scan",
      icon: "document-scanner",
      title: t("createHub.scanMenuTitle"),
      subtitle: t("createHub.scanMenuSubtitle"),
      onPress: () => router.push("/create/menu-scan" as Href),
    },
    {
      key: "menu-manager",
      icon: "menu-book",
      title: t("createHub.menuManagerTitle"),
      subtitle: t("createHub.menuManagerSubtitle"),
      onPress: () => router.push("/create/menu-manager" as Href),
    },
    {
      key: "templates",
      icon: templatesOpen ? "folder-open" : "folder",
      title: t("createHub.templatesTitle"),
      subtitle: t("createHub.templatesSubtitle", { defaultValue: "Saved offer templates." }),
      onPress: toggleTemplatesFolder,
      expanded: templatesOpen,
      onLayout: rememberTemplatesFolderLayout,
    },
  ];

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
                pathname: PAID_BILLING_ENABLED ? "/(tabs)/billing" : "/(tabs)/account",
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
          <Pressable
            onPress={() => router.push("/create/quick")}
            style={{
              borderRadius: Radii.md,
              padding: Spacing.lg,
              backgroundColor: theme.primary,
              flexDirection: "row",
              alignItems: "center",
              gap: Spacing.md,
            }}
          >
            <MaterialIcons name="local-offer" size={24} color={theme.primaryText} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 18, fontWeight: "900", color: theme.primaryText }}>
                {t("createHub.newDeal")}
              </Text>
              <Text style={{ fontSize: 13, color: theme.primaryText, opacity: 0.9, marginTop: 4, lineHeight: 18 }}>
                {t("createHub.newDealSub")}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={theme.primaryText} />
          </Pressable>

          <Pressable
            onPress={() => router.push("/create/reuse")}
            style={{
              borderRadius: Radii.md,
              padding: Spacing.lg,
              backgroundColor: theme.surface,
              borderWidth: 1.5,
              borderColor: theme.border,
              flexDirection: "row",
              alignItems: "center",
              gap: Spacing.md,
            }}
          >
            <MaterialIcons name="history" size={22} color={theme.accentText} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 16, fontWeight: "800", color: theme.text }}>
                {t("createHub.reuseDeal")}
              </Text>
              <Text style={{ fontSize: 13, color: theme.mutedText, marginTop: 3, lineHeight: 18 }}>
                {t("createHub.reuseDealSub")}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={theme.icon} />
          </Pressable>

          <Pressable
            onPress={toggleMoreTools}
            accessibilityRole="button"
            accessibilityState={{ expanded: moreToolsOpen }}
            accessibilityLabel={t(
              moreToolsOpen ? "createHub.moreToolsCollapseA11y" : "createHub.moreToolsExpandA11y",
            )}
            style={{
              borderRadius: Radii.md,
              paddingVertical: Spacing.md,
              paddingHorizontal: Spacing.md,
              backgroundColor: theme.surfaceMuted,
              borderWidth: 1,
              borderColor: theme.border,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: Spacing.md,
            }}
          >
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: "800" }}>{t("createHub.moreToolsTitle")}</Text>
            <MaterialIcons name={moreToolsOpen ? "keyboard-arrow-up" : "keyboard-arrow-down"} size={24} color={theme.icon} />
          </Pressable>

          {moreToolsOpen ? (
            <View
              style={{
                borderRadius: Radii.md,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.surface,
                overflow: "hidden",
              }}
            >
              {secondaryTools.map((item, index) => (
                <Pressable
                  key={item.key}
                  onPress={item.onPress}
                  onLayout={item.onLayout}
                  accessibilityRole="button"
                  accessibilityState={item.expanded == null ? undefined : { expanded: item.expanded }}
                  style={{
                    padding: Spacing.md,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: Spacing.md,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: theme.border,
                  }}
                >
                  <MaterialIcons name={item.icon} size={22} color={theme.accentText} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: "800", fontSize: 15, color: theme.text }}>{item.title}</Text>
                    <Text style={{ color: theme.mutedText, fontSize: 13, marginTop: 2, lineHeight: 18 }}>{item.subtitle}</Text>
                  </View>
                  <MaterialIcons
                    name={item.key === "templates" ? (templatesOpen ? "keyboard-arrow-up" : "keyboard-arrow-down") : "chevron-right"}
                    size={22}
                    color={theme.icon}
                  />
                </Pressable>
              ))}
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
