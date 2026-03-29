import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useBusiness } from "@/hooks/use-business";
import { adToDealDraft, CREATIVE_LANE_ORDER, type CreativeLane, type GeneratedAd } from "@/lib/ad-variants";
import { useCreateMenuOfferWizard } from "@/lib/create-menu-offer-wizard-context";
import { aiGenerateAdVariantsStructured, getErrorCode } from "@/lib/functions";
import { splitSubheadlineForPromoAndBody } from "@/lib/menu-ad-copy";
import { looksLikeMissingMenuTable } from "@/lib/menu-workflow-errors";
import {
  buildOfferHintText,
  buildStructuredOffer,
  type MenuOfferPairingType,
} from "@/lib/menu-offer";
import { resolveDealFlowLanguage } from "@/lib/translate-deal-quality";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { supabase } from "@/lib/supabase";
import { Colors, Radii } from "@/constants/theme";

type DbMenuItem = {
  id: string;
  name: string;
  category: string | null;
  price_text: string | null;
};

type WizardStep = "main" | "paired" | "pairing" | "generate" | "ads";

function laneUiTitle(lane: CreativeLane, t: (k: string) => string): string {
  if (lane === "value") return t("menuOffer.laneValue");
  if (lane === "neighborhood") return t("menuOffer.laneNeighborhood");
  return t("menuOffer.lanePremium");
}

