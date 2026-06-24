import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { Banner } from "@/components/ui/banner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { ScreenHeader } from "@/components/ui/screen-header";
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

const STYLE_PRESETS = ["Fresh", "Bold", "Premium", "Sunrise", "Macro"] as const;
const DEV_RENDER_CTA = "Claim on Twofer";

type StylePreset = typeof STYLE_PRESETS[number];
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

function cleanDisplay(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function conciseSupportingCopy(value: string | null | undefined) {
  const cleaned = value
    ?.replace(/\b\d{4}-\d{2}-\d{2}T[0-9:.]+Z\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return "A limited-time local offer, rendered with app-controlled details.";
  }
  const firstSentence = cleaned.match(/^[^.!?]+[.!?]/)?.[0]?.trim();
  return firstSentence && firstSentence.length <= 118 ? firstSentence : cleaned.slice(0, 118).trim();
}

function businessInitials(name: string | null | undefined) {
  return cleanDisplay(name, "Twofer")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "T";
}

function formatWindow(start?: string, end?: string) {
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  if (!startDate || !endDate || !Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    return `${start ?? "Start TBD"} to ${end ?? "End TBD"}`;
  }
  const date = startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const startText = startDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const endText = endDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date}, ${startText} to ${endText}`;
}

function styleTheme(style: StylePreset) {
  const themes = {
    Fresh: { accent: "#16A34A", surface: "rgba(240, 253, 244, 0.94)", text: "#052E16", cta: "#15803D" },
    Bold: { accent: "#EF4444", surface: "rgba(255, 241, 242, 0.95)", text: "#450A0A", cta: "#B91C1C" },
    Premium: { accent: "#C8A24A", surface: "rgba(17, 24, 39, 0.88)", text: "#FFF7ED", cta: "#B88921" },
    Sunrise: { accent: "#F97316", surface: "rgba(255, 247, 237, 0.95)", text: "#431407", cta: "#EA580C" },
    Macro: { accent: "#0F766E", surface: "rgba(240, 253, 250, 0.95)", text: "#042F2E", cta: "#0F766E" },
  } satisfies Record<StylePreset, { accent: string; surface: string; text: string; cta: string }>;
  return themes[style];
}

function RenderedAdPreview({
  business,
  draft,
  stylePreset,
}: {
  business: OwnerBusinessRow | null;
  draft: NonNullable<DraftResponse["draft"]>;
  stylePreset: StylePreset;
}) {
  const creative = draft.creative;
  const locked = creative?.lockedOffer;
  const selectedStyle = STYLE_PRESETS.includes((creative?.stylePreset as StylePreset) ?? stylePreset)
    ? ((creative?.stylePreset as StylePreset) ?? stylePreset)
    : stylePreset;
  const palette = styleTheme(selectedStyle);
  const headline = cleanDisplay(creative?.headline, cleanDisplay(locked?.productName, "Twofer offer"));
  const support = conciseSupportingCopy(creative?.supportingCopy);
  const terms = cleanDisplay(locked?.offerTerms, "Limited-time offer");
  const quantity = typeof locked?.quantityLimit === "number" ? locked.quantityLimit : Number.NaN;
  const quantityText = Number.isFinite(quantity) ? `${quantity} available` : "Limited quantity";
  const businessName = cleanDisplay(business?.name, "Twofer business");
  const imageUri = draft.image_signed_url ?? undefined;

  const content = (
    <View style={{ flex: 1, justifyContent: "space-between", padding: 14 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: palette.accent,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "900" }}>{businessInitials(businessName)}</Text>
          </View>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "900", flexShrink: 1 }}>
            {businessName}
          </Text>
        </View>
        <View style={{ borderRadius: 999, backgroundColor: "rgba(255,255,255,0.92)", paddingHorizontal: 10, paddingVertical: 6 }}>
          <Text style={{ color: "#111827", fontSize: 12, fontWeight: "900" }}>DRAFT PREVIEW</Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ alignSelf: "flex-start", borderRadius: 999, backgroundColor: palette.accent, paddingHorizontal: 11, paddingVertical: 5 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>Twofer offer</Text>
        </View>
        <View style={{ borderRadius: 14, backgroundColor: palette.surface, padding: 12, gap: 6 }}>
          <Text numberOfLines={3} adjustsFontSizeToFit style={{ color: palette.text, fontSize: 22, lineHeight: 27, fontWeight: "900" }}>
            {headline}
          </Text>
          <Text numberOfLines={2} adjustsFontSizeToFit style={{ color: palette.text, fontSize: 13, lineHeight: 17, fontWeight: "700" }}>
            {support}
          </Text>
          <Text numberOfLines={2} adjustsFontSizeToFit style={{ color: palette.text, fontSize: 13, lineHeight: 17, fontWeight: "800" }}>
            {terms}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <View style={{ borderRadius: 999, backgroundColor: "rgba(255,255,255,0.86)", paddingHorizontal: 9, paddingVertical: 5 }}>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: "#111827", fontSize: 11, fontWeight: "900" }}>
                {formatWindow(locked?.startTime, locked?.endTime)}
              </Text>
            </View>
            <View style={{ borderRadius: 999, backgroundColor: "rgba(255,255,255,0.86)", paddingHorizontal: 9, paddingVertical: 5 }}>
              <Text style={{ color: "#111827", fontSize: 11, fontWeight: "900" }}>{quantityText}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1, borderRadius: 12, backgroundColor: palette.cta, paddingVertical: 9, alignItems: "center" }}>
              <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "900" }}>{DEV_RENDER_CTA}</Text>
            </View>
            <Text style={{ color: palette.text, fontSize: 11, fontWeight: "900" }}>Live draft</Text>
          </View>
          <Text style={{ color: palette.text, opacity: 0.72, fontSize: 11, fontWeight: "800", textAlign: "center" }}>
            Publishing disabled in dev build
          </Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: Gray[600], fontSize: 12, fontWeight: "800", textTransform: "uppercase" }}>
        Rendered Twofer ad preview
      </Text>
      <View style={{ width: "100%", aspectRatio: 4 / 5, borderRadius: Radii.md, overflow: "hidden", backgroundColor: "#111827" }}>
        {imageUri ? (
          <ImageBackground source={{ uri: imageUri }} resizeMode="cover" style={{ flex: 1 }}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.24)" }}>{content}</View>
          </ImageBackground>
        ) : (
          <View style={{ flex: 1, backgroundColor: palette.accent }}>{content}</View>
        )}
      </View>
    </View>
  );
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
  const [productName, setProductName] = useState("Smoke Test Latte");
  const [productDescription, setProductDescription] = useState("A warm espresso drink for local testing.");
  const [offerType, setOfferType] = useState("buy_one_get_one");
  const [offerTerms, setOfferTerms] = useState("Buy one latte, get one latte free.");
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [endTime, setEndTime] = useState(defaultEndTime);
  const [quantityLimit, setQuantityLimit] = useState("5");
  const [stylePreset, setStylePreset] = useState<StylePreset>("Fresh");
  const [generationMode, setGenerationMode] = useState<GenerationMode>("dry-run");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftResponse["draft"] | null>(null);

  const guardError = useMemo(() => {
    if (isProductionSupabaseUrlConfigured()) {
      return "This build is pointed at the production Supabase host and AI Deal Studio is blocked.";
    }
    if (!canLoadAiDealStudioDevRoutes()) {
      return `AI Deal Studio is only available in the dev APK with publishing disabled. Current package: ${getAndroidPackageName()}.`;
    }
    if (!isAiStudioPublishingDisabled()) {
      return "Publishing must be disabled before AI Deal Studio can load.";
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
    const result = await fetchOwnerBusiness(supabase, session.user.id);
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

  return (
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, backgroundColor: theme.background }}>
      <ScreenHeader title="AI Deal Studio" subtitle="Dev-only draft generation" />
      <ScrollView
        contentContainerStyle={{ gap: Spacing.md, paddingBottom: scrollBottom }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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

        {guardError ? <Banner tone="error" message={guardError} /> : null}
        {!guardError && isProductionSupabaseUrlConfigured() ? (
          <Banner tone="error" message="Supabase points to production. AI Deal Studio is blocked." />
        ) : null}
        {!guardError && !sessionLoading && !session?.user ? (
          <Banner tone="warning" message="Sign in as a dev business owner to generate drafts." />
        ) : null}
        {!guardError && businessError ? <Banner tone="error" message={businessError} /> : null}
        {!guardError && !businessLoading && session?.user && !business ? (
          <Banner tone="warning" message="No owned business was found for this dev account." />
        ) : null}
        {submitError ? <Banner tone="error" message={submitError} /> : null}
        {generationMode === "real-copy" ? (
          <Banner
            tone="warning"
            message="Real copy/prompt generation may use OpenAI credits. Image generation and publishing stay disabled."
          />
        ) : null}
        {generationMode === "real-image" ? (
          <Banner
            tone="warning"
            message="Real copy/prompt plus Gemini image generation may use AI credits. The image stays private and publishing remains disabled."
          />
        ) : null}

        <View style={{ borderRadius: Radii.md, borderWidth: 1, borderColor: theme.border, padding: Spacing.md, gap: Spacing.md }}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: "900" }}>
            {businessLoading || sessionLoading ? "Loading business..." : business?.name ?? "No owned business"}
          </Text>
          <Text style={{ color: theme.mutedText, fontSize: 13 }}>
            Supabase: {getSupabaseUrlForDisplay()}
          </Text>
          {(businessLoading || sessionLoading) && !guardError ? <ActivityIndicator color={theme.primary} /> : null}
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

        {draft?.creative ? (
          <View style={{ borderRadius: Radii.md, borderWidth: 1, borderColor: theme.border, padding: Spacing.md, gap: Spacing.md }}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: "900" }}>Draft Preview</Text>
            <RenderedAdPreview business={business} draft={draft} stylePreset={stylePreset} />
            {draft.image_signed_url ? (
              <Image
                source={{ uri: draft.image_signed_url }}
                resizeMode="cover"
                style={{
                  width: "100%",
                  aspectRatio: 4 / 5,
                  borderRadius: Radii.md,
                  backgroundColor: theme.surfaceMuted,
                }}
              />
            ) : null}
            <PreviewRow label="Headline" value={draft.creative.headline ?? "(missing)"} />
            <PreviewRow label="Supporting copy" value={draft.creative.supportingCopy ?? "(missing)"} />
            <PreviewRow label="Text-free image prompt" value={draft.creative.imagePrompt ?? "(missing)"} />
            <PreviewRow
              label="Private image"
              value={
                draft.image_asset_path
                  ? `${draft.image_provider ?? "image"} stored privately at ${draft.image_asset_path}`
                  : draft.image_generation_error_code
                    ? `No image stored (${draft.image_generation_error_code})`
                    : "No image generated for this mode"
              }
            />
            <PreviewRow label="Style" value={draft.creative.stylePreset ?? stylePreset} />
            <PreviewRow label="Layout recommendation" value={draft.creative.layoutRecommendation ?? "(missing)"} />
            <PreviewRow label="Offer" value={`${offerType}: ${offerTerms}`} />
            <PreviewRow label="Window and quantity" value={`${startTime} to ${endTime} · ${quantityLimit} available`} />
            <PreviewRow label="CTA" value={draft.creative.lockedOffer?.cta ?? DEV_RENDER_CTA} />
            <PreviewRow label="Job status" value={`ready · dry-run ${draft.dry_run === true ? "on" : "off"} · publishing disabled`} />
          </View>
        ) : null}

        <SecondaryButton title="Back to Diagnostics" onPress={() => router.back()} />
      </ScrollView>
    </View>
  );
}
