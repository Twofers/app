import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { BrandedSwitch } from "@/components/ui/branded-switch";
import {
  FORM_SCROLL_KEYBOARD_PROPS,
  IOS_DONE_INPUT_ACCESSORY_ID,
  IosDoneInputAccessory,
  KeyboardScreen,
} from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useBusiness } from "@/hooks/use-business";
import { useBusinessLocations } from "@/hooks/use-business-locations";
import { usePrimaryLocationBillingGate } from "@/hooks/use-primary-location-billing-gate";
import { useCreateMenuOfferWizard } from "@/lib/create-menu-offer-wizard-context";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";
import { looksLikeMissingMenuTable } from "@/lib/menu-workflow-errors";
import {
  loadLastMenuOfferPairingType,
  saveLastMenuOfferPairingType,
} from "@/lib/menu-offer-persist";
import {
  buildOfferAdHintText,
  buildOfferHintText,
  buildStructuredOffer,
  resolveMenuOfferLocationFlow,
  structuredOfferToEligibilityFormState,
  type MenuOfferPairingType,
} from "@/lib/menu-offer";
import { splitMenuItemDescription } from "@/lib/menu-item-text";
import { validateMenuOfferCanonicalSummary } from "@/lib/strong-deal-guard";
import { formatMenuPriceLabel } from "@/lib/display-format";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { supabase } from "@/lib/supabase";
import { Colors, PrimaryTint, Radii } from "@/constants/theme";
import { getSwitchAccessibilityState } from "@/lib/switch-accessibility";

type DbMenuItem = {
  id: string;
  name: string;
  category: string | null;
  price_text: string | null;
  description?: string | null;
  size_options?: string[] | null;
  archived_at?: string | null;
};

type WizardStep =
  | "location"
  | "main"
  | "paired"
  | "pairing"
  | "generate";

function sanitizeDecimalInput(raw: string): string {
  const digitsAndDots = raw.replace(/[^\d.]/g, "");
  const firstDot = digitsAndDots.indexOf(".");
  if (firstDot === -1) return digitsAndDots;
  return `${digitsAndDots.slice(0, firstDot + 1)}${digitsAndDots
    .slice(firstDot + 1)
    .replace(/\./g, "")}`;
}

function getPairingValidationError(params: {
  pairingType: MenuOfferPairingType;
  discountPercent: number;
  pairedItem: DbMenuItem | null;
}): string | null {
  const { pairingType, discountPercent, pairedItem } = params;
  if (pairingType === "second_half_off" || pairingType === "fixed_price_special") {
    return "Twofer only supports free-item offers or 40%+ off one single item.";
  }
  if (pairingType === "percent_off" && discountPercent < 40) return "menuOffer.errPercentWeak";
  if (pairingType === "free_with_purchase" && !pairedItem) return "menuOffer.errNeedPairedFree";
  return null;
}

