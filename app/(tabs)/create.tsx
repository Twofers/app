import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useBusiness } from "../../hooks/use-business";
import { PrimaryButton } from "../../components/ui/primary-button";
import { Banner } from "../../components/ui/banner";
import { Image } from "expo-image";

export default function CreateDeal() {
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
      setBanner("Please log in to create a business.");
      return;
    }
    const name = businessName.trim();
    if (!name) {
      setBanner("Business name required.");
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
      setBanner(err?.message ?? "Create business failed.");
    } finally {
      setIsCreatingBusiness(false);
    }
  }

  return (
    <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Create</Text>
      {banner ? <Banner message={banner} tone="error" /> : null}

      {!isLoggedIn ? (
        <View style={{ marginTop: 16 }}>
          <Text style={{ opacity: 0.7 }}>Please log in to create deals.</Text>
        </View>
      ) : loading ? (
        <View style={{ marginTop: 16 }}>
          <Text style={{ opacity: 0.7 }}>Loading...</Text>
        </View>
      ) : !businessId ? (
        <View style={{ marginTop: 16, gap: 12 }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>Create your business</Text>
          <Text style={{ opacity: 0.7 }}>
            Create a business to post deals and redeem QR codes.
          </Text>
          <TextInput
            value={businessName}
            onChangeText={setBusinessName}
            placeholder="Business name"
            autoCapitalize="words"
            style={{
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 10,
              padding: 12,
            }}
          />
          <PrimaryButton
            title={isCreatingBusiness ? "Creating..." : "Create Business"}
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
            <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>Quick Deal</Text>
            <Text style={{ color: "white", opacity: 0.8, marginTop: 6 }}>
              Fast manual deal creation with minimal fields.
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/create/ai")}
            style={{
              borderRadius: 16,
              padding: 16,
              backgroundColor: "#eee",
            }}
          >
            <Text style={{ color: "#111", fontSize: 16, fontWeight: "700" }}>AI Deal</Text>
            <Text style={{ color: "#111", opacity: 0.7, marginTop: 6 }}>
              Photo + a few words. AI creates the ad copy.
            </Text>
          </Pressable>

          <View style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 8 }}>Templates</Text>
            {templatesLoading ? (
              <Text style={{ opacity: 0.7 }}>Loading templates...</Text>
            ) : templates.length === 0 ? (
              <Text style={{ opacity: 0.7 }}>No templates yet. Save one from AI Deal.</Text>
            ) : (
              templates.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => router.push({ pathname: "/create/ai", params: { templateId: t.id } })}
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
                  {t.poster_url ? (
                    <Image
                      source={{ uri: t.poster_url }}
                      style={{ height: 120, width: "100%", borderRadius: 12 }}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={{ height: 120, borderRadius: 12, backgroundColor: "#eee" }} />
                  )}
                  <Text style={{ marginTop: 8, fontWeight: "700" }}>{t.title ?? "Untitled template"}</Text>
                  {t.price != null ? (
                    <Text style={{ marginTop: 4, opacity: 0.7 }}>${Number(t.price).toFixed(2)}</Text>
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
