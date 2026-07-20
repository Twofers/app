import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { AdPosterCanvas } from "@/components/poster/AdPosterCanvas";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { Banner } from "@/components/ui/banner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { Colors, Gray, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { fetchOwnerBusiness, type OwnerBusinessRow } from "@/lib/owner-business";
import {
  canLoadAiDealStudioDevRoutes,
  getAndroidPackageName,
  getSupabaseUrlForDisplay,
  isAiStudioPublishingDisabled,
  isProductionSupabaseUrlConfigured,
} from "@/lib/runtime-env";
import { supabase } from "@/lib/supabase";
import { sanitizePosterText } from "@/lib/poster/posterPolicy";
import type { PosterCopyV1, PosterTemplateId } from "@/lib/poster/posterTypes";

const STYLE_PRESETS: PosterTemplateId[] = ["fresh", "bold", "premium"];
const DEV_RENDER_CTA = "";

type StylePreset = PosterTemplateId;
type GenerationMode = "dry-run" | "real-copy" | "real-image";

type DraftResponse = {
  draft?: {
    job_id?: string;
    creative_id?: string;
    business_id?: string;
    creative?: {
      headline?: string;
      supportingCopy?: string;
      imagePrompt?: string;
      stylePreset?: string;
      layoutRecommendation?: string;
      publishingDisabled?: boolean;
      dryRun?: boolean;
      copyOnly?: boolean;
      poster?: Partial<{
        headline: string;
        supportingLine: string;
        offerLine1: string;
        offerLine2: string;
        subline: string;
      }>;
      lockedOffer?: {
        productName?: string;
        offerType?: string;
        offerTerms?: string;
        startTime?: string;
        endTime?: string;
        quantityLimit?: number;
        cta?: string;
      };
    };
    publishing_disabled?: boolean;
    dry_run?: boolean;
    copy_only?: boolean;
    image_asset_path?: string | null;
    image_signed_url?: string | null;
    source_asset_path?: string | null;
    source_asset_signed_url?: string | null;
    rendered_asset_path?: string | null;
    rendered_asset_signed_url?: string | null;
    image_provider?: string;
    image_model?: string | null;
    image_generation_success?: boolean;
    image_generation_error_code?: string | null;
  };
  error?: string;
  details?: unknown;
};

function defaultStartTime() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

function defaultEndTime() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
}

function fieldStyle(theme: typeof Colors.light) {
  return {
    minHeight: 48,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    color: theme.text,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontSize: 15,
  };
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: Gray[600], fontSize: 12, fontWeight: "800", textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ color: Gray[900], fontSize: 15, lineHeight: 21 }}>{value}</Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <Text style={{ color: Gray[600], fontSize: 13, fontWeight: "800", width: 116 }}>{label}</Text>
      <Text style={{ color: Gray[900], fontSize: 14, lineHeight: 20, flex: 1 }}>{value}</Text>
    </View>
  );
}

