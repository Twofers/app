import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useBusiness } from "@/hooks/use-business";
import { useBusinessLocations } from "@/hooks/use-business-locations";
import { CREATIVE_LANE_ORDER, type CreativeLane, type GeneratedAd } from "@/lib/ad-variants";
import { useCreateMenuOfferWizard } from "@/lib/create-menu-offer-wizard-context";
import { aiGenerateAdVariantsStructured, getErrorCode } from "@/lib/functions";
import { splitSubheadlineForPromoAndBody } from "@/lib/menu-ad-copy";
import { buildQuickPrefillFromMenuOffer } from "@/lib/menu-offer-prefill";
import { looksLikeMissingMenuTable } from "@/lib/menu-workflow-errors";
import {
  loadLastMenuOfferPairingType,
  saveLastMenuOfferPairingType,
} from "@/lib/menu-offer-persist";
import {
  buildOfferHintText,
  buildStructuredOffer,
  type MenuOfferPairingType,
} from "@/lib/menu-offer";
import { validateMenuOfferCanonicalSummary } from "@/lib/strong-deal-guard";
import { resolveDealFlowLanguage } from "@/lib/translate-deal-quality";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { supabase } from "@/lib/supabase";
import { Colors, Radii } from "@/constants/theme";

type DbMenuItem = {
  id: string;
  name: string;
  category: string | null;
  price_text: string | null;
  archived_at?: string | null;
};

type WizardStep =
  | "location"
  | "main"
  | "paired"
  | "pairing"
  | "generate"
  | "ads";

function laneUiTitle(lane: CreativeLane, t: (k: string) => string): string {
  if (lane === "value") return t("menuOffer.laneValue");
  if (lane === "neighborhood") return t("menuOffer.laneNeighborhood");
  return t("menuOffer.lanePremium");
}

function resolveCreativeLane(ad: GeneratedAd, index: number): CreativeLane {
  if (ad.creative_lane === "value" || ad.creative_lane === "neighborhood" || ad.creative_lane === "premium") {
    return ad.creative_lane;
  }
  return CREATIVE_LANE_ORDER[index] ?? "value";
}

function getPairingValidationError(params: {
  pairingType: MenuOfferPairingType;
  discountPercent: number;
  fixedPriceText: string;
  pairedItem: DbMenuItem | null;
}): "menuOffer.errPercentWeak" | "menuOffer.errFixedPrice" | "menuOffer.errNeedPairedFree" | null {
  const { pairingType, discountPercent, fixedPriceText, pairedItem } = params;
  if (pairingType === "percent_off" && discountPercent < 40) return "menuOffer.errPercentWeak";
  if (pairingType === "fixed_price_special") {
    const n = Number(fixedPriceText.trim());
    if (!Number.isFinite(n) || n <= 0) return "menuOffer.errFixedPrice";
  }
  if (pairingType === "free_with_purchase" && !pairedItem) return "menuOffer.errNeedPairedFree";
  return null;
}

