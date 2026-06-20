/**
 * Express deal flow: photo / menu item -> AI offer draft -> review -> publish.
 *
 * Deliberately lean. The full editor (app/create/ai.tsx) stays one tap away via
 * the AI Ads builder for scheduling, pricing, recurring windows, multi-location, etc.
 *
 * The strong-deal guard is NOT weakened here: this screen runs the same client
 * mirror (validateStrongDealOnly) as the full editor, and every insert still hits
 * the server-side SQL trigger that hard-rejects weak deals.
 */
import { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useBusiness } from "@/hooks/use-business";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Banner } from "@/components/ui/banner";
import { DealEligibilityForm } from "@/components/deal-eligibility-form";
import { DealPreviewModal } from "@/components/deal-preview-modal";
import { KeyboardScreen, FORM_SCROLL_KEYBOARD_PROPS } from "@/components/ui/keyboard-screen";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { supabase } from "@/lib/supabase";
import { aiGenerateAd, getErrorCode, notifyDealPublished, translateDealCopy } from "@/lib/functions";
import {
  adToDealDraft,
  buildOfferDefinitionFallbackAd,
  normalizeGeneratedAdDisplayCopy,
  type GeneratedAd,
} from "@/lib/ad-variants";
import { resolveDealFlowLanguage, translateDealQualityBlock } from "@/lib/translate-deal-quality";
import { buildPublicDealPhotoUrl } from "@/lib/deal-poster-url";
import { uploadDealPhoto } from "@/lib/upload-deal-photo";
import { markRecentPublish } from "@/lib/recent-publish";
import { buildQuickDealFullBuilderParams } from "@/lib/quick-deal-full-builder";
import { trackAppAnalyticsEvent } from "@/lib/app-analytics";
import { validateDealEligibility } from "@/lib/deal-eligibility";
import {
  validateQuickDealAd,
  type QuickDealAdValidationError,
} from "@/lib/quick-deal-ad-validation";
import {
  DEAL_ELIGIBILITY_DEAL_COLUMN_KEYS,
  createDefaultDealEligibilityFormState,
  dealEligibilityFormToDealColumns,
  dealEligibilityFormToInput,
  omitDealEligibilityColumns,
  type DealEligibilityFormState,
} from "@/lib/deal-eligibility-form";
import { buildOfferDefinitionV1, type OfferDefinitionV1 } from "@/lib/offer-definition";
import { isOfferDefinitionFallbackEnabled } from "@/lib/runtime-env";

// Express defaults; owners who need to tune these use the full AI Ads builder.
const EXPRESS_DURATION_DAYS = 7;
const EXPRESS_MAX_CLAIMS = 50;
const EXPRESS_CUTOFF_MINUTES = 15;
const EXPRESS_REDEMPTION_LIMIT = `Claims close ${EXPRESS_CUTOFF_MINUTES} minutes before the deal ends.`;
const OFFER_DEFINITION_FALLBACK_ENABLED = isOfferDefinitionFallbackEnabled();

type BannerState = { message: string; tone: "error" | "success" | "info" | "warning" };

function isMissingDealLocationColumn(error: { code?: string; message?: string } | null | undefined) {
  return (
    (error?.code === "PGRST204" || error?.code === "42703") &&
    error.message?.includes("location_id")
  );
}

function isMissingDealEligibilityColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return (
    (error?.code === "PGRST204" || error?.code === "42703") &&
    DEAL_ELIGIBILITY_DEAL_COLUMN_KEYS.some((key) => message.includes(key))
  );
}

function omitDealLocationId<T extends Record<string, unknown>>(row: T) {
  const { location_id: _locationId, ...rest } = row;
  return rest;
}

function localTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export default function QuickDealExpress() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { businessId, businessName, businessContextForAi, businessPreferredLocale } = useBusiness();
  const dealOutputLang = resolveDealFlowLanguage(businessPreferredLocale, i18n.language);
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  const [hint, setHint] = useState("");
  const [eligibilityForm, setEligibilityForm] = useState<DealEligibilityFormState>(
    () => createDefaultDealEligibilityFormState(),
  );
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [draft, setDraft] = useState<GeneratedAd | null>(null);
  const [title, setTitle] = useState("");
  const [offerLine, setOfferLine] = useState("");
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [publishedDealId, setPublishedDealId] = useState<string | null>(null);
  const [publishedDealTitle, setPublishedDealTitle] = useState("");
  const [openingFullEditor, setOpeningFullEditor] = useState(false);

  const posterUri = draft?.poster_storage_path
    ? buildPublicDealPhotoUrl(draft.poster_storage_path)
    : photoUri;
  const previewEndTime = new Date(Date.now() + EXPRESS_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const eligibilityInput = useMemo(
    () => dealEligibilityFormToInput(eligibilityForm),
    [eligibilityForm],
  );
  const eligibilityResult = useMemo(
    () => validateDealEligibility(eligibilityInput),
    [eligibilityInput],
  );

  function buildExpressOfferDefinition(
    startsAt: Date,
    endsAt: Date,
    scheduleSummary: string,
    sourcePhotoPath: string | null,
  ): OfferDefinitionV1 | null {
    if (!businessId) return null;
    return buildOfferDefinitionV1({
      businessId,
      businessName: businessName || "this business",
      locationId: businessId,
      locationName: businessContextForAi.address || businessContextForAi.location || businessName || "this location",
      dealEligibility: eligibilityInput,
      eligibilityResult,
      activeWindowHumanReadable: scheduleSummary,
      quantityLimit: EXPRESS_MAX_CLAIMS,
      redemptionLimit: EXPRESS_REDEMPTION_LIMIT,
      schedule: {
        mode: "one_time",
        summary: scheduleSummary,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        timeZone: localTimeZone(),
      },
      sourceAssetIds: sourcePhotoPath ? [sourcePhotoPath] : [],
    });
  }

  function resetDraft() {
    setDraft(null);
    setTitle("");
    setOfferLine("");
    setPreviewVisible(false);
  }

  function resetForAnotherDeal() {
    setHint("");
    setPhotoUri(null);
    setPhotoPath(null);
    setBanner(null);
    setPublishedDealId(null);
    setPublishedDealTitle("");
    setEligibilityForm(createDefaultDealEligibilityFormState());
    resetDraft();
  }

  function blockIneligibleOffer(attemptedAction: string): boolean {
    void attemptedAction;
    if (eligibilityResult.eligible) return false;
    setBanner({
      message:
        eligibilityResult.message ??
        t("dealEligibility.invalidBody", {
          defaultValue: "Twofer deals must be free-item offers or at least 40% off one single item.",
        }),
      tone: "error",
    });
    return true;
  }

  async function insertDealWithCompatibility(row: Record<string, unknown>) {
    let payload: Record<string, unknown> = row;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await supabase.from("deals").insert(payload).select("id");
      if (!result.error) return result;
      if (isMissingDealLocationColumn(result.error) && "location_id" in payload) {
        payload = omitDealLocationId(payload);
        continue;
      }
      if (
        isMissingDealEligibilityColumn(result.error) &&
        DEAL_ELIGIBILITY_DEAL_COLUMN_KEYS.some((key) => key in payload)
      ) {
        payload = omitDealEligibilityColumns(payload);
        continue;
      }
      return result;
    }
    return supabase.from("deals").insert(payload).select("id");
  }

  async function onPickPhoto(fromCamera: boolean) {
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setBanner({ message: t("createQuick.photoPermission"), tone: "error" });
        return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
      const uri = !result.canceled ? result.assets?.[0]?.uri : null;
      if (uri) {
        setPhotoUri(uri);
        setPhotoPath(null); // force re-upload of the new image
        resetDraft(); // any existing draft no longer reflects the new photo
        setBanner(null);
      }
    } catch {
      setBanner({ message: t("createQuick.photoPermission"), tone: "error" });
    }
  }

  async function onGenerate() {
    if (!businessId) {
      setBanner({ message: t("createAi.errCreateBusinessFirst"), tone: "error" });
      return;
    }
    if (!hint.trim() && !photoUri) {
      setBanner({ message: t("createQuick.needInput"), tone: "info" });
      return;
    }
    if (blockIneligibleOffer("generate_ad")) return;
    setGenerating(true);
    setBanner(null);
    let offerDefinition: OfferDefinitionV1 | null = null;
    try {
      let path = photoPath;
      if (photoUri && !path) {
        path = await uploadDealPhoto(businessId, photoUri);
        setPhotoPath(path);
      }
      const startsAt = new Date();
      const endsAt = new Date(startsAt.getTime() + EXPRESS_DURATION_DAYS * 24 * 60 * 60 * 1000);
      const scheduleSummary = `One-time: ${startsAt.toLocaleString()} to ${endsAt.toLocaleString()}`;
      offerDefinition = OFFER_DEFINITION_FALLBACK_ENABLED
        ? buildExpressOfferDefinition(startsAt, endsAt, scheduleSummary, path)
        : null;
      const { ad } = await aiGenerateAd({
        business_id: businessId,
        hint_text: hint.trim(),
        business_context: businessContextForAi,
        output_language: dealOutputLang,
        deal_eligibility: eligibilityInput,
        offer_schedule_summary: scheduleSummary,
        quantity_limit: EXPRESS_MAX_CLAIMS,
        redemption_limit: EXPRESS_REDEMPTION_LIMIT,
        ...(path ? { photo_path: path } : {}),
      });
      const displayAd = normalizeGeneratedAdDisplayCopy(ad);
      const d = adToDealDraft(displayAd, hint);
      setDraft(displayAd);
      setTitle(d.title);
      setOfferLine(d.promo_line || d.offer_details);
    } catch (err) {
      if (OFFER_DEFINITION_FALLBACK_ENABLED && offerDefinition && shouldUseOfferDefinitionFallback(err)) {
        const fallbackAd = normalizeGeneratedAdDisplayCopy(
          buildOfferDefinitionFallbackAd(offerDefinition, { ctaText: "Claim deal" }),
        );
        const d = adToDealDraft(fallbackAd, hint);
        setDraft(fallbackAd);
        setTitle(d.title);
        setOfferLine(d.promo_line || d.offer_details);
        setBanner({
          message: t("createQuick.fallbackTemplateReady", {
            defaultValue: "AI had trouble, so we prepared a safe draft from your locked offer facts.",
          }),
          tone: "info",
        });
        trackAppAnalyticsEvent({
          event_name: "quick_deal_offer_definition_fallback_used",
          business_id: businessId ?? null,
          context: {
            error_code: getErrorCode(err) ?? null,
            offer_type: offerDefinition.offerType,
            has_photo: Boolean(photoUri || offerDefinition.sourceAssetIds.length > 0),
          },
        });
        return;
      }
      setBanner({ message: friendlyGenerateError(err, t), tone: "error" });
    } finally {
      setGenerating(false);
    }
  }

  function trackQuickDealBlocked(
    action: "preview" | "publish",
    firstError: QuickDealAdValidationError | null,
  ) {
    trackAppAnalyticsEvent({
      event_name: action === "preview" ? "quick_deal_preview_blocked" : "quick_deal_release_blocked",
      business_id: businessId ?? null,
      context: {
        action,
        rule_id: firstError?.ruleId ?? "UNKNOWN",
        field: firstError?.field ?? null,
        source_reason: firstError?.sourceReason ?? null,
      },
    });
  }

  function validateDraftForPublish(action: "preview" | "publish") {
    if (!draft) return null;
    const cleanTitle = title.trim();
    const cleanOffer = offerLine.trim();
    const listingDescription = cleanOffer;
    if (!quickDealValidation?.ok || !quickDealValidation.quality) {
      const firstError = quickDealValidation?.blockingErrors[0] ?? null;
      trackQuickDealBlocked(action, firstError);
      setBanner({
        message: firstError
          ? messageForQuickDealError(firstError)
          : t("createQuick.needOffer", {
              defaultValue: "Spell out the offer before previewing, like buy one latte, get one free or buy one croissant, get one free.",
            }),
        tone: firstError?.ruleId === "RULE_STRONG_DEAL_REQUIRED" ? "warning" : "error",
      });
      return null;
    }

    return { cleanTitle, listingDescription, quality: quickDealValidation.quality };
  }

  function onPreview() {
    const ready = validateDraftForPublish("preview");
    if (!ready) return;
    setBanner(null);
    setPreviewVisible(true);
  }

  async function onPublish() {
    if (!businessId || !draft) return;
    const ready = validateDraftForPublish("publish");
    if (!ready) {
      setPreviewVisible(false);
      return;
    }
    const { cleanTitle, listingDescription, quality } = ready;

    setPublishing(true);
    setBanner(null);
    try {
      const posterPath = draft.poster_storage_path ?? photoPath ?? null;
      const posterPublic = posterPath ? buildPublicDealPhotoUrl(posterPath) : null;
      const now = new Date();
      const end = new Date(now.getTime() + EXPRESS_DURATION_DAYS * 24 * 60 * 60 * 1000);
      const translations = await translateDealCopy({
        business_id: businessId,
        title: cleanTitle,
        description: listingDescription,
        source_locale: dealOutputLang,
      });
      const eligibilityColumns = dealEligibilityFormToDealColumns(eligibilityForm, eligibilityResult, "LIVE");

      const row = {
        business_id: businessId,
        title: cleanTitle,
        description: listingDescription,
        source_locale: translations.source_locale,
        title_en: translations.title_en,
        title_es: translations.title_es,
        title_ko: translations.title_ko,
        description_en: translations.description_en,
        description_es: translations.description_es,
        description_ko: translations.description_ko,
        price: null,
        start_time: now.toISOString(),
        end_time: end.toISOString(),
        claim_cutoff_buffer_minutes: EXPRESS_CUTOFF_MINUTES,
        max_claims: EXPRESS_MAX_CLAIMS,
        is_active: true,
        poster_url: posterPublic,
        poster_storage_path: posterPath,
        is_recurring: false,
        days_of_week: null,
        window_start_minutes: null,
        window_end_minutes: null,
        timezone: null,
        quality_tier: quality.tier,
        location_id: null,
        ...eligibilityColumns,
      };

      const insertResult = await insertDealWithCompatibility(row);
      const { data, error } = insertResult;
      if (error) throw error;

      const id = data?.[0]?.id as string | undefined;
      if (!id) throw new Error("Missing published deal id.");
      void notifyDealPublished(id);
      await markRecentPublish(cleanTitle);
      setPublishedDealId(id);
      setPublishedDealTitle(cleanTitle);
      setPreviewVisible(false);
    } catch (err) {
      setPreviewVisible(false);
      setBanner({ message: publishErrorMessage(err, t), tone: "error" });
    } finally {
      setPublishing(false);
    }
  }

  async function goToFullEditor() {
    if (openingFullEditor) return;
    setOpeningFullEditor(true);
    let nextPhotoPath = photoPath ?? draft?.poster_storage_path ?? null;
    try {
      if (!nextPhotoPath && photoUri && businessId) {
        nextPhotoPath = await uploadDealPhoto(businessId, photoUri);
        setPhotoPath(nextPhotoPath);
      }
    } catch {
      nextPhotoPath = null;
    } finally {
      setOpeningFullEditor(false);
    }
    router.push({
      pathname: "/create/ai",
      params: buildQuickDealFullBuilderParams({
        hint,
        title,
        offerLine,
        cta: draft?.cta ?? null,
        posterPath: nextPhotoPath,
        dealEligibility: JSON.stringify(eligibilityForm),
      }),
    } as Href);
  }

  const cleanTitle = title.trim();
  const cleanOffer = offerLine.trim();
  const quickDealValidation = draft
    ? validateQuickDealAd(
        {
          headline: cleanTitle,
          offer: cleanOffer,
          cta: draft.cta ?? "",
        },
        {
          businessId: businessId ?? "quick_deal",
          businessName: businessName || "this business",
          locationName: businessContextForAi.address || businessContextForAi.location || businessName || "this location",
          dealEligibility: eligibilityInput,
          eligibilityResult,
        },
      )
    : null;

  function messageForQuickDealError(error: QuickDealAdValidationError): string {
    if (error.ruleId === "RULE_HEADLINE_REQUIRED") return t("createQuick.needTitle");
    if (error.ruleId === "RULE_HEADLINE_TOO_SHORT") {
      return t("createQuick.titleTooShort", {
        defaultValue: "Use a specific headline with the item and value, like buy one iced latte, get one free.",
      });
    }
    if (error.ruleId === "RULE_OFFER_REQUIRED") {
      return t("createQuick.needOffer", {
        defaultValue: "Spell out the offer, like buy one latte, get one free or buy one croissant, get one free.",
      });
    }
    if (error.ruleId === "RULE_INELIGIBLE_DEAL") {
      return eligibilityResult.message ?? error.message;
    }
    if (
      (error.ruleId === "RULE_VALUE_PRESENT" || error.ruleId === "RULE_VALUE_AT_A_GLANCE") &&
      quickDealValidation?.quality?.blocked
    ) {
      return translateDealQualityBlock(quickDealValidation.quality, dealOutputLang);
    }
    if (error.ruleId === "RULE_STRONG_DEAL_REQUIRED" && quickDealValidation?.strongGuard && !quickDealValidation.strongGuard.ok) {
      return t(`dealQuality.strongGuard.${quickDealValidation.strongGuard.reason}`, {
        defaultValue: t("dealQuality.strongDealMessage"),
      });
    }
    return error.message;
  }

  const headlineBlockingError =
    quickDealValidation?.blockingErrors.find((error) => error.field === "headline") ?? null;
  const offerBlockingError =
    quickDealValidation?.blockingErrors.find((error) => error.field === "offer") ?? null;
  const titleValidationMessage = headlineBlockingError ? messageForQuickDealError(headlineBlockingError) : null;
  const offerValidationMessage = offerBlockingError
    ? messageForQuickDealError(offerBlockingError)
    : quickDealValidation?.ok
    ? t("createQuick.strongDealReady", { defaultValue: "Strong: all release checks pass." })
    : null;
  const offerValidationTone = quickDealValidation?.ok ? theme.success : theme.danger;
  const previewBlocked = draft ? !quickDealValidation?.ok : false;

  if (publishedDealId) {
    return (
      <KeyboardScreen>
        <ScrollView
          style={{ flex: 1, backgroundColor: theme.background }}
          {...FORM_SCROLL_KEYBOARD_PROPS}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: top, paddingHorizontal: horizontal, paddingBottom: scrollBottom }}
        >
          <View
            style={{
              marginTop: Spacing.xl,
              borderRadius: Radii.lg,
              backgroundColor: theme.surface,
              padding: Spacing.xl,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          >
            <Text style={{ fontSize: 24, fontWeight: "900", color: theme.text, lineHeight: 30 }}>
              {t("createQuick.publishSuccessTitle", { defaultValue: "Deal published" })}
            </Text>
            <Text style={{ marginTop: 8, fontSize: 15, lineHeight: 22, color: theme.mutedText }}>
              {t("createQuick.publishSuccessBody", {
                defaultValue: "Your deal is live for customers now.",
              })}
            </Text>
            <Text
              numberOfLines={3}
              style={{ marginTop: Spacing.md, fontSize: 18, lineHeight: 24, fontWeight: "800", color: theme.text }}
            >
              {publishedDealTitle}
            </Text>
          </View>

          <View style={{ marginTop: Spacing.lg }}>
            <PrimaryButton
              title={t("createQuick.viewLiveDeal", { defaultValue: "View live deal" })}
              onPress={() => router.push(`/deal/${publishedDealId}` as Href)}
            />
          </View>
          <View style={{ marginTop: Spacing.sm }}>
            <SecondaryButton
              title={t("createQuick.createAnotherDeal", { defaultValue: "Create another deal" })}
              onPress={resetForAnotherDeal}
            />
          </View>
        </ScrollView>
      </KeyboardScreen>
    );
  }

  return (
    <KeyboardScreen>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.background }}
        {...FORM_SCROLL_KEYBOARD_PROPS}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: top, paddingHorizontal: horizontal, paddingBottom: scrollBottom }}
      >
        <Text style={{ fontSize: 22, fontWeight: "800", letterSpacing: -0.3, color: theme.text }}>
          {t("createQuick.heading")}
        </Text>
        <Text style={{ marginTop: 4, fontSize: 13, lineHeight: 18, color: theme.mutedText }}>
          {t("createQuick.intro")}
        </Text>

        {banner ? (
          <View style={{ marginTop: Spacing.md }}>
            <Banner message={banner.message} tone={banner.tone} />
          </View>
        ) : null}

        {!draft ? (
          <>
            {/* ── Input: item + optional photo ── */}
            <Text style={{ marginTop: Spacing.lg, fontWeight: "700", fontSize: 16, color: theme.text }}>
              {t("createQuick.itemLabel")}
            </Text>
            <TextInput
              value={hint}
              onChangeText={setHint}
              placeholder={t("createQuick.itemPlaceholder")}
              placeholderTextColor={theme.mutedText}
              style={{
                marginTop: 8,
                borderWidth: 1.5,
                borderColor: theme.border,
                borderRadius: Radii.md,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 16,
                color: theme.text,
                backgroundColor: theme.surface,
              }}
            />

            <DealEligibilityForm
              value={eligibilityForm}
              onChange={setEligibilityForm}
              t={t}
              theme={theme}
              colorScheme={colorScheme}
              result={eligibilityResult}
            />

            {posterUri ? (
              <Image
                source={{ uri: posterUri }}
                style={{ height: 220, width: "100%", borderRadius: 18, marginTop: Spacing.md }}
                contentFit="cover"
              />
            ) : null}

            <View style={{ flexDirection: "row", gap: 8, marginTop: Spacing.md }}>
              <View style={{ flex: 1 }}>
                <SecondaryButton title={t("createAi.takePhoto")} onPress={() => void onPickPhoto(true)} />
              </View>
              <View style={{ flex: 1 }}>
                <SecondaryButton
                  title={photoUri ? t("createQuick.changePhoto") : t("createAi.pickPhoto")}
                  onPress={() => void onPickPhoto(false)}
                />
              </View>
            </View>
            <Text style={{ marginTop: 6, fontSize: 12, color: theme.mutedText }}>
              {t("createQuick.photoOptional")}
            </Text>

            <View style={{ marginTop: Spacing.lg }}>
              <PrimaryButton
                title={generating ? t("createQuick.drafting") : t("createQuick.draftWithAi")}
                onPress={() => void onGenerate()}
                disabled={generating || (!hint.trim() && !photoUri)}
              />
            </View>

            <Pressable
              onPress={() => void goToFullEditor()}
              disabled={openingFullEditor}
              accessibilityRole="button"
              accessibilityLabel={t("createQuick.fullBuilderA11y", { defaultValue: "Open AI Ads builder" })}
              style={{ marginTop: Spacing.lg, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 4, opacity: openingFullEditor ? 0.6 : 1 }}
            >
              <Text style={{ color: theme.accentText, fontSize: 14, fontWeight: "800" }}>
                {openingFullEditor
                  ? t("createQuick.openingFullBuilder", { defaultValue: "Opening builder..." })
                  : t("createQuick.fullBuilder", { defaultValue: "Use AI Ads builder" })}
              </Text>
              <MaterialIcons name="chevron-right" size={20} color={theme.accentText} />
            </Pressable>
          </>
        ) : (
          <>
            {/* ── Review & publish ── */}
            <Text style={{ marginTop: Spacing.lg, fontWeight: "700", fontSize: 16, color: theme.text }}>
              {t("createQuick.reviewHeading")}
            </Text>
            <Text style={{ marginTop: 2, fontSize: 12, color: theme.mutedText }}>
              {t("createQuick.aiNote")}
            </Text>

            <View
              style={{
                marginTop: Spacing.md,
                borderRadius: 24,
                borderWidth: 1,
                borderColor: colorScheme === "dark" ? "rgba(255,159,28,0.36)" : "rgba(255,159,28,0.35)",
                backgroundColor: colorScheme === "dark" ? "rgba(255,159,28,0.14)" : "#fff8ed",
                padding: Spacing.md,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: "900", color: theme.text }}>
                {t("createQuick.strongGuidanceTitle", { defaultValue: "Strong Twofer requirement" })}
              </Text>
              <Text style={{ marginTop: 6, fontSize: 13, lineHeight: 19, color: theme.text }}>
                {t("createQuick.strongGuidanceBody", {
                  defaultValue:
                    "Use buy one, get one free, a clearly free item, or 40%+ off. Put that value in the headline or offer so customers see it immediately.",
                })}
              </Text>
              <Text style={{ marginTop: 6, fontSize: 12, lineHeight: 18, color: theme.mutedText }}>
                {t("createQuick.strongGuidanceExamples", {
                  defaultValue: "Good: Buy one iced latte, get one free. Weak: 10% off or buy one + 20% off another item.",
                })}
              </Text>
            </View>

            {posterUri ? (
              <Image
                source={{ uri: posterUri }}
                style={{ height: 240, width: "100%", borderRadius: 18, marginTop: Spacing.md }}
                contentFit="cover"
              />
            ) : null}

            <Text style={{ marginTop: Spacing.md, fontWeight: "700", fontSize: 13, color: theme.text }}>
              {t("createQuick.offerTitleLabel")}
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              maxLength={90}
              style={{
                marginTop: 6,
                borderWidth: 1.5,
                borderColor: titleValidationMessage ? theme.danger : theme.border,
                borderRadius: Radii.md,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 16,
                fontWeight: "700",
                color: theme.text,
                backgroundColor: theme.surface,
              }}
            />
            {titleValidationMessage ? (
              <Text style={{ marginTop: 7, fontSize: 12, lineHeight: 17, color: theme.danger }}>
                {titleValidationMessage}
              </Text>
            ) : null}

            <Text style={{ marginTop: Spacing.md, fontWeight: "700", fontSize: 13, color: theme.text }}>
              {t("createQuick.offerLineLabel")}
            </Text>
            <TextInput
              value={offerLine}
              onChangeText={setOfferLine}
              multiline
              maxLength={260}
              style={{
                marginTop: 6,
                borderWidth: 1.5,
                borderColor: offerValidationMessage && offerValidationTone === theme.danger ? theme.danger : theme.border,
                borderRadius: Radii.md,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 15,
                minHeight: 72,
                color: theme.text,
                backgroundColor: theme.surface,
                textAlignVertical: "top",
              }}
            />

            {offerValidationMessage ? (
              <Text style={{ marginTop: 8, fontSize: 12, lineHeight: 17, color: offerValidationTone }}>
                {offerValidationMessage}
              </Text>
            ) : null}

            <View style={{ marginTop: Spacing.lg }}>
              <PrimaryButton
                title={t("createQuick.previewDeal", { defaultValue: "Preview deal" })}
                onPress={onPreview}
                disabled={publishing || previewBlocked}
              />
            </View>
            <View style={{ marginTop: Spacing.sm }}>
              <SecondaryButton title={t("createQuick.startOver")} onPress={resetDraft} />
            </View>
            <Pressable
              onPress={() => void goToFullEditor()}
              disabled={openingFullEditor}
              accessibilityRole="button"
              accessibilityLabel={t("createQuick.fullBuilderA11y", { defaultValue: "Open AI Ads builder" })}
              style={{ marginTop: Spacing.md, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 4, opacity: openingFullEditor ? 0.6 : 1 }}
            >
              <Text style={{ color: theme.accentText, fontSize: 14, fontWeight: "800" }}>
                {openingFullEditor
                  ? t("createQuick.openingFullBuilder", { defaultValue: "Opening builder..." })
                  : t("createQuick.fullBuilder", { defaultValue: "Use AI Ads builder" })}
              </Text>
              <MaterialIcons name="chevron-right" size={20} color={theme.accentText} />
            </Pressable>
          </>
        )}
      </ScrollView>
      {draft ? (
        <DealPreviewModal
          visible={previewVisible}
          onDismiss={() => setPreviewVisible(false)}
          onPublish={() => void onPublish()}
          publishing={publishing}
          title={cleanTitle}
          description={cleanOffer}
          businessName={businessName}
          posterUrl={posterUri}
          price={null}
          endTime={previewEndTime}
          remainingClaims={EXPRESS_MAX_CLAIMS}
        />
      ) : null}
    </KeyboardScreen>
  );
}