function cleanDisplay(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function limitPosterText(value: string | undefined | null, fallback: string, max: number) {
  return sanitizePosterText(value ?? "", { fallback, maxChars: max });
}

function normalizePosterWords(value: string | undefined | null): string {
  return cleanDisplay(value, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9%+\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const POSTER_ITEM_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "choice",
  "drink",
  "hot",
  "iced",
  "large",
  "medium",
  "of",
  "one",
  "regular",
  "small",
  "the",
  "your",
]);

const POSTER_ITEM_WORDS = [
  "coffee",
  "latte",
  "espresso",
  "cappuccino",
  "cookie",
  "bagel",
  "sandwich",
  "muffin",
  "croissant",
  "pastry",
  "scone",
  "tea",
  "taco",
  "dessert",
  "entree",
  "pizza",
  "burger",
  "salad",
  "bowl",
  "smoothie",
];

function posterItemLabel(value: string | undefined | null): string {
  const words = normalizePosterWords(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const known = POSTER_ITEM_WORDS.find((word) => words.includes(word));
  if (known) return known === "drink" && words.includes("coffee") ? "coffee" : known;
  const meaningful = words.filter((word) => !POSTER_ITEM_STOP_WORDS.has(word));
  return meaningful.length > 0 ? meaningful.slice(-2).join(" ") : words.slice(0, 2).join(" ");
}

function productKeyword(productName: string | undefined | null) {
  return (posterItemLabel(productName) || "offer").toUpperCase().slice(0, 12);
}

function posterRewardLabel(offerTerms: string | undefined | null, productName: string | undefined | null): string {
  const freeMatch = offerTerms?.match(/\bfree\s+(?:a|an|one|1)?\s*([a-z0-9][a-z0-9\s-]{1,80})/i);
  const getFreeMatch = offerTerms?.match(/\bget\s+(?:a|an|one|1)?\s*([a-z0-9][a-z0-9\s-]{1,80}?)(?:\s+of your choice)?\s+free\b/i);
  const freePhrase = (freeMatch?.[1] ?? getFreeMatch?.[1])
    ?.replace(/\b(?:of your choice|when|with|today|while|for|redeem|only)\b[\s\S]*$/i, "")
    .replace(/[.,;:!?]+$/g, "")
    .trim();
  const reward = posterItemLabel(freePhrase || offerTerms);
  const product = posterItemLabel(productName);
  if (reward && reward !== product) return reward.toUpperCase().slice(0, 12);
  if (/\bfree\b/i.test(offerTerms ?? "")) return "FREE";
  return "";
}

function posterRewardLine(offerTerms: string | undefined | null, productName: string | undefined | null) {
  const reward = posterRewardLabel(offerTerms, productName);
  if (reward && reward !== "FREE") return `GET 1 ${reward}`;
  if (reward === "FREE") return "GET 1 FREE";
  return "GET 1 MORE";
}

function posterHeadlineFromOffer(productName: string | undefined | null, offerTerms: string | undefined | null) {
  const product = productKeyword(productName);
  const reward = posterRewardLabel(offerTerms, productName);
  if (reward && reward !== "FREE" && reward !== product) {
    const pair = `${product} + ${reward}`;
    return pair.length <= 22 ? `${pair} BREAK` : pair;
  }
  return `${product} BONUS`;
}

function stripAwkwardAnyDeterminer(value: string): string {
  return value.replace(/\b(?:a|an|the|our|your)\s+(any\b)/gi, "$1");
}

function stripPosterFiller(value: string | undefined | null): string {
  return stripAwkwardAnyDeterminer(cleanDisplay(value, ""))
    .replace(/^try\s+our\b[:\s-]*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isBareItemHeadline(value: string, label: string): boolean {
  const normalized = normalizePosterWords(value);
  const labelWords = new Set(normalizePosterWords(label).split(/\s+/).filter(Boolean));
  if (!normalized || labelWords.size === 0 || /[+&]/.test(value)) return false;
  const meaningful = normalized.split(/\s+/).filter((word) => !POSTER_ITEM_STOP_WORDS.has(word));
  return meaningful.length > 0 && meaningful.every((word) => labelWords.has(word));
}

function isWeakPosterHeadline(value: string | undefined | null, fallback: PosterCopyV1): boolean {
  const raw = cleanDisplay(value, "");
  const cleaned = stripPosterFiller(raw);
  if (!cleaned) return true;
  if (/^try\s+our\b/i.test(raw)) return true;
  const productLabel = normalizePosterWords(fallback.offer_line_1).replace(/^buy\s+\d+\s+/, "");
  const rewardLabel = normalizePosterWords(fallback.offer_line_2).replace(/^get\s+\d+\s+/, "").replace(/^get\s+/, "");
  return isBareItemHeadline(cleaned, productLabel) || isBareItemHeadline(cleaned, rewardLabel);
}

function safePosterHeadline(value: string | undefined | null, fallback: PosterCopyV1): string {
  return isWeakPosterHeadline(value, fallback)
    ? fallback.headline
    : limitPosterText(stripPosterFiller(value), fallback.headline, 28);
}

function fallbackPosterCopy(draft: NonNullable<DraftResponse["draft"]>, businessName: string): PosterCopyV1 {
  const locked = draft.creative?.lockedOffer;
  const product = productKeyword(locked?.productName);
  return {
    business_name: sanitizePosterText(businessName, { fallback: "Local Favorite", maxChars: 34, uppercase: false }),
    headline: limitPosterText(posterHeadlineFromOffer(locked?.productName, locked?.offerTerms), "LOCAL DEAL", 28),
    offer_line_1: limitPosterText(`BUY 1 ${product}`, "BUY 1", 28),
    offer_line_2: limitPosterText(posterRewardLine(locked?.offerTerms, locked?.productName), "GET 1 FREE", 28),
    subline: limitPosterText("LOCAL FAVORITE", "LOCAL FAVORITE", 28),
  };
}

function posterCopyFromDraft(draft: NonNullable<DraftResponse["draft"]>, businessName: string): PosterCopyV1 {
  const fallback = fallbackPosterCopy(draft, businessName);
  const poster = draft.creative?.poster;
  return {
    business_name: fallback.business_name,
    headline: safePosterHeadline(poster?.headline ?? draft.creative?.headline, fallback),
    offer_line_1: limitPosterText(poster?.offerLine1, fallback.offer_line_1, 28),
    offer_line_2: limitPosterText(poster?.offerLine2, fallback.offer_line_2, 28),
    subline: limitPosterText(poster?.subline ?? poster?.supportingLine ?? draft.creative?.supportingCopy, fallback.subline ?? "", 32),
  };
}

function selectedStyleFromDraft(draft: NonNullable<DraftResponse["draft"]>, fallback: StylePreset) {
  const candidate = draft.creative?.stylePreset?.trim().toLowerCase() as StylePreset | undefined;
  return STYLE_PRESETS.includes(candidate ?? fallback) ? candidate ?? fallback : fallback;
}

export default function AiDealStudioDevScreen() {
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const { session, isInitialLoading: sessionLoading } = useAuthSession();

  const [business, setBusiness] = useState<OwnerBusinessRow | null>(null);
  const [businessLoading, setBusinessLoading] = useState(true);
  const [businessError, setBusinessError] = useState<string | null>(null);
  const [posterBusinessName, setPosterBusinessName] = useState("Heraz Coffee");
  const [productName, setProductName] = useState("Bacon and Egg Sandwich");
  const [productDescription, setProductDescription] = useState("A savory breakfast sandwich with bacon and egg, paired with coffee.");
  const [offerType, setOfferType] = useState("buy_one_get_one");
  const [offerTerms, setOfferTerms] = useState("Buy a bacon and egg sandwich, get a free coffee.");
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [endTime, setEndTime] = useState(defaultEndTime);
  const [quantityLimit, setQuantityLimit] = useState("5");
  const [stylePreset, setStylePreset] = useState<StylePreset>("premium");
  const [generationMode, setGenerationMode] = useState<GenerationMode>("dry-run");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftResponse["draft"] | null>(null);

  const guardError = useMemo(() => {
    if (!isAiStudioPublishingDisabled()) {
      return "Publishing must be disabled before AI Deal Studio can load.";
    }
    if (!canLoadAiDealStudioDevRoutes()) {
      return `AI Deal Studio is only available in the dev APK with publishing disabled. Current package: ${getAndroidPackageName()}.`;
    }
    return null;
  }, []);

  const loadBusiness = useCallback(async () => {
    if (guardError || sessionLoading) return;
    if (!session?.user?.id) {
      setBusiness(null);
      setBusinessLoading(false);
      setBusinessError(null);
      return;
    }
    setBusinessLoading(true);
    setBusinessError(null);
    const result = await fetchOwnerBusiness(supabase);
    if (result.error) {
      setBusiness(null);
      setBusinessError(result.error.message);
    } else {
      setBusiness(result.row);
    }
    setBusinessLoading(false);
  }, [guardError, session?.user?.id, sessionLoading]);

  useEffect(() => {
    void loadBusiness();
  }, [loadBusiness]);

  const canSubmit =
    !guardError &&
    !!session?.user &&
    !!business?.id &&
    productName.trim().length > 0 &&
    offerType.trim().length > 0 &&
    offerTerms.trim().length > 0 &&
    Number.parseInt(quantityLimit, 10) > 0 &&
    !submitting;

  async function generateDraft() {
    if (!business?.id || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data, error } = await supabase.functions.invoke<DraftResponse>("ai-studio-generate-draft", {
        body: {
          business_id: business.id,
          product_name: productName.trim(),
          product_description: productDescription.trim() || null,
          offer_type: offerType.trim(),
          offer_terms: offerTerms.trim(),
          start_time: startTime.trim(),
          end_time: endTime.trim(),
          quantity_limit: Number.parseInt(quantityLimit, 10),
          cta: DEV_RENDER_CTA,
          style_preset: stylePreset,
          dry_run: generationMode === "dry-run",
          copy_only: generationMode !== "real-image",
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.draft?.creative) throw new Error("The function did not return a draft creative.");
      setDraft(data.draft);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Draft generation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const generatedPoster = draft?.creative ? (
    <AdPosterCanvas
      imageUri={draft.source_asset_signed_url ?? draft.image_signed_url}
      templateId={selectedStyleFromDraft(draft, stylePreset)}
      copy={posterCopyFromDraft(draft, cleanDisplay(posterBusinessName, cleanDisplay(business?.name, "Local business")))}
    />
  ) : null;

  const generatedDetails = draft?.creative ? (
    <View style={{ borderRadius: Radii.md, borderWidth: 1, borderColor: theme.border, padding: Spacing.md, gap: Spacing.md }}>
      <Text style={{ color: theme.text, fontSize: 18, fontWeight: "900" }}>Deal details</Text>
      <DetailRow label="Poster name" value={cleanDisplay(posterBusinessName, cleanDisplay(business?.name, "Local business"))} />
      <DetailRow label="Account business" value={cleanDisplay(business?.name, "Local business")} />
      <DetailRow label="Product" value={cleanDisplay(draft.creative.lockedOffer?.productName, productName)} />
      <DetailRow label="Offer terms" value={cleanDisplay(draft.creative.lockedOffer?.offerTerms, offerTerms)} />
      <DetailRow label="Start" value={cleanDisplay(draft.creative.lockedOffer?.startTime, startTime)} />
      <DetailRow label="End" value={cleanDisplay(draft.creative.lockedOffer?.endTime, endTime)} />
      <DetailRow label="Total qty" value={String(draft.creative.lockedOffer?.quantityLimit ?? quantityLimit)} />
      <DetailRow label="Remaining" value={String(draft.creative.lockedOffer?.quantityLimit ?? quantityLimit)} />
      <DetailRow label="Location" value={cleanDisplay(business?.address ?? business?.location, "No location on file")} />
      <DetailRow label="Style" value={draft.creative.stylePreset ?? stylePreset} />
      <DetailRow
        label="Source image"
        value={
          draft.source_asset_path ?? draft.image_asset_path
            ? `${draft.image_provider ?? "image"} stored privately at ${draft.source_asset_path ?? draft.image_asset_path}`
            : draft.image_generation_error_code
              ? `No image stored (${draft.image_generation_error_code})`
              : "No image generated for this mode"
        }
      />
      <DetailRow label="Rendered ad" value={draft.rendered_asset_path ?? "Not exported in this phase"} />
      <DetailRow label="Job status" value={`ready | dry-run ${draft.dry_run === true ? "on" : "off"} | publishing disabled`} />
      <PreviewRow label="Text-free image prompt" value={draft.creative.imagePrompt ?? "(missing)"} />
      <View
        style={{
          minHeight: 48,
          borderRadius: Radii.md,
          borderWidth: 1,
          borderColor: theme.border,
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.7,
        }}
      >
        <Text style={{ color: theme.mutedText, fontWeight: "800" }}>Publishing disabled in dev build</Text>
      </View>
    </View>
  ) : null;

  const hasGeneratedDraft = Boolean(draft?.creative);

  const businessStatusCard = (
    <View style={{ borderRadius: Radii.md, borderWidth: 1, borderColor: theme.border, padding: Spacing.md, gap: Spacing.md }}>
      <Text style={{ color: theme.text, fontSize: 18, fontWeight: "900" }}>
        {businessLoading || sessionLoading ? "Loading business..." : business?.name ?? "No owned business"}
      </Text>
      <Text style={{ color: theme.mutedText, fontSize: 13 }}>
        Supabase: {getSupabaseUrlForDisplay()}
      </Text>
      {(businessLoading || sessionLoading) && !guardError ? <ActivityIndicator color={theme.primary} /> : null}
    </View>
  );

  return (
    <KeyboardScreen style={{ backgroundColor: theme.background }}>
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, backgroundColor: theme.background }}>
      <ScrollView
        contentContainerStyle={{ gap: Spacing.md, paddingBottom: scrollBottom, paddingTop: Spacing.sm }}
        {...FORM_SCROLL_KEYBOARD_PROPS}
        showsVerticalScrollIndicator={false}
      >
        {!hasGeneratedDraft ? (
          <View
            style={{
              alignSelf: "flex-start",
              borderRadius: 6,
              backgroundColor: "#111827",
              paddingHorizontal: Spacing.sm,
              paddingVertical: 4,
            }}
          >
            <Text style={{ color: "#FBBF24", fontSize: 12, fontWeight: "900" }}>DEV</Text>
          </View>
        ) : null}

        {guardError ? <Banner tone="error" message={guardError} /> : null}
        {!guardError && isProductionSupabaseUrlConfigured() ? (
          <Banner tone="warning" message="Supabase points to production. Publishing remains disabled for this dev build." />
        ) : null}
        {!guardError && !sessionLoading && !session?.user ? (
          <Banner tone="warning" message="Sign in as a dev business owner to generate drafts." />
        ) : null}
        {!guardError && businessError ? <Banner tone="error" message={businessError} /> : null}
        {!guardError && !businessLoading && session?.user && !business ? (
          <Banner tone="warning" message="No owned business was found for this dev account." />
        ) : null}
        {submitError ? <Banner tone="error" message={submitError} /> : null}
        {!hasGeneratedDraft && generationMode === "real-copy" ? (
          <Banner
            tone="warning"
            message="Real copy/prompt generation may use OpenAI credits. Image generation and publishing stay disabled."
          />
        ) : null}
        {!hasGeneratedDraft && generationMode === "real-image" ? (
          <Banner
            tone="warning"
            message="Real copy/prompt plus Gemini image generation may use AI credits. The image stays private and publishing remains disabled."
          />
        ) : null}

        {draft?.creative ? null : businessStatusCard}
        {generatedPoster}
        {generatedDetails}
        {draft?.creative ? businessStatusCard : null}

        <View style={{ gap: Spacing.sm }}>
          <Text style={{ color: theme.text, fontWeight: "800" }}>Poster business name</Text>
          <TextInput value={posterBusinessName} onChangeText={setPosterBusinessName} style={fieldStyle(theme)} placeholderTextColor={theme.mutedText} />
        </View>

        <View style={{ gap: Spacing.sm }}>
          <Text style={{ color: theme.text, fontWeight: "800" }}>Product name</Text>
          <TextInput value={productName} onChangeText={setProductName} style={fieldStyle(theme)} placeholderTextColor={theme.mutedText} />
        </View>

        <View style={{ gap: Spacing.sm }}>
          <Text style={{ color: theme.text, fontWeight: "800" }}>Product description</Text>
          <TextInput
            value={productDescription}
            onChangeText={setProductDescription}
            multiline
            style={[fieldStyle(theme), { minHeight: 84, textAlignVertical: "top" }]}
            placeholderTextColor={theme.mutedText}
          />
        </View>

        <View style={{ gap: Spacing.sm }}>
          <Text style={{ color: theme.text, fontWeight: "800" }}>Offer type</Text>
          <TextInput value={offerType} onChangeText={setOfferType} style={fieldStyle(theme)} placeholderTextColor={theme.mutedText} />
        </View>

        <View style={{ gap: Spacing.sm }}>
          <Text style={{ color: theme.text, fontWeight: "800" }}>Offer terms</Text>
          <TextInput
            value={offerTerms}
            onChangeText={setOfferTerms}
            multiline
            style={[fieldStyle(theme), { minHeight: 84, textAlignVertical: "top" }]}
            placeholderTextColor={theme.mutedText}
          />
        </View>

        <View style={{ gap: Spacing.sm }}>
          <Text style={{ color: theme.text, fontWeight: "800" }}>Start time</Text>
          <TextInput
            value={startTime}
            onChangeText={setStartTime}
            autoCapitalize="none"
            style={fieldStyle(theme)}
            placeholderTextColor={theme.mutedText}
          />
        </View>

        <View style={{ gap: Spacing.sm }}>
          <Text style={{ color: theme.text, fontWeight: "800" }}>End time</Text>
          <TextInput
            value={endTime}
            onChangeText={setEndTime}
            autoCapitalize="none"
            style={fieldStyle(theme)}
            placeholderTextColor={theme.mutedText}
          />
        </View>

        <View style={{ gap: Spacing.sm }}>
          <Text style={{ color: theme.text, fontWeight: "800" }}>Quantity limit</Text>
          <TextInput
            value={quantityLimit}
            onChangeText={setQuantityLimit}
            keyboardType="number-pad"
            style={fieldStyle(theme)}
            placeholderTextColor={theme.mutedText}
          />
        </View>

        <View style={{ gap: Spacing.sm }}>
          <Text style={{ color: theme.text, fontWeight: "800" }}>Style preset</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm }}>
            {STYLE_PRESETS.map((preset) => {
              const selected = preset === stylePreset;
              return (
                <Pressable
                  key={preset}
                  onPress={() => setStylePreset(preset)}
                  style={{
                    minHeight: 40,
                    borderRadius: Radii.md,
                    borderWidth: 1,
                    borderColor: selected ? theme.primary : theme.border,
                    backgroundColor: selected ? theme.primary : theme.surface,
                    justifyContent: "center",
                    paddingHorizontal: Spacing.md,
                  }}
                >
                  <Text style={{ color: selected ? theme.primaryText : theme.text, fontWeight: "800" }}>{preset}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: Spacing.sm }}>
          <Text style={{ color: theme.text, fontWeight: "800" }}>Generation mode</Text>
          <View style={{ flexDirection: "row", gap: Spacing.sm }}>
            {[
              ["dry-run", "Dry run"],
              ["real-copy", "Real copy/prompt only"],
              ["real-image", "Real copy/prompt + Gemini image"],
            ].map(([value, label]) => {
              const selected = generationMode === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => setGenerationMode(value as GenerationMode)}
                  style={{
                    flex: 1,
                    minHeight: 48,
                    borderRadius: Radii.md,
                    borderWidth: 1,
                    borderColor: selected ? theme.primary : theme.border,
                    backgroundColor: selected ? theme.primary : theme.surface,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: Spacing.sm,
                  }}
                >
                  <Text style={{ color: selected ? theme.primaryText : theme.text, fontWeight: "800", textAlign: "center" }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <PrimaryButton
          title={
            submitting
              ? "Generating..."
              : draft
                ? "Regenerate Draft"
                : generationMode === "real-image"
                  ? "Generate Copy + Gemini Image"
                  : generationMode === "real-copy"
                  ? "Generate Real Copy/Prompt"
                  : "Generate Draft"
          }
          onPress={() => void generateDraft()}
          disabled={!canSubmit}
        />

        <View
          style={{
            minHeight: 48,
            borderRadius: Radii.md,
            borderWidth: 1,
            borderColor: theme.border,
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.7,
          }}
        >
          <Text style={{ color: theme.mutedText, fontWeight: "800" }}>Publishing disabled in dev build</Text>
        </View>

        <SecondaryButton title="Back to Diagnostics" onPress={() => router.back()} />
      </ScrollView>
    </View>
    </KeyboardScreen>
  );
}
