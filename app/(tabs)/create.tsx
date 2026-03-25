import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { useBusiness } from "../../hooks/use-business";
import { PrimaryButton } from "../../components/ui/primary-button";
import { Banner } from "../../components/ui/banner";
import { Image } from "expo-image";

export default function CreateDeal() {
  const { t } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const router = useRouter();
  const { isLoggedIn, businessId, loading } = useBusiness();
  const [banner, setBanner] = useState<string | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

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
      if (!error) {
        setTemplates(data ?? []);
      }
      setTemplatesLoading(false);
    })();
  }, [businessId]);

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("createHub.title")}</Text>
      {banner ? <Banner message={banner} tone="error" /> : null}

      {!isLoggedIn ? (
        <View style={{ marginTop: Spacing.lg }}>
          <Text style={{ opacity: 0.7 }}>{t("createHub.loginPrompt")}</Text>
        </View>
      ) : loading ? (
        <View style={{ marginTop: Spacing.lg }}>
          <Text style={{ opacity: 0.7 }}>{t("createHub.loading")}</Text>
        </View>
      ) : !businessId ? (
        <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("createHub.createBusinessHeader")}</Text>
          <Text style={{ opacity: 0.7 }}>{t("createHub.createBusinessBody")}</Text>
          <PrimaryButton
            title={t("account.startBusinessSetup")}
            onPress={() => router.push("/business-setup" as Href)}
          />
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
              borderRadius: 18,
              padding: Spacing.lg,
              backgroundColor: "#111",
            }}
          >
            <Text style={{ color: "white", fontSize: 17, fontWeight: "700" }}>{t("createHub.quickDealTitle")}</Text>
            <Text style={{ color: "white", opacity: 0.85, marginTop: Spacing.sm, fontSize: 15, lineHeight: 22 }}>
              {t("createHub.quickDealSubtitle")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/create/ai-compose")}
            style={{
              borderRadius: 18,
              padding: Spacing.lg,
              backgroundColor: "#1e3a5f",
            }}
          >
            <Text style={{ color: "white", fontSize: 17, fontWeight: "700" }}>{t("createHub.aiComposeTitle")}</Text>
            <Text style={{ color: "white", opacity: 0.88, marginTop: Spacing.sm, fontSize: 15, lineHeight: 22 }}>
              {t("createHub.aiComposeSubtitle")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/create/reuse")}
            style={{
              borderRadius: 18,
              padding: Spacing.md,
              backgroundColor: "#f4f4f5",
              borderWidth: 1,
              borderColor: "#e4e4e7",
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
              borderRadius: 18,
              padding: Spacing.lg,
              backgroundColor: "#eee",
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
              templates.map((tpl) => (
                <Pressable
                  key={tpl.id}
                  onPress={() => router.push({ pathname: "/create/ai", params: { templateId: tpl.id } })}
                  style={{
                    borderRadius: 18,
                    backgroundColor: "#fff",
                    padding: Spacing.md,
                    marginBottom: Spacing.md,
                    shadowColor: "#000",
                    shadowOpacity: 0.07,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 3 },
                    elevation: 2,
                  }}
                >
                  {tpl.poster_url ? (
                    <Image
                      source={{ uri: tpl.poster_url }}
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
              ))
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