function shouldUseOfferDefinitionFallback(err: unknown): boolean {
  const code = getErrorCode(err);
  if (
    code === "OPENAI_KEY_MISSING" ||
    code === "MONTHLY_LIMIT" ||
    code === "COOLDOWN_ACTIVE" ||
    code === "COPY_FAILED"
  ) {
    return true;
  }
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("abort")) return true;
  if (lower.includes("monthly limit") || lower.includes("openai") || lower.includes("copy")) return true;
  return false;
}

function friendlyGenerateError(err: unknown, t: (k: string, o?: Record<string, unknown>) => string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string } | null)?.code;
  const lower = raw.toLowerCase();
  if (code === "MONTHLY_LIMIT" || lower.includes("monthly limit")) return t("createAi.friendlyMonthlyLimit");
  if (code === "COOLDOWN_ACTIVE") return raw; // server message is specific ("Please wait 12s…")
  if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("abort")) {
    return t("createAi.friendlyTimeout");
  }
  return t("createQuick.errGenerate");
}

function publishErrorMessage(err: unknown, t: (k: string) => string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.toLowerCase();
  if (m.includes("must be at least 40") || m.includes("give something free") || m.includes("strong deal")) {
    return t("dealQuality.strongDealMessage");
  }
  if (m.includes("row-level security") || m.includes("rls") || m.includes("policy")) {
    return t("createAi.errPublishPermission");
  }
  if (m.includes("network") || m.includes("fetch")) return t("createAi.errPublishNetwork");
  return t("createAi.errPublishFailed");
}
