import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/hooks/use-business";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Banner } from "@/components/ui/banner";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";
import { resolveDealPosterDisplayUri } from "@/lib/deal-poster-url";
import { buildReuseDealPrefillParams } from "@/lib/reuse-deal-prefill";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Colors, Gray } from "@/constants/theme";
import { useBrandedConfirm } from "@/hooks/use-branded-confirm";
import { getDealDisplayTitle } from "@/lib/deal-display-copy";

type TemplateRow = {
  id: string;
  title: string | null;
  description: string | null;
  price: number | null;
  poster_url: string | null;
};

type DealRow = {
  id: string;
  title: string | null;
  description: string | null;
  source_locale: string | null;
  price: number | null;
  poster_url: string | null;
  poster_storage_path?: string | null;
  end_time: string;
  is_recurring: boolean | null;
  days_of_week: number[] | null;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
  timezone: string | null;
  max_claims: number | null;
  claim_cutoff_buffer_minutes: number | null;
  deal_type?: string | null;
  discount_percent?: number | null;
  item_description?: string | null;
  item_retail_value_cents?: number | null;
  required_item_description?: string | null;
  required_item_retail_value_cents?: number | null;
  free_item_description?: string | null;
  free_item_retail_value_cents?: number | null;
};

const REUSE_DEALS_BASE_SELECT =
  "id,title,description,source_locale,price,poster_url,poster_storage_path,end_time,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone,max_claims,claim_cutoff_buffer_minutes";
const REUSE_DEALS_ENRICHED_SELECT =
  `${REUSE_DEALS_BASE_SELECT},deal_type,discount_percent,item_description,item_retail_value_cents,required_item_description,required_item_retail_value_cents,free_item_description,free_item_retail_value_cents`;
const OPTIONAL_REUSE_DEAL_COLUMNS = [
  "deal_type",
  "discount_percent",
  "item_description",
  "item_retail_value_cents",
  "required_item_description",
  "required_item_retail_value_cents",
  "free_item_description",
  "free_item_retail_value_cents",
] as const;

function isMissingOptionalReuseDealColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return (
    (error?.code === "PGRST204" || error?.code === "42703" || message.toLowerCase().includes("schema cache")) &&
    OPTIONAL_REUSE_DEAL_COLUMNS.some((column) => message.includes(column))
  );
}

async function fetchReusableDeals(businessId: string) {
  const enriched = await supabase
    .from("deals")
    .select(REUSE_DEALS_ENRICHED_SELECT)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(25);
  if (!isMissingOptionalReuseDealColumn(enriched.error)) return enriched;

  return supabase
    .from("deals")
    .select(REUSE_DEALS_BASE_SELECT)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(25);
}

