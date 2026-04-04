import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { CardShell } from "@/components/ui/card-shell";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { useBusiness } from "../../hooks/use-business";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { Banner } from "../../components/ui/banner";
import { Image } from "expo-image";
import { resolveDealPosterDisplayUri } from "../../lib/deal-poster-url";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { getBusinessProfileAccessForCurrentUser } from "@/lib/business-profile-access";
import { canCreateDeal, isBillingBypassEnabled } from "@/lib/billing/access";
import { aiGenerateDealCopy } from "../../lib/functions";

export default function CreateDeal() {
  const { t } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const router = useRouter();
  const params = useLocalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const { isLoggedIn, businessId, businessName, loading, subscriptionStatus, trialEndsAt } = useBusiness();
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" } | null>(null);
  const [templates, setTemplates] = useState<{ id: string; title: string | null; description: string | null; poster_url: string | null; price: number | null }[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [profileCheckLoading, setProfileCheckLoading] = useState(false);
  const [hasBusinessProfileAccess, setHasBusinessProfileAccess] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const [offerText, setOfferText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

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
  }, [businessId, t]);

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
            message={t("billing.paywallExpiredMessage", {
              defaultValue:
                "Your trial has ended. Reactivate your account to continue creating deals.",
            })}
          />
          <PrimaryButton
            title={t("billing.goToBilling", { defaultValue: "Go to Billing" })}
            onPress={() =>
              router.replace({
                pathname: "/(tabs)/billing",
                params: { reason: "reactivate" },
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
          {/* ── Single "Create Deal" entry point ────────── */}
          <View
            style={{
              borderRadius: Radii.lg,
              padding: Spacing.lg,
              backgroundColor: Colors.light.surface,
              borderWidth: 2,
              borderColor: Colors.light.primary,
              boxShadow: "0px 4px 10px rgba(0,0,0,0.12)",
              elevation: 4,
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 16, color: theme.text, marginBottom: Spacing.sm }}>
              {t("createHub.offerInputLabel")}
            </Text>
            <TextInput
              value={offerText}
              onChangeText={setOfferText}
              placeholder={t("createHub.offerInputPlaceholder")}
              placeholderTextColor="#999"
              multiline
              editable={!aiLoading}
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.lg,
                padding: Spacing.md,
                minHeight: 72,
                textAlignVertical: "top",
                fontSize: 16,
                backgroundColor: "#fff",
              }}
            />
            <View style={{ marginTop: Spacing.md }}>
              <PrimaryButton
                title={aiLoading ? t("createHub.creatingDeal") : t("createHub.createDealButton")}
                disabled={aiLoading}
                onPress={async () => {
                  const text = offerText.trim();
                  if (!text) {
                    setBanner({ message: t("createHub.errOfferEmpty"), tone: "error" });
                    return;
                  }
                  setBanner(null);
                  setAiLoading(true);
                  try {
                    const result = await aiGenerateDealCopy({
                      hint_text: text,
                      business_name: businessName ?? undefined,
                      business_id: businessId ?? undefined,
                    });
                    setOfferText("");
                    router.push({
                      pathname: "/create/quick",
                      params: {
                        prefillTitle: result.title,
                        prefillHint: result.description,
                        fromCreateHub: "1",
                      },
                    });
                  } catch (_err) {
                    setBanner({ message: t("createHub.errAiCreateFailed"), tone: "error" });
                  } finally {
                    setAiLoading(false);
                  }
                }}
              />
            </View>
            {aiLoading ? (
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: Spacing.sm, gap: 8 }}>
                <ActivityIndicator size="small" color={Colors.light.primary} />
                <Text style={{ opacity: 0.6, fontSize: 14 }}>{t("createHub.creatingDeal")}</Text>
              </View>
            ) : null}
            {banner?.tone === "error" ? (
              <View style={{ marginTop: Spacing.sm }}>
                <SecondaryButton
                  title={t("createHub.createManually")}
                  onPress={() => router.push("/create/quick")}
                />
              </View>
            ) : null}
          </View>

          <Pressable
            onPress={() => setMoreToolsOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: moreToolsOpen }}
          >
            <CardShell variant="muted">
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: "800" }}>{t("createHub.moreToolsTitle")}</Text>
              <Text style={{ color: theme.mutedText, marginTop: Spacing.xs, fontSize: 14, fontWeight: "600" }}>
                {moreToolsOpen ? t("createHub.moreToolsHide") : t("createHub.moreToolsShow")}
              </Text>
            </CardShell>
          </Pressable>

          {moreToolsOpen ? (
            <View style={{ gap: Spacing.md }}>
              <Pressable
                onPress={() => router.push("/create/quick")}
                style={{
                  borderRadius: Radii.lg,
                  padding: Spacing.md,
                  backgroundColor: Colors.light.surface,
                  borderWidth: 1,
                  borderColor: Colors.light.border,
                }}
              >
                <Text style={{ color: "#111", fontSize: 16, fontWeight: "700" }}>{t("createHub.quickDealTitle")}</Text>
                <Text style={{ color: "#111", opacity: 0.65, marginTop: Spacing.xs, fontSize: 14, lineHeight: 20 }}>
                  {t("createHub.quickDealSubtitle")}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/create/menu-offer" as Href)}
                style={{
                  borderRadius: Radii.lg,
                  padding: Spacing.md,
                  backgroundColor: Colors.light.surface,
                  borderWidth: 1,
                  borderColor: Colors.light.border,
                }}
              >
                <Text style={{ color: "#111", fontSize: 16, fontWeight: "700" }}>{t("createHub.menuDealFastTitle")}</Text>
                <Text style={{ color: "#111", opacity: 0.65, marginTop: Spacing.xs, fontSize: 14, lineHeight: 20 }}>
                  {t("createHub.menuDealFastSubtitle")}
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
                onPress={() => router.push("/create/menu-manager" as Href)}
                style={{
                  borderRadius: Radii.lg,
                  padding: Spacing.md,
                  backgroundColor: Colors.light.surfaceMuted,
                  borderWidth: 1,
                  borderColor: Colors.light.border,
                }}
              >
                <Text style={{ color: "#111", fontSize: 16, fontWeight: "700" }}>{t("createHub.menuManagerTitle")}</Text>
                <Text style={{ color: "#111", opacity: 0.65, marginTop: Spacing.xs, fontSize: 14, lineHeight: 20 }}>
                  {t("createHub.menuManagerSubtitle")}
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
            </View>
          ) : null}

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
