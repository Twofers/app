import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/hooks/use-business";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Banner } from "@/components/ui/banner";
import { resolveDealPosterDisplayUri } from "@/lib/deal-poster-url";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";

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
  price: number | null;
  poster_url: string | null;
  poster_storage_path?: string | null;
  end_time: string;
};

export default function ReuseDealScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { businessId, isLoggedIn, loading } = useBusiness();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

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
      supabase
        .from("deals")
        .select("id,title,description,price,poster_url,poster_storage_path,end_time")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);
    if (tpl.error) setErr(tpl.error.message);
    else setTemplates((tpl.data ?? []) as TemplateRow[]);
    if (dl.error) setErr(dl.error.message);
    else setDeals((dl.data ?? []) as DealRow[]);
  }, [businessId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function openTemplate(row: TemplateRow) {
    router.push({ pathname: "/create/ai", params: { templateId: row.id } } as Href);
  }

  function repeatDeal(row: DealRow) {
    const title = row.title?.trim() ?? "";
    const hint = row.description?.trim() ?? "";
    const price = row.price != null && Number.isFinite(Number(row.price)) ? String(row.price) : "";
    router.push({
      pathname: "/create/ai",
      params: {
        prefillTitle: title,
        prefillHint: hint || title,
        prefillPrice: price,
        fromReuse: "1",
      },
    } as Href);
  }

  return (
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("reuseHub.title")}</Text>
      <Text style={{ marginTop: 6, opacity: 0.65, fontSize: 15, lineHeight: 22 }}>{t("reuseHub.subtitle")}</Text>
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
                <Pressable
                  key={row.id}
                  onPress={() => openTemplate(row)}
                  style={{
                    flexDirection: "row",
                    gap: Spacing.md,
                    padding: Spacing.md,
                    borderRadius: 16,
                    backgroundColor: "#fafafa",
                    borderWidth: 1,
                    borderColor: "#eee",
                    marginBottom: Spacing.sm,
                  }}
                >
                  {tplPoster ? (
                    <Image
                      source={{ uri: tplPoster }}
                      style={{ width: 72, height: 72, borderRadius: 12 }}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={{ width: 72, height: 72, borderRadius: 12, backgroundColor: "#e5e5e5" }} />
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: "700", fontSize: 16 }} numberOfLines={2}>
                      {row.title ?? t("reuseHub.untitled")}
                    </Text>
                    <Text style={{ marginTop: 4, fontSize: 13, opacity: 0.55 }}>{t("reuseHub.openInAiAds")}</Text>
                  </View>
                </Pressable>
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
                    backgroundColor: "#fff",
                    borderWidth: 1,
                    borderColor: "#eee",
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
                    <View style={{ width: 72, height: 72, borderRadius: 12, backgroundColor: "#e5e5e5" }} />
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: "700", fontSize: 16 }} numberOfLines={2}>
                      {row.title ?? t("reuseHub.untitled")}
                    </Text>
                    {row.price != null ? (
                      <Text style={{ marginTop: 4, fontSize: 14, opacity: 0.7 }}>${Number(row.price).toFixed(2)}</Text>
                    ) : null}
                    <Text style={{ marginTop: 4, fontSize: 13, fontWeight: "600", color: "#2563eb" }}>
                      {t("reuseHub.repeatCta")}
                    </Text>
                  </View>
                </Pressable>
              );
              })
            )}
          </View>

          <Pressable onPress={() => router.push("/create/ai" as Href)} style={{ paddingVertical: Spacing.md }}>
            <Text style={{ fontWeight: "700", color: "#2563eb" }}>{t("reuseHub.backToCreate")}</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}