export default function MenuOfferScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const {
    businessId,
    loading: bizLoading,
    businessContextForAi,
    businessPreferredLocale,
    subscriptionTier,
  } = useBusiness();
  const { visibleLocations, loading: locLoading, error: locErr } = useBusinessLocations(
    businessId,
    subscriptionTier,
  );
  const dealLang = resolveDealFlowLanguage(businessPreferredLocale, i18n.language);

  const {
    dealLocationIds,
    setDealLocationIds,
    structuredOffer,
    setStructuredOffer,
    setGenerationResult,
    adsWorking,
    clearWizard,
  } = useCreateMenuOfferWizard();

  const [items, setItems] = useState<DbMenuItem[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>("location");
  const [mainItem, setMainItem] = useState<DbMenuItem | null>(null);
  const [pairedItem, setPairedItem] = useState<DbMenuItem | null>(null);
  const [pairingType, setPairingType] = useState<MenuOfferPairingType>("free_with_purchase");
  const [primaryLocationId, setPrimaryLocationId] = useState<string | null>(null);
  const [applyMultiLocation, setApplyMultiLocation] = useState(false);
  const [extraLocationIds, setExtraLocationIds] = useState<Set<string>>(new Set());
  const [discountPercent, setDiscountPercent] = useState(50);
  const [fixedPriceText, setFixedPriceText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" } | null>(
    null,
  );
  const pairingPersistReady = useRef(false);

  useEffect(() => {
    void loadLastMenuOfferPairingType().then((saved) => {
      if (saved) setPairingType(saved);
      pairingPersistReady.current = true;
    });
  }, []);

  useEffect(() => {
    if (!pairingPersistReady.current) return;
    void saveLastMenuOfferPairingType(pairingType);
  }, [pairingType]);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("business_menu_items")
        .select("id,name,category,price_text,archived_at")
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
      const rows = (data ?? []) as DbMenuItem[];
      setItems(rows.filter((r) => !r.archived_at));
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, t]);

  useEffect(() => {
    if (visibleLocations.length === 1) {
      setPrimaryLocationId(visibleLocations[0].id);
    }
  }, [visibleLocations]);

  const runGenerate = useCallback(async () => {
    if (!businessId || !structuredOffer) return;
    const strong = validateMenuOfferCanonicalSummary({
      human_summary: structuredOffer.human_summary,
      discount_percent: structuredOffer.discount_percent,
    });
    if (!strong.ok) {
      setBanner({ message: strong.message, tone: "error" });
      return;
    }
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

  const goAiPublish = useCallback(
    (ad: GeneratedAd) => {
      if (!structuredOffer) return;
      const locPrimary = dealLocationIds[0];
      const params = buildQuickPrefillFromMenuOffer(ad, locPrimary);
      clearWizard();
      router.push({
        pathname: "/create/quick",
        params,
      } as Href);
    },
    [structuredOffer, dealLocationIds, clearWizard, router],
  );

  const onLocationNext = useCallback(() => {
    if (!primaryLocationId) {
      setBanner({ message: t("menuOffer.pickLocation"), tone: "error" });
      return;
    }
    const extras = applyMultiLocation ? Array.from(extraLocationIds).filter((id) => id !== primaryLocationId) : [];
    setDealLocationIds([primaryLocationId, ...extras]);
    setBanner(null);
    setStep("main");
  }, [primaryLocationId, applyMultiLocation, extraLocationIds, setDealLocationIds, t]);

  const onPairingNext = useCallback(() => {
    if (!mainItem) return;
    const validationError = getPairingValidationError({
      pairingType,
      discountPercent,
      fixedPriceText,
      pairedItem,
    });
    if (validationError) {
      setBanner({ message: t(validationError), tone: "error" });
      return;
    }
    setBanner(null);
    const offer = buildStructuredOffer({
      main: { id: mainItem.id, name: mainItem.name },
      paired: pairedItem ? { id: pairedItem.id, name: pairedItem.name } : null,
      pairing_type: pairingType,
      discount_percent: pairingType === "percent_off" ? discountPercent : undefined,
      fixed_price_amount:
        pairingType === "fixed_price_special" ? Number(fixedPriceText.trim()) : undefined,
    });
    const strong = validateMenuOfferCanonicalSummary({
      human_summary: offer.human_summary,
      discount_percent: offer.discount_percent,
    });
    if (!strong.ok) {
      setBanner({ message: strong.message, tone: "error" });
      return;
    }
    setStructuredOffer(offer);
    setStep("generate");
  }, [
    mainItem,
    pairedItem,
    pairingType,
    discountPercent,
    fixedPriceText,
    setStructuredOffer,
    t,
  ]);

  if (bizLoading || locLoading) {
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
    { id: "percent_off", label: t("menuOffer.pairPercent") },
    { id: "fixed_price_special", label: t("menuOffer.pairFixed") },
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
      {locErr ? <Banner message={locErr} tone="error" /> : null}

      {step === "location" && visibleLocations.length > 0 ? (
        <View style={{ gap: Spacing.sm }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("menuOffer.stepLocation")}</Text>
          <Text style={{ opacity: 0.7 }}>{t("menuOffer.locationHelp")}</Text>
          {visibleLocations.map((loc) => (
            <Pressable
              key={loc.id}
              onPress={() => setPrimaryLocationId(loc.id)}
              style={{
                padding: Spacing.md,
                borderRadius: Radii.md,
                borderWidth: primaryLocationId === loc.id ? 2 : 1,
                borderColor: primaryLocationId === loc.id ? Colors.light.primary : Colors.light.border,
                backgroundColor: Colors.light.surface,
              }}
            >
              <Text style={{ fontWeight: "700" }}>{loc.name}</Text>
              <Text style={{ opacity: 0.65, marginTop: 4 }}>{loc.address}</Text>
            </Pressable>
          ))}
          {subscriptionTier === "premium" && visibleLocations.length > 1 ? (
            <View style={{ marginTop: Spacing.sm, gap: Spacing.sm }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: Spacing.md,
                }}
              >
                <Text style={{ flex: 1, fontWeight: "600" }}>{t("menuOffer.multiLocationToggle")}</Text>
                <Switch value={applyMultiLocation} onValueChange={setApplyMultiLocation} />
              </View>
              {applyMultiLocation
                ? visibleLocations
                    .filter((l) => l.id !== primaryLocationId)
                    .map((loc) => (
                      <Pressable
                        key={loc.id}
                        onPress={() => {
                          setExtraLocationIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(loc.id)) next.delete(loc.id);
                            else next.add(loc.id);
                            return next;
                          });
                        }}
                        style={{
                          padding: Spacing.sm,
                          borderRadius: Radii.md,
                          borderWidth: extraLocationIds.has(loc.id) ? 2 : 1,
                          borderColor: extraLocationIds.has(loc.id)
                            ? Colors.light.primary
                            : Colors.light.border,
                          backgroundColor: Colors.light.surface,
                        }}
                      >
                        <Text style={{ fontWeight: "600" }}>{loc.name}</Text>
                      </Pressable>
                    ))
                : null}
            </View>
          ) : null}
          <PrimaryButton title={t("menuOffer.next")} onPress={onLocationNext} />
        </View>
      ) : null}

      {items.length === 0 && !loadErr && step === "main" ? (
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
          <SecondaryButton title={t("menuOffer.back")} onPress={() => setStep("location")} />
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
          <SecondaryButton
            title={t("menuOffer.sameItemPaired")}
            onPress={() => {
              if (!mainItem) return;
              setPairedItem(mainItem);
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
          {pairingType === "percent_off" ? (
            <View style={{ gap: Spacing.sm }}>
              <Text style={{ fontWeight: "600" }}>{t("menuOffer.percentOffLabel")}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm }}>
                {[40, 50, 100].map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => setDiscountPercent(p)}
                    style={{
                      paddingHorizontal: Spacing.md,
                      paddingVertical: Spacing.sm,
                      borderRadius: Radii.md,
                      borderWidth: discountPercent === p ? 2 : 1,
                      borderColor: discountPercent === p ? Colors.light.primary : Colors.light.border,
                      backgroundColor: Colors.light.surface,
                    }}
                  >
                    <Text style={{ fontWeight: "600" }}>{p}%</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {pairingType === "fixed_price_special" ? (
            <View>
              <Text style={{ fontWeight: "600" }}>{t("menuOffer.fixedPriceLabel")}</Text>
              <TextInput
                value={fixedPriceText}
                onChangeText={setFixedPriceText}
                keyboardType="decimal-pad"
                placeholder={t("menuOffer.fixedPricePlaceholder")}
                style={{
                  borderWidth: 1,
                  borderColor: Colors.light.border,
                  borderRadius: Radii.md,
                  padding: Spacing.md,
                  marginTop: 6,
                  fontSize: 16,
                  backgroundColor: Colors.light.surface,
                }}
              />
            </View>
          ) : null}
          <PrimaryButton title={t("menuOffer.next")} onPress={onPairingNext} />
          <SecondaryButton title={t("menuOffer.back")} onPress={() => setStep("paired")} />
        </View>
      ) : null}

      {step === "generate" && structuredOffer ? (
        <View style={{ gap: Spacing.md }}>
          <View
            style={{
              borderRadius: Radii.lg,
              padding: Spacing.lg,
              backgroundColor: Colors.light.surface,
              borderWidth: 1,
              borderColor: Colors.light.border,
              gap: Spacing.md,
              boxShadow: "0px 8px 24px rgba(0,0,0,0.08)",
              elevation: 5,
            }}
          >
            <Text style={{ fontSize: 20, fontWeight: "800" }}>{t("menuOffer.generateStrongHeadline")}</Text>
            <Text style={{ opacity: 0.88, fontSize: 16, fontWeight: "600" }}>
              {buildOfferHintText(structuredOffer)}
            </Text>
            <Text style={{ opacity: 0.72, fontSize: 14 }}>{t("menuOffer.generateStrongSubtitle")}</Text>
            <PrimaryButton
              title={
                generating ? t("menuOffer.generatingStrongVariants") : t("menuOffer.generateStrongVariants")
              }
              onPress={() => void runGenerate()}
              disabled={generating}
              style={{ minHeight: 64 }}
            />
          </View>
          <SecondaryButton title={t("menuOffer.back")} onPress={() => setStep("pairing")} />
        </View>
      ) : null}

      {step === "ads" && adsWorking?.length === 3 ? (
        <View style={{ gap: Spacing.md }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("menuOffer.pickTitle")}</Text>
          <Text style={{ opacity: 0.7 }}>{t("menuOffer.pickHelp")}</Text>
          <Text style={{ opacity: 0.65, fontSize: 13 }}>{t("menuOffer.adsOptionalRefine")}</Text>
          {adsWorking.map((ad, index) => {
            const laneKey = resolveCreativeLane(ad, index);
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
                  title={t("menuOffer.useAiPublish")}
                  onPress={() => goAiPublish(ad)}
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
