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

type StylePreset = typeof STYLE_PRESETS[number];

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
      publishingDisabled?: boolean;
      dryRun?: boolean;
      copyOnly?: boolean;
    };
    publishing_disabled?: boolean;
    dry_run?: boolean;
    copy_only?: boolean;
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
          style_preset: stylePreset,
          dry_run: true,
          copy_only: true,
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

        <PrimaryButton
          title={submitting ? "Generating..." : draft ? "Regenerate Draft" : "Generate Draft"}
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
            <PreviewRow label="Headline" value={draft.creative.headline ?? "(missing)"} />
            <PreviewRow label="Supporting copy" value={draft.creative.supportingCopy ?? "(missing)"} />
            <PreviewRow label="Text-free image prompt" value={draft.creative.imagePrompt ?? "(missing)"} />
            <PreviewRow label="Style" value={draft.creative.stylePreset ?? stylePreset} />
            <PreviewRow label="Offer" value={`${offerType}: ${offerTerms}`} />
            <PreviewRow label="Window and quantity" value={`${startTime} to ${endTime} · ${quantityLimit} available`} />
            <PreviewRow label="Job status" value={`ready · dry-run ${draft.dry_run === true ? "on" : "unknown"} · publishing disabled`} />
          </View>
        ) : null}

        <SecondaryButton title="Back to Diagnostics" onPress={() => router.back()} />
      </ScrollView>
    </View>
  );
}