export default function ReuseDealScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const { businessId, isLoggedIn, loading } = useBusiness();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const { confirm, confirmModal } = useBrandedConfirm();

  const load = useCallback(async () => {
    if (!businessId) return;
    setErr(null);
    const [tpl, dl] = await Promise.all([
      supabase
        .from("deal_templates")
        .select("id,title,description,price,poster_url")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(25),
      fetchReusableDeals(businessId),
    ]);
    const errors: string[] = [];
    if (tpl.error) errors.push(translateKnownApiMessage(tpl.error.message, t));
    else setTemplates((tpl.data ?? []) as TemplateRow[]);
    if (dl.error) errors.push(translateKnownApiMessage(dl.error.message, t));
    else setDeals((dl.data ?? []) as DealRow[]);
    if (errors.length) setErr(errors.join(" "));
  }, [businessId, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function openTemplate(row: TemplateRow) {
    router.push({ pathname: "/create/ai", params: { templateId: row.id } } as Href);
  }

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
    setErr(null);
    try {
      const { error } = await supabase
        .from("deal_templates")
        .delete()
        .eq("id", templateId)
        .eq("business_id", businessId);
      if (error) throw error;
      setTemplates((current) => current.filter((row) => row.id !== templateId));
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : t("reuseHub.deleteTemplateFailed", {
              defaultValue: "Couldn't delete this template.",
            });
      setErr(translateKnownApiMessage(message, t));
    } finally {
      setDeletingTemplateId(null);
    }
  }

  function repeatDeal(row: DealRow) {
    router.push({
      pathname: "/create/ai",
      params: buildReuseDealPrefillParams(row, { resetSchedule: true }),
    } as Href);
  }

  function templateTitle(row: TemplateRow): string {
    return getDealDisplayTitle({ title: row.title }, row.title) || t("reuseHub.untitled");
  }

  function dealTitle(row: DealRow): string {
    return getDealDisplayTitle(row, row.title) || t("reuseHub.untitled");
  }

  return (
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
      {/* The stack header already shows the screen title; only the subtitle renders in-page. */}
      <Text style={{ opacity: 0.65, fontSize: 15, lineHeight: 22 }}>{t("reuseHub.subtitle")}</Text>
      {err ? <Banner message={err} tone="error" /> : null}

      {!isLoggedIn || loading ? (
        <Text style={{ marginTop: Spacing.lg }}>{t("reuseHub.loading")}</Text>
      ) : !businessId ? (
        <Text style={{ marginTop: Spacing.lg }}>{t("reuseHub.needBusiness")}</Text>
      ) : (
        <ScrollView
          style={{ marginTop: Spacing.md, flex: 1 }}
          contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.lg }}
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Text style={{ fontSize: 17, fontWeight: "800", marginBottom: Spacing.sm }}>{t("reuseHub.templatesSection")}</Text>
            {templates.length === 0 ? (
              <Text style={{ opacity: 0.65 }}>{t("reuseHub.templatesEmpty")}</Text>
            ) : (
              templates.map((row) => {
                const tplPoster = resolveDealPosterDisplayUri(row.poster_url, null);
                return (
                <View
                  key={row.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: Spacing.md,
                    padding: Spacing.md,
                    borderRadius: 16,
                    backgroundColor: theme.surfaceMuted,
                    borderWidth: 1,
                    borderColor: theme.border,
                    marginBottom: Spacing.sm,
                  }}
                >
                  <Pressable
                    onPress={() => openTemplate(row)}
                    style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: Spacing.md }}
                    accessibilityRole="button"
                    accessibilityLabel={t("reuseHub.openTemplateA11y", {
                      defaultValue: "Open template {{title}}",
                      title: templateTitle(row),
                    })}
                  >
                    {tplPoster ? (
                      <Image
                        source={{ uri: tplPoster }}
                        style={{ width: 72, height: 72, borderRadius: 12 }}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={{ width: 72, height: 72, borderRadius: 12, backgroundColor: Gray[200] }} />
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontWeight: "700", fontSize: 16 }} numberOfLines={2}>
                        {templateTitle(row)}
                      </Text>
                      <Text style={{ marginTop: 4, fontSize: 13, opacity: 0.55 }}>{t("reuseHub.openInAiAds")}</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmDeleteTemplate(row)}
                    disabled={deletingTemplateId !== null}
                    accessibilityRole="button"
                    accessibilityLabel={t("reuseHub.deleteTemplateA11y", {
                      defaultValue: "Delete template {{title}}",
                      title: templateTitle(row),
                    })}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: theme.surface,
                      borderWidth: 1,
                      borderColor: theme.border,
                      opacity: deletingTemplateId === row.id ? 0.45 : 1,
                    }}
                  >
                    <MaterialIcons name="delete-outline" size={22} color={theme.danger} />
                  </Pressable>
                </View>
              );
              })
            )}
          </View>

          <View>
            <Text style={{ fontSize: 17, fontWeight: "800", marginBottom: Spacing.sm }}>{t("reuseHub.pastDealsSection")}</Text>
            {deals.length === 0 ? (
              <Text style={{ opacity: 0.65 }}>{t("reuseHub.dealsEmpty")}</Text>
            ) : (
              deals.map((row) => {
                const dealPoster = resolveDealPosterDisplayUri(row.poster_url, row.poster_storage_path);
                return (
                <Pressable
                  key={row.id}
                  onPress={() => repeatDeal(row)}
                  style={{
                    flexDirection: "row",
                    gap: Spacing.md,
                    padding: Spacing.md,
                    borderRadius: 16,
                    backgroundColor: theme.surface,
                    borderWidth: 1,
                    borderColor: theme.border,
                    marginBottom: Spacing.sm,
                  }}
                >
                  {dealPoster ? (
                    <Image
                      source={{ uri: dealPoster }}
                      style={{ width: 72, height: 72, borderRadius: 12 }}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={{ width: 72, height: 72, borderRadius: 12, backgroundColor: Gray[200] }} />
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: "700", fontSize: 16 }} numberOfLines={2}>
                      {dealTitle(row)}
                    </Text>
                    {row.price != null ? (
                      <Text style={{ marginTop: 4, fontSize: 14, opacity: 0.7 }}>${Number(row.price).toFixed(2)}</Text>
                    ) : null}
                    <Text style={{ marginTop: 4, fontSize: 13, fontWeight: "600", color: theme.primary }}>
                      {t("reuseHub.repeatCta")}
                    </Text>
                  </View>
                </Pressable>
              );
              })
            )}
          </View>

          <Pressable onPress={() => router.push("/create/ai" as Href)} style={{ paddingVertical: Spacing.md }}>
            <Text style={{ fontWeight: "700", color: theme.primary }}>{t("reuseHub.backToCreate")}</Text>
          </Pressable>
        </ScrollView>
      )}
      {confirmModal}
    </View>
  );
}
