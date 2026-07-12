import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
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
import { isBillingBypassEnabled } from "@/lib/billing/access";
import { useBrandedConfirm } from "@/hooks/use-branded-confirm";
import { usePrimaryLocationBillingGate } from "@/hooks/use-primary-location-billing-gate";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";
import { getCreateTabScrollBottom } from "@/lib/create-tab-scroll";
import { getDealDisplayTitle } from "@/lib/deal-display-copy";
import { MerchantAccessBlockedCard } from "@/components/merchant-access-blocked-card";
import { BusinessTermsGate } from "@/components/business-terms-gate";
import { getBusinessOnboardingContext } from "@/lib/functions";

type TemplateRow = {
  id: string;
  title: string | null;
  description: string | null;
  poster_url: string | null;
  price: number | null;
};

type MaterialIconName = keyof typeof MaterialIcons.glyphMap;

export default function CreateDeal() {
  const { t } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const router = useRouter();
  const params = useLocalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const { isLoggedIn, businessId, loading, subscriptionTier } = useBusiness();
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" } | null>(null);
  const [templatesLoadError, setTemplatesLoadError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [profileCheckLoading, setProfileCheckLoading] = useState(false);
  const [hasBusinessProfileAccess, setHasBusinessProfileAccess] = useState(false);
  const [termsRequired, setTermsRequired] = useState(false);
  const [termsCheckLoading, setTermsCheckLoading] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const { confirm, confirmModal } = useBrandedConfirm();

  const bypass = isBillingBypassEnabled(params.skipSetup, params.e2e);
  const {
    blocked: blockedSubscription,
    loading: billingLoading,
    access: billingAccess,
  } = usePrimaryLocationBillingGate({
    businessId,
    subscriptionTier,
    isLoggedIn,
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

  const checkTermsGate = useCallback(async () => {
    if (!isLoggedIn || bypass || !businessId) {
      setTermsRequired(false);
      return;
    }
    setTermsCheckLoading(true);
    try {
      const context = await getBusinessOnboardingContext();
      const reasonCode = context.access_state?.reason_code;
      setTermsRequired(reasonCode === "terms_required");
    } catch {
      // Non-fatal: if the check itself fails, don't block the create hub on it —
      // the server-side publish gate still enforces terms at publish time.
      setTermsRequired(false);
    } finally {
      setTermsCheckLoading(false);
    }
  }, [isLoggedIn, bypass, businessId]);

  useFocusEffect(
    useCallback(() => {
      void checkTermsGate();
    }, [checkTermsGate]),
  );

  const loadTemplates = useCallback(async () => {
    if (!businessId) {
      setTemplates([]);
      setTemplatesLoadError(null);
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
      setTemplatesLoadError(t("createHub.templatesLoadError"));
    } else {
      setTemplatesLoadError(null);
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

  function toggleTemplatesFolder() {
    setTemplatesOpen((current) => !current);
  }

  function renderHubAction({
    title,
    subtitle,
    iconName,
    onPress,
    accent = false,
    trailingIcon = "chevron-right",
  }: {
    title: string;
    subtitle: string;
    iconName: MaterialIconName;
    onPress: () => void;
    accent?: boolean;
    trailingIcon?: MaterialIconName;
  }) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${subtitle}`}
        style={{
          minHeight: 88,
          borderRadius: Radii.md,
          padding: Spacing.md,
          backgroundColor: theme.surface,
          borderWidth: 1.5,
          borderColor: accent ? theme.primary : theme.border,
          flexDirection: "row",
          alignItems: "center",
          gap: Spacing.md,
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: Radii.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: accent
              ? theme.primary
              : colorScheme === "dark" ? theme.surfaceMuted : "rgba(17,24,39,0.06)",
          }}
        >
          <MaterialIcons
            name={iconName}
            size={24}
            color={accent ? theme.primaryText : theme.icon}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{ fontSize: 18, lineHeight: 23, fontWeight: "900", color: theme.text }}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            maxFontSizeMultiplier={1.12}
          >
            {title}
          </Text>
          <Text
            style={{ marginTop: 4, fontSize: 15, lineHeight: 20, fontWeight: "600", color: theme.mutedText }}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            maxFontSizeMultiplier={1.12}
          >
            {subtitle}
          </Text>
        </View>
        <MaterialIcons name={trailingIcon} size={22} color={theme.icon} />
      </Pressable>
    );
  }

  function renderCompactAction({
    title,
    subtitle,
    iconName,
    onPress,
    trailingIcon = "chevron-right",
    accessibilityState,
  }: {
    title: string;
    subtitle: string;
    iconName: MaterialIconName;
    onPress: () => void;
    trailingIcon?: MaterialIconName;
    accessibilityState?: { expanded?: boolean };
  }) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        accessibilityLabel={`${title}. ${subtitle}`}
        style={{
          minHeight: 64,
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
        <MaterialIcons name={iconName} size={23} color={theme.accentText} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: "800", fontSize: 15, lineHeight: 19, color: theme.text }} numberOfLines={1}>
            {title}
          </Text>
          <Text
            style={{ color: theme.mutedText, fontSize: 13, lineHeight: 18, marginTop: 2 }}
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        </View>
        <MaterialIcons name={trailingIcon} size={22} color={theme.icon} />
      </Pressable>
    );
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
      ) : loading || profileCheckLoading || billingLoading || termsCheckLoading ? (
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
        <View style={{ marginTop: Spacing.lg }}>
          <MerchantAccessBlockedCard status={billingAccess.status} />
        </View>
      ) : termsRequired && businessId ? (
        <View style={{ marginTop: Spacing.lg }}>
          <BusinessTermsGate businessId={businessId} onAccepted={() => setTermsRequired(false)} />
        </View>
      ) : !businessId ? (
        <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
          <Text style={{ color: theme.mutedText }}>
            {t("createHub.bizProfilePending")}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1, marginTop: Spacing.lg }}
          contentContainerStyle={{ gap: Spacing.md, paddingBottom: createScrollBottom }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── New Deal (unified AI builder: photo, voice, or text → review → publish) ── */}
          {renderHubAction({
            title: t("createHub.newDeal"),
            subtitle: t("createHub.newDealSub"),
            iconName: "add-circle-outline",
            onPress: () => router.push("/create/ai?fromCreateHub=1" as Href),
            accent: true,
          })}

          {renderHubAction({
            title: t("createHub.menuOfferTitle"),
            subtitle: t("createHub.menuOfferSubtitle"),
            iconName: "restaurant-menu",
            onPress: () => router.push("/create/menu-offer" as Href),
          })}

          {/* ── Reuse Past Deal ── */}
          {renderHubAction({
            title: t("createHub.reuseDeal"),
            subtitle: t("createHub.reuseDealSub"),
            iconName: "history",
            onPress: () => router.push("/create/reuse"),
          })}

          <View style={{ gap: Spacing.sm, paddingTop: Spacing.xs }}>
            {renderCompactAction({
              title: t("createHub.menuManagerTitle"),
              subtitle: t("createHub.menuManagerSubtitle"),
              iconName: "menu-book",
              onPress: () => router.push("/create/menu-manager" as Href),
            })}
            {renderCompactAction({
              title: t("createHub.templatesTitle"),
              subtitle: t("reuseHub.templatesSection"),
              iconName: templatesOpen ? "folder-open" : "folder",
              onPress: toggleTemplatesFolder,
              accessibilityState: { expanded: templatesOpen },
              trailingIcon: templatesOpen ? "keyboard-arrow-up" : "keyboard-arrow-down",
            })}
          </View>

          {templatesOpen ? (
            <View style={{ gap: Spacing.md, paddingTop: Spacing.xs }}>
            {templatesLoadError ? (
              <Banner
                message={templatesLoadError}
                tone="error"
                onRetry={() => void loadTemplates()}
              />
            ) : templatesLoading ? (
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
