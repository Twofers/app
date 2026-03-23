import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { useBusiness } from "../../hooks/use-business";
import { PrimaryButton } from "../../components/ui/primary-button";
import { Banner } from "../../components/ui/banner";
import { Image } from "expo-image";

export default function CreateDeal() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isLoggedIn, businessId, userId, loading, refresh } = useBusiness();
  const [businessName, setBusinessName] = useState("");
  const [isCreatingBusiness, setIsCreatingBusiness] = useState(false);
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

  async function createBusiness() {
    if (!userId) {
      setBanner(t("createHub.errLoginBusiness"));
      return;
    }
    const name = businessName.trim();
    if (!name) {
      setBanner(t("createHub.errNameRequired"));
      return;
    }
    setIsCreatingBusiness(true);
    setBanner(null);
    try {
      const { error } = await supabase.from("businesses").insert({ owner_id: userId, name });
      if (error) throw error;
      setBusinessName("");
      await refresh();
      router.replace("/(tabs)/create");
    } catch (err: any) {
      setBanner(err?.message ?? t("createHub.errCreateFailed"));
    } finally {
      setIsCreatingBusiness(false);
    }
  }

  return (
    <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>{t("createHub.title")}</Text>
      {banner ? <Banner message={banner} tone="error" /> : null}

      {!isLoggedIn ? (
        <View style={{ marginTop: 16 }}>
          <Text style={{ opacity: 0.7 }}>{t("createHub.loginPrompt")}</Text>
        </View>
      ) : loading ? (
        <View style={{ marginTop: 16 }}>
          <Text style={{ opacity: 0.7 }}>{t("createHub.loading")}</Text>
        </View>
      ) : !businessId ? (
        <View style={{ marginTop: 16, gap: 12 }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("createHub.createBusinessHeader")}</Text>
          <Text style={{ opacity: 0.7 }}>{t("createHub.createBusinessBody")}</Text>
          <TextInput
            value={businessName}
            onChangeText={setBusinessName}
            placeholder={t("createHub.placeholderBusinessName")}
            autoCapitalize="words"
            style={{
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 10,
              padding: 12,
            }}
          />
          <PrimaryButton
            title={isCreatingBusiness ? t("createHub.creating") : t("createHub.createBusiness")}
            onPress={createBusiness}
            disabled={isCreatingBusiness}
          />
        </View>
      ) : (
        <View style={{ marginTop: 20, gap: 12 }}>
          <Pressable
            onPress={() => router.push("/create/quick")}
            style={{
              borderRadius: 16,
              padding: 16,
              backgroundColor: "#111",
            }}
          >
            <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>{t("createHub.quickDealTitle")}</Text>
            <Text style={{ color: "white", opacity: 0.8, marginTop: 6 }}>{t("createHub.quickDealSubtitle")}</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/create/ai")}
            style={{
              borderRadius: 16,
              padding: 16,
              backgroundColor: "#eee",
            }}
          >
            <Text style={{ color: "#111", fontSize: 16, fontWeight: "700" }}>{t("createHub.aiAdsTitle")}</Text>
            <Text style={{ color: "#111", opacity: 0.7, marginTop: 6 }}>{t("createHub.aiAdsSubtitle")}</Text>
          </Pressable>

          <View style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 8 }}>{t("createHub.templatesTitle")}</Text>
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
                    borderRadius: 16,
                    backgroundColor: "#fff",
                    padding: 12,
                    marginBottom: 10,
                    shadowColor: "#000",
                    shadowOpacity: 0.06,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 3 },
                    elevation: 1,
                  }}
                >
                  {tpl.poster_url ? (
                    <Image
                      source={{ uri: tpl.poster_url }}
                      style={{ height: 120, width: "100%", borderRadius: 12 }}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={{ height: 120, borderRadius: 12, backgroundColor: "#eee" }} />
                  )}
                  <Text style={{ marginTop: 8, fontWeight: "700" }}>{tpl.title ?? t("createHub.templateUntitled")}</Text>
                  {tpl.price != null ? (
                    <Text style={{ marginTop: 4, opacity: 0.7 }}>${Number(tpl.price).toFixed(2)}</Text>
                  ) : null}
                </Pressable>
              ))
            )}
          </View>
        </View>
      )}
    </View>
  );
}