export default function MenuOfferScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { businessId, loading: bizLoading, businessContextForAi, businessPreferredLocale } =
    useBusiness();
  const dealLang = resolveDealFlowLanguage(businessPreferredLocale, i18n.language);

  const {
    structuredOffer,
    setStructuredOffer,
    setGenerationResult,
    adsWorking,
    clearWizard,
  } = useCreateMenuOfferWizard();

  const [items, setItems] = useState<DbMenuItem[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>("main");
  const [mainItem, setMainItem] = useState<DbMenuItem | null>(null);
  const [pairedItem, setPairedItem] = useState<DbMenuItem | null>(null);
  const [pairingType, setPairingType] = useState<MenuOfferPairingType>("free_with_purchase");
  const [generating, setGenerating] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" } | null>(
    null,
  );

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("business_menu_items")
        .select("id,name,category,price_text")
        .eq("business_id", businessId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        setLoadErr(
          looksLikeMissingMenuTable(error.message) ? t("menuWorkflow.errSchema") : error.message,
        );
        return;
      }
      setItems((data ?? []) as DbMenuItem[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, t]);

  const runGenerate = useCallback(async () => {
    if (!businessId || !structuredOffer) return;
    setGenerating(true);
    setBanner(null);
    try {
      const hint = buildOfferHintText(structuredOffer);
      const { ads } = await aiGenerateAdVariantsStructured({
        business_id: businessId,
        structured_offer: structuredOffer as unknown as Record<string, unknown>,
        hint_text: hint,
        business_context: businessContextForAi,
        output_language: dealLang,
        regeneration_attempt: 0,
      });
      setGenerationResult(ads);
      setStep("ads");
    } catch (e) {
      const code = getErrorCode(e);
      const fallback = e instanceof Error ? e.message : t("menuOffer.errGenerate");
      setBanner({
        message: code === "MONTHLY_LIMIT" ? t("menuWorkflow.errMonthlyLimit") : fallback,
        tone: "error",
      });
    } finally {
      setGenerating(false);
    }
  }, [businessId, structuredOffer, businessContextForAi, dealLang, setGenerationResult, t]);

  const goQuickPublish = useCallback(
    (ad: GeneratedAd) => {
      if (!structuredOffer) return;
      const hint = buildOfferHintText(structuredOffer);
      const draft = adToDealDraft(ad, hint);
      clearWizard();
      router.push({
        pathname: "/create/quick",
        params: {
          prefillTitle: draft.title,
          prefillHint: draft.offer_details,
          fromMenuOffer: "1",
        },
      } as Href);
    },
    [structuredOffer, clearWizard, router],
  );

  const onPairingNext = useCallback(() => {
    if (!mainItem) return;
    const offer = buildStructuredOffer({
      main: { id: mainItem.id, name: mainItem.name },
      paired: pairedItem ? { id: pairedItem.id, name: pairedItem.name } : null,
      pairing_type: pairingType,
    });
    setStructuredOffer(offer);
    setStep("generate");
  }, [mainItem, pairedItem, pairingType, setStructuredOffer]);

  if (bizLoading) {
    return (
      <View style={{ flex: 1, paddingTop: top, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!businessId) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal }}>
        <Text>{t("menuScan.needBusiness")}</Text>
      </View>
    );
  }

  const pairingOptions: { id: MenuOfferPairingType; label: string }[] = [
    { id: "free_with_purchase", label: t("menuOffer.pairFree") },
    { id: "bogo_pair", label: t("menuOffer.pairBogo") },
    { id: "second_half_off", label: t("menuOffer.pairHalf") },
  ];

  return (
    <ScrollView
      style={{ flex: 1, paddingTop: top }}
      contentContainerStyle={{
        paddingHorizontal: horizontal,
        paddingBottom: scrollBottom,
        gap: Spacing.md,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ fontSize: 22, fontWeight: "700" }}>{t("menuOffer.title")}</Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}
      {loadErr ? <Banner message={loadErr} tone="error" /> : null}

      {items.length === 0 && !loadErr ? (
        <Text style={{ opacity: 0.75 }}>{t("menuOffer.emptyMenu")}</Text>
      ) : null}

      {step === "main" && items.length > 0 ? (
        <View style={{ gap: Spacing.sm }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("menuOffer.stepMain")}</Text>
          <FlatList
            data={items}
            keyExtractor={(it) => it.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  setMainItem(item);
                  setStep("paired");
                }}
                style={{
                  padding: Spacing.md,
                  borderRadius: Radii.md,
                  borderWidth: 1,
                  borderColor: Colors.light.border,
                  marginBottom: Spacing.sm,
                  backgroundColor: Colors.light.surface,
                }}
              >
                <Text style={{ fontWeight: "700" }}>{item.name}</Text>
                {item.price_text ? (
                  <Text style={{ opacity: 0.7, marginTop: 4 }}>{item.price_text}</Text>
                ) : null}
              </Pressable>
            )}
          />
        </View>
      ) : null}

      {step === "paired" && mainItem ? (
        <View style={{ gap: Spacing.sm }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("menuOffer.stepPaired")}</Text>
          <SecondaryButton
            title={t("menuOffer.skipPaired")}
            onPress={() => {
              setPairedItem(null);
              setStep("pairing");
            }}
          />
          <FlatList
            data={items.filter((i) => i.id !== mainItem.id)}
            keyExtractor={(it) => it.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  setPairedItem(item);
                  setStep("pairing");
                }}
                style={{
                  padding: Spacing.md,
                  borderRadius: Radii.md,
                  borderWidth: 1,
                  borderColor: Colors.light.border,
                  marginBottom: Spacing.sm,
                  backgroundColor: Colors.light.surface,
                }}
              >
                <Text style={{ fontWeight: "700" }}>{item.name}</Text>
              </Pressable>
            )}
          />
          <SecondaryButton title={t("menuOffer.back")} onPress={() => setStep("main")} />
        </View>
      ) : null}

      {step === "pairing" && mainItem ? (
        <View style={{ gap: Spacing.md }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("menuOffer.stepPairing")}</Text>
          {pairingOptions.map((opt) => (
            <Pressable
              key={opt.id}
              onPress={() => setPairingType(opt.id)}
              style={{
                padding: Spacing.md,
                borderRadius: Radii.md,
                borderWidth: pairingType === opt.id ? 2 : 1,
                borderColor: pairingType === opt.id ? Colors.light.primary : Colors.light.border,
                backgroundColor: "#fff",
              }}
            >
              <Text style={{ fontWeight: "600" }}>{opt.label}</Text>
            </Pressable>
          ))}
          <PrimaryButton title={t("menuOffer.next")} onPress={onPairingNext} />
          <SecondaryButton title={t("menuOffer.back")} onPress={() => setStep("paired")} />
        </View>
      ) : null}

      {step === "generate" && structuredOffer ? (
        <View style={{ gap: Spacing.md }}>
          <Text style={{ opacity: 0.85 }}>{buildOfferHintText(structuredOffer)}</Text>
          <PrimaryButton
            title={generating ? t("menuOffer.generating") : t("menuOffer.generate")}
            onPress={() => void runGenerate()}
            disabled={generating}
          />
          <SecondaryButton title={t("menuOffer.back")} onPress={() => setStep("pairing")} />
        </View>
      ) : null}

      {step === "ads" && adsWorking && adsWorking.length === 3 ? (
        <View style={{ gap: Spacing.md }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("menuOffer.pickTitle")}</Text>
          <Text style={{ opacity: 0.7 }}>{t("menuOffer.pickHelp")}</Text>
          {adsWorking.map((ad, index) => {
            const laneKey = (ad.creative_lane ?? CREATIVE_LANE_ORDER[index]) as CreativeLane;
            const subSplit = splitSubheadlineForPromoAndBody(ad.subheadline ?? "");
            return (
              <View
                key={`${ad.creative_lane}-${index}`}
                style={{
                  borderRadius: Radii.lg,
                  padding: Spacing.md,
                  borderWidth: 1,
                  borderColor: Colors.light.border,
                  backgroundColor: "#fff",
                  gap: Spacing.sm,
                }}
              >
                <Text
                  style={{
                    alignSelf: "flex-start",
                    fontSize: 11,
                    fontWeight: "800",
                    color: "#fff",
                    backgroundColor: "#111",
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 999,
                    overflow: "hidden",
                  }}
                >
                  {laneUiTitle(laneKey, t)}
                </Text>
                <Text style={{ fontSize: 17, fontWeight: "800" }}>{ad.headline}</Text>
                {subSplit.bodyCopy ? (
                  <>
                    <Text style={{ fontSize: 12, fontWeight: "700", opacity: 0.55 }}>
                      {t("menuOffer.promoLineLabel")}
                    </Text>
                    <Text style={{ opacity: 0.85 }}>{subSplit.promoLine}</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", opacity: 0.55, marginTop: 4 }}>
                      {t("menuOffer.bodyCopyLabel")}
                    </Text>
                    <Text style={{ opacity: 0.8 }}>{subSplit.bodyCopy}</Text>
                  </>
                ) : (
                  <Text style={{ opacity: 0.85 }}>{ad.subheadline}</Text>
                )}
                <Text style={{ fontWeight: "700" }}>{ad.cta}</Text>
                {ad.visual_direction?.trim() ? (
                  <Text style={{ fontSize: 12, opacity: 0.55 }}>
                    {t("menuOffer.visualNote", { note: ad.visual_direction })}
                  </Text>
                ) : null}
                <PrimaryButton
                  title={t("menuOffer.useQuick")}
                  onPress={() => goQuickPublish(ad)}
                  style={{ marginTop: Spacing.sm }}
                />
                <SecondaryButton
                  title={t("menuOffer.refineAi")}
                  onPress={() =>
                    router.push({
                      pathname: "/create/ad-refine",
                      params: { variantIndex: String(index) },
                    } as Href)
                  }
                />
              </View>
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );
}
