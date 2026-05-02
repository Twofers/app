import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { useCreateMenuOfferWizard } from "@/lib/create-menu-offer-wizard-context";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";
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
import { useColorScheme } from "@/hooks/use-color-scheme";
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
  | "generate";

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
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
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
        // Schema/migration errors get the dedicated copy; everything else flows through
        // the api-messages translator so RLS, JWT, and Postgres errors render localized.
        setLoadErr(
          looksLikeMissingMenuTable(error.message)
            ? t("menuWorkflow.errSchema")
            : translateKnownApiMessage(error.message, t),
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

  /**
   * Skip in-wizard ad generation. Hand the structured offer to the main create flow,
   * which runs the new single-ad pipeline with the offer text as the AI hint.
   */
  const goToAdCreation = useCallback(() => {
    if (!structuredOffer) return;
    const strong = validateMenuOfferCanonicalSummary({
      human_summary: structuredOffer.human_summary,
      discount_percent: structuredOffer.discount_percent,
    });
    if (!strong.ok) {
      const key = `dealQuality.strongGuard.${strong.reason}`;
      setBanner({ message: t(key, { defaultValue: strong.message }), tone: "error" });
      return;
    }
    const hint = buildOfferHintText(structuredOffer);
    const locPrimary = dealLocationIds[0] ?? "";
    const extras = dealLocationIds.slice(1).join(",");
    clearWizard();
    router.push({
      pathname: "/create/ai",
      params: {
        prefillHint: hint,
        ...(locPrimary ? { prefillLocationId: locPrimary } : {}),
        ...(extras ? { prefillExtraLocationIds: extras } : {}),
        fromMenuOffer: "1",
      },
    } as Href);
  }, [structuredOffer, dealLocationIds, clearWizard, router, t]);

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
      const key = `dealQuality.strongGuard.${strong.reason}`;
      setBanner({ message: t(key, { defaultValue: strong.message }), tone: "error" });
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
                borderColor: primaryLocationId === loc.id ? theme.primary : theme.border,
                backgroundColor: theme.surface,
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
                            ? theme.primary
                            : theme.border,
                          backgroundColor: theme.surface,
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
          {items.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  setMainItem(item);
                  setStep("paired");
                }}
                style={{
                  padding: Spacing.md,
                  borderRadius: Radii.md,
                  borderWidth: 1,
                  borderColor: theme.border,
                  marginBottom: Spacing.sm,
                  backgroundColor: theme.surface,
                }}
              >
                <Text style={{ fontWeight: "700" }}>{item.name}</Text>
                {item.price_text ? (
                  <Text style={{ opacity: 0.7, marginTop: 4 }}>{item.price_text}</Text>
                ) : null}
              </Pressable>
            ))}
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
          {items.filter((i) => i.id !== mainItem.id).map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  setPairedItem(item);
                  setStep("pairing");
                }}
                style={{
                  padding: Spacing.md,
                  borderRadius: Radii.md,
                  borderWidth: 1,
                  borderColor: theme.border,
                  marginBottom: Spacing.sm,
                  backgroundColor: theme.surface,
                }}
              >
                <Text style={{ fontWeight: "700" }}>{item.name}</Text>
              </Pressable>
            ))}
          <SecondaryButton title={t("menuOffer.back")} onPress={() => { setPairedItem(null); setStructuredOffer(null); setStep("main"); }} />
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
                borderColor: pairingType === opt.id ? theme.primary : theme.border,
                backgroundColor: theme.surface,
              }}
            >
              <Text style={{ fontWeight: "600" }}>{opt.label}</Text>
            </Pressable>
          ))}
          {pairingType === "percent_off" ? (
            <View style={{ gap: Spacing.sm }}>
              <Text style={{ fontWeight: "600" }}>{t("menuOffer.percentOffLabel")}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm }}>
                {[40, 50, 75].map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => setDiscountPercent(p)}
                    style={{
                      paddingHorizontal: Spacing.md,
                      paddingVertical: Spacing.sm,
                      borderRadius: Radii.md,
                      borderWidth: discountPercent === p ? 2 : 1,
                      borderColor: discountPercent === p ? theme.primary : theme.border,
                      backgroundColor: theme.surface,
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
                  borderColor: theme.border,
                  borderRadius: Radii.md,
                  padding: Spacing.md,
                  marginTop: 6,
                  fontSize: 16,
                  backgroundColor: theme.surface,
                }}
              />
            </View>
          ) : null}
          <PrimaryButton title={t("menuOffer.next")} onPress={onPairingNext} />
          <SecondaryButton title={t("menuOffer.back")} onPress={() => { setStructuredOffer(null); setStep("paired"); }} />
        </View>
      ) : null}

      {step === "generate" && structuredOffer ? (
        <View style={{ gap: Spacing.md }}>
          <View
            style={{
              borderRadius: Radii.lg,
              padding: Spacing.lg,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
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
              title={t("menuOffer.generateStrongVariants")}
              onPress={goToAdCreation}
              style={{ minHeight: 64 }}
            />
          </View>
          <SecondaryButton title={t("menuOffer.back")} onPress={() => { setStructuredOffer(null); setStep("pairing"); }} />
        </View>
      ) : null}
    </ScrollView>
  );
}