export default function MenuOfferScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const {
    businessId,
    businessProfile,
    isLoggedIn,
    userId,
    loading: bizLoading,
    subscriptionTier,
  } = useBusiness();
  const { access, loading: accessLoading } = usePrimaryLocationBillingGate({
    businessId,
    businessStatus: businessProfile?.status ?? null,
    subscriptionTier,
    isLoggedIn,
  });
  const { visibleLocations, loading: locLoading, error: locErr } = useBusinessLocations(
    businessId,
    subscriptionTier,
  );

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
  const [mainSize, setMainSize] = useState<string | null>(null);
  const [pairedSize, setPairedSize] = useState<string | null>(null);
  const [pairingType, setPairingType] = useState<MenuOfferPairingType>("free_with_purchase");
  const [primaryLocationId, setPrimaryLocationId] = useState<string | null>(null);
  const [applyMultiLocation, setApplyMultiLocation] = useState(false);
  const [extraLocationIds, setExtraLocationIds] = useState<Set<string>>(new Set());
  const [discountPercent, setDiscountPercent] = useState(50);
  const [fixedPriceText, setFixedPriceText] = useState("");
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" } | null>(
    null,
  );
  const [savingDraft, setSavingDraft] = useState(false);
  const pairingPersistReady = useRef(false);
  const locationFlow = useMemo(
    () => resolveMenuOfferLocationFlow(visibleLocations.map((loc) => loc.id)),
    [visibleLocations],
  );

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
        .select("id,name,category,price_text,description,size_options,archived_at")
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
      // Legacy rows may still be stored as "Name ( long description )" — split
      // here so offer item names (and the deal title built from them) stay
      // short, with the blurb carried as the description instead.
      setItems(
        rows
          .filter((r) => !r.archived_at)
          .map((r) => {
            const split = splitMenuItemDescription(r.name);
            return {
              ...r,
              name: split.name,
              description: r.description?.trim() || split.description,
            };
          }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, t]);

  useEffect(() => {
    if (locationFlow === "skip") {
      const id = visibleLocations[0]?.id;
      if (!id) return;
      setPrimaryLocationId(id);
      setApplyMultiLocation(false);
      setExtraLocationIds(new Set());
      setDealLocationIds([id]);
      setStep((current) => (current === "location" ? "main" : current));
      return;
    }

    if (locationFlow === "setup") {
      setPrimaryLocationId(null);
      setApplyMultiLocation(false);
      setExtraLocationIds(new Set());
      setDealLocationIds([]);
      setStep("location");
      return;
    }

    setPrimaryLocationId((prev) =>
      prev && visibleLocations.some((loc) => loc.id === prev) ? prev : visibleLocations[0]?.id ?? null,
    );
  }, [locationFlow, visibleLocations, setDealLocationIds]);

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
    // Enriched hint carries each item's menu description as flavor for the AI
    // copywriter; the authoritative offer facts still come from the eligibility
    // prefill below, so item names stay clean.
    const hint = buildOfferAdHintText(structuredOffer);
    const prefillDealEligibility = JSON.stringify(structuredOfferToEligibilityFormState(structuredOffer));
    const locPrimary = dealLocationIds[0] ?? "";
    const extras = dealLocationIds.slice(1).join(",");
    clearWizard();
    router.push({
      pathname: "/create/ai",
      params: {
        prefillHint: hint,
        ...(locPrimary ? { prefillLocationId: locPrimary } : {}),
        ...(extras ? { prefillExtraLocationIds: extras } : {}),
        prefillDealEligibility,
        fromMenuOffer: "1",
      },
    } as Href);
  }, [structuredOffer, dealLocationIds, clearWizard, router, t]);

  const saveTextDraft = useCallback(async () => {
    if (!structuredOffer || !businessId || !userId || savingDraft) return;
    setSavingDraft(true);
    setBanner(null);
    try {
      const payload = {
        structured_offer: structuredOffer,
        offer_hint: buildOfferHintText(structuredOffer),
        location_ids: dealLocationIds,
        saved_at: new Date().toISOString(),
      };
      const { data: existing, error: readError } = await supabase
        .from("business_deal_drafts")
        .select("id")
        .eq("business_id", businessId)
        .eq("source", "menu_offer")
        .eq("status", "draft")
        .maybeSingle();
      if (readError) throw readError;
      const write = existing?.id
        ? supabase
            .from("business_deal_drafts")
            .update({ payload, updated_at: new Date().toISOString() })
            .eq("id", existing.id)
        : supabase.from("business_deal_drafts").insert({
            business_id: businessId,
            owner_user_id: userId,
            draft_type: "text_only",
            source: "menu_offer",
            payload,
            status: "draft",
          });
      const { error: writeError } = await write;
      if (writeError) throw writeError;
      clearWizard();
      setBanner({ message: t("menuOffer.textDraftSaved"), tone: "success" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setBanner({
        message: message
          ? translateKnownApiMessage(message, t)
          : t("menuOffer.textDraftSaveFailed"),
        tone: "error",
      });
    } finally {
      setSavingDraft(false);
    }
  }, [businessId, clearWizard, dealLocationIds, savingDraft, structuredOffer, t, userId]);

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

  const goBackFromMainStep = useCallback(() => {
    if (locationFlow === "select") {
      setStep("location");
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/create" as Href);
  }, [locationFlow, router]);

  const onPairingNext = useCallback(() => {
    if (!mainItem) return;
    const validationError = getPairingValidationError({
      pairingType,
      discountPercent,
      pairedItem,
    });
    if (validationError) {
      setBanner({
        message: validationError.startsWith("menuOffer.") ? t(validationError) : validationError,
        tone: "error",
      });
      return;
    }
    setBanner(null);
    const offer = buildStructuredOffer({
      main: { id: mainItem.id, name: mainItem.name, size_label: mainSize, description: mainItem.description },
      paired: pairedItem
        ? { id: pairedItem.id, name: pairedItem.name, size_label: pairedSize, description: pairedItem.description }
        : null,
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
    mainSize,
    pairedSize,
    pairingType,
    discountPercent,
    fixedPriceText,
    setStructuredOffer,
    t,
  ]);

  if (bizLoading || locLoading || accessLoading) {
    return (
      <View style={{ flex: 1, paddingTop: top, justifyContent: "center", alignItems: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (!businessId) {
    return (
      <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, backgroundColor: theme.background }}>
        <Text style={{ color: theme.text }}>{t("menuScan.needBusiness")}</Text>
      </View>
    );
  }

  const pairingOptions: { id: MenuOfferPairingType; label: string }[] = [
    { id: "free_with_purchase", label: t("menuOffer.pairFree") },
    { id: "bogo_pair", label: t("menuOffer.pairBogo") },
    { id: "percent_off", label: t("menuOffer.pairPercent") },
  ];
  const headingTextStyle = { color: theme.text, fontWeight: "700" as const, fontSize: 16 };
  const labelTextStyle = { color: theme.text, fontWeight: "600" as const };
  const cardTitleTextStyle = { color: theme.text, fontWeight: "700" as const };
  const mutedTextStyle = { color: theme.mutedText };

  function sizesFor(item: DbMenuItem): string[] {
    return Array.isArray(item.size_options) ? item.size_options.filter((s) => s.trim().length > 0) : [];
  }

  function defaultSizeFor(item: DbMenuItem): string | null {
    return sizesFor(item)[0] ?? null;
  }

  function renderSizeChips(params: {
    item: DbMenuItem;
    selected: string | null;
    onSelect: (size: string) => void;
  }) {
    const sizes = sizesFor(params.item);
    if (sizes.length === 0) return null;
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs, marginTop: Spacing.sm }}>
        {sizes.map((size) => (
          <Pressable
            key={`${params.item.id}-${size}`}
            onPress={() => params.onSelect(size)}
            style={{
              paddingHorizontal: Spacing.sm,
              paddingVertical: 6,
              borderRadius: Radii.md,
              borderWidth: params.selected === size ? 2 : 1,
              borderColor: params.selected === size ? theme.primary : theme.border,
              backgroundColor: params.selected === size
                ? colorScheme === "dark"
                  ? "rgba(255,159,28,0.16)"
                  : PrimaryTint.surfaceStrong
                : theme.surface,
            }}
          >
            <Text style={{ fontWeight: "700", fontSize: 13, color: params.selected === size ? theme.accentText : theme.text }}>{size}</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <KeyboardScreen style={{ backgroundColor: theme.background }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.background }}
        contentContainerStyle={{
          paddingHorizontal: horizontal,
          paddingTop: Spacing.xxxl,
          paddingBottom: scrollBottom,
          gap: Spacing.md,
        }}
        {...FORM_SCROLL_KEYBOARD_PROPS}
      >
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}
      {loadErr ? <Banner message={loadErr} tone="error" /> : null}
      {locErr ? <Banner message={locErr} tone="error" /> : null}

      {step === "location" && locationFlow === "setup" ? (
        <View style={{ gap: Spacing.sm }}>
          <Text style={headingTextStyle}>{t("menuOffer.locationSetupTitle")}</Text>
          <Text style={[mutedTextStyle, { lineHeight: 20 }]}>{t("menuOffer.locationSetupBody")}</Text>
          <PrimaryButton
            title={t("menuOffer.locationSetupCta")}
            onPress={() => router.push("/business-setup" as Href)}
          />
        </View>
      ) : null}

      {step === "location" && locationFlow === "select" ? (
        <View style={{ gap: Spacing.sm }}>
          <Text style={headingTextStyle}>{t("menuOffer.stepLocation")}</Text>
          <Text style={[mutedTextStyle, { lineHeight: 20 }]}>{t("menuOffer.locationHelp")}</Text>
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
              <Text style={cardTitleTextStyle}>{loc.name}</Text>
              <Text style={[mutedTextStyle, { marginTop: 4 }]}>{loc.address}</Text>
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
                <Text style={[labelTextStyle, { flex: 1 }]}>{t("menuOffer.multiLocationToggle")}</Text>
                <BrandedSwitch
                  value={applyMultiLocation}
                  onValueChange={setApplyMultiLocation}
                  accessibilityRole="switch"
                  accessibilityLabel={t("menuOffer.multiLocationToggle")}
                  accessibilityHint={t("menuOffer.multiLocationToggleHint")}
                  accessibilityState={getSwitchAccessibilityState(applyMultiLocation)}
                />
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
                        <Text style={labelTextStyle}>{loc.name}</Text>
                      </Pressable>
                    ))
                : null}
            </View>
          ) : null}
          <PrimaryButton title={t("menuOffer.next")} onPress={onLocationNext} />
        </View>
      ) : null}

      {items.length === 0 && !loadErr && step === "main" ? (
        <View style={{ gap: Spacing.md }}>
          <Text style={{ color: theme.mutedText, fontSize: 15, lineHeight: 22 }}>
            {t("menuOffer.emptyMenu")}
          </Text>
          <PrimaryButton
            title={t("menuManager.addManual")}
            onPress={() => router.push("/create/menu-manager?add=1" as Href)}
          />
        </View>
      ) : null}

      {step === "main" && items.length > 0 ? (
        <View style={{ gap: Spacing.sm }}>
          <Text style={headingTextStyle}>{t("menuOffer.stepMain")}</Text>
          {items.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  setMainItem(item);
                  setMainSize(defaultSizeFor(item));
                  setPairedItem(null);
                  setPairedSize(null);
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
                <Text style={cardTitleTextStyle}>{item.name}</Text>
                {item.description ? (
                  <Text style={[mutedTextStyle, { marginTop: 4, fontSize: 13 }]} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
                {item.price_text ? (
                  <Text style={[mutedTextStyle, { marginTop: 4 }]}>{formatMenuPriceLabel(item.price_text)}</Text>
                ) : null}
                {renderSizeChips({
                  item,
                  selected: mainItem?.id === item.id ? mainSize : null,
                  onSelect: (size) => {
                    setMainItem(item);
                    setMainSize(size);
                    setPairedItem(null);
                    setPairedSize(null);
                    setStep("paired");
                  },
                })}
              </Pressable>
            ))}
          <SecondaryButton title={t("menuOffer.back")} onPress={goBackFromMainStep} />
        </View>
      ) : null}

      {step === "paired" && mainItem ? (
        <View style={{ gap: Spacing.sm }}>
          <Text style={headingTextStyle}>{t("menuOffer.stepPaired")}</Text>
          <SecondaryButton
            title={t("menuOffer.skipPaired")}
            onPress={() => {
              setPairedItem(null);
              setPairedSize(null);
              setStep("pairing");
            }}
          />
          <SecondaryButton
            title={t("menuOffer.sameItemPaired")}
            onPress={() => {
              if (!mainItem) return;
              setPairedItem(mainItem);
              setPairedSize(mainSize ?? defaultSizeFor(mainItem));
              setStep("pairing");
            }}
          />
          {items.filter((i) => i.id !== mainItem.id).map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  setPairedItem(item);
                  setPairedSize(defaultSizeFor(item));
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
                <Text style={cardTitleTextStyle}>{item.name}</Text>
                {item.description ? (
                  <Text style={[mutedTextStyle, { marginTop: 4, fontSize: 13 }]} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
                {item.price_text ? (
                  <Text style={[mutedTextStyle, { marginTop: 4 }]}>{formatMenuPriceLabel(item.price_text)}</Text>
                ) : null}
                {renderSizeChips({
                  item,
                  selected: pairedItem?.id === item.id ? pairedSize : null,
                  onSelect: (size) => {
                    setPairedItem(item);
                    setPairedSize(size);
                    setStep("pairing");
                  },
                })}
              </Pressable>
            ))}
          <SecondaryButton title={t("menuOffer.back")} onPress={() => { setPairedItem(null); setPairedSize(null); setStructuredOffer(null); setStep("main"); }} />
        </View>
      ) : null}

      {step === "pairing" && mainItem ? (
        <View style={{ gap: Spacing.md }}>
          <Text style={headingTextStyle}>{t("menuOffer.stepPairing")}</Text>
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
              <Text style={labelTextStyle}>{opt.label}</Text>
            </Pressable>
          ))}
          {pairingType === "percent_off" ? (
            <View style={{ gap: Spacing.sm }}>
              <Text style={labelTextStyle}>{t("menuOffer.percentOffLabel")}</Text>
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
                    <Text style={labelTextStyle}>{p}%</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {pairingType === "fixed_price_special" ? (
            <View>
              <Text style={labelTextStyle}>{t("menuOffer.fixedPriceLabel")}</Text>
              <TextInput
                value={fixedPriceText}
                onChangeText={(value) => setFixedPriceText(sanitizeDecimalInput(value))}
                keyboardType="decimal-pad"
                inputAccessoryViewID={IOS_DONE_INPUT_ACCESSORY_ID}
                returnKeyType="done"
                placeholder={t("menuOffer.fixedPricePlaceholder")}
                placeholderTextColor={theme.inputPlaceholder}
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: Radii.md,
                  padding: Spacing.md,
                  marginTop: 6,
                  fontSize: 16,
                  backgroundColor: theme.surface,
                  color: theme.inputText,
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
            }}
          >
            <Text style={{ color: theme.text, fontSize: 20, fontWeight: "800" }}>{t("menuOffer.generateStrongHeadline")}</Text>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: "600", lineHeight: 22 }}>
              {buildOfferHintText(structuredOffer)}
            </Text>
            <Text style={{ color: theme.mutedText, fontSize: 14, lineHeight: 20 }}>{t("menuOffer.generateStrongSubtitle")}</Text>
            <PrimaryButton
              title={t(access.canGenerateAi ? "menuOffer.generateStrongVariants" : "menuOffer.saveTextDraft")}
              onPress={access.canGenerateAi ? goToAdCreation : saveTextDraft}
              disabled={savingDraft}
              style={{ minHeight: 64 }}
            />
          </View>
          <SecondaryButton title={t("menuOffer.back")} onPress={() => { setStructuredOffer(null); setStep("pairing"); }} />
        </View>
      ) : null}
      </ScrollView>
      <IosDoneInputAccessory />
    </KeyboardScreen>
  );
}
