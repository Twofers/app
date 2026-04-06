import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import type { GeneratedAd } from "@/lib/ad-variants";
import { useCreateMenuOfferWizard } from "@/lib/create-menu-offer-wizard-context";
import { aiRefineAdCopy, getErrorCode } from "@/lib/functions";
import { splitSubheadlineForPromoAndBody } from "@/lib/menu-ad-copy";
import { useBusiness } from "@/hooks/use-business";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { resolveDealFlowLanguage } from "@/lib/translate-deal-quality";
import { Colors, Radii } from "@/constants/theme";

function normalizeDraft(raw: Record<string, unknown>, fallback: GeneratedAd): GeneratedAd {
  const lane = raw.creative_lane;
  const l =
    lane === "value" || lane === "neighborhood" || lane === "premium"
      ? lane
      : fallback.creative_lane;
  return {
    creative_lane: l,
    headline: typeof raw.headline === "string" ? raw.headline : fallback.headline,
    subheadline: typeof raw.subheadline === "string" ? raw.subheadline : fallback.subheadline,
    cta: typeof raw.cta === "string" ? raw.cta : fallback.cta,
    style_label: typeof raw.style_label === "string" ? raw.style_label : fallback.style_label,
    rationale: typeof raw.rationale === "string" ? raw.rationale : fallback.rationale,
    visual_direction:
      typeof raw.visual_direction === "string" ? raw.visual_direction : fallback.visual_direction,
  };
}

export default function AdRefineScreen() {
  const router = useRouter();
  const { variantIndex: variantIndexRaw } = useLocalSearchParams<{ variantIndex?: string }>();
  const rawIdx = variantIndexRaw;
  const variantIdx = rawIdx === undefined || rawIdx === "" ? 0 : Number(rawIdx);
  const indexIsValid =
    rawIdx === undefined ||
    rawIdx === "" ||
    (Number.isFinite(variantIdx) && Number.isInteger(variantIdx) && variantIdx >= 0 && variantIdx <= 2);
  const { t, i18n } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { businessId, businessPreferredLocale } = useBusiness();
  const dealLang = resolveDealFlowLanguage(businessPreferredLocale, i18n.language);

  const {
    structuredOffer,
    adsWorking,
    updateWorkingAd,
    resetAdToOriginal,
    refineHistory,
    setRefineHistory,
  } = useCreateMenuOfferWizard();

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "info" } | null>(null);

  const adsReady = Boolean(adsWorking && adsWorking.length === 3);
  const ad = useMemo(() => {
    if (!adsReady || !indexIsValid) return null;
    return adsWorking![variantIdx] ?? null;
  }, [adsWorking, adsReady, indexIsValid, variantIdx]);

  const invalidVariant =
    Boolean(structuredOffer && adsReady && (!indexIsValid || ad == null));

  const sendInstruction = useCallback(async () => {
    const instr = input.trim();
    if (!businessId || !structuredOffer || !ad) return;
    if (!instr) return;
    setSending(true);
    setBanner(null);
    const userTurn = { role: "user" as const, content: instr };
    const nextHistory = [...refineHistory, userTurn];
    try {
      const { draft, usage } = await aiRefineAdCopy({
        business_id: businessId,
        structured_offer: structuredOffer as unknown as Record<string, unknown>,
        selected_draft: ad as unknown as Record<string, unknown>,
        instruction: instr,
        conversation_history: refineHistory.map((h) => ({ role: h.role, content: h.content })),
        output_language: dealLang,
      });
      const normalized = normalizeDraft(draft as unknown as Record<string, unknown>, ad);
      updateWorkingAd(variantIdx, normalized);
      const assistantBody = JSON.stringify({
        draft: normalized,
        usage,
      });
      setRefineHistory([...nextHistory, { role: "assistant", content: assistantBody }]);
      setInput("");
    } catch (e) {
      const code = getErrorCode(e);
      const fallback = e instanceof Error ? e.message : t("adRefine.errRefine");
      setBanner({
        message: code === "MONTHLY_LIMIT" ? t("menuWorkflow.errMonthlyLimit") : fallback,
        tone: "error",
      });
    } finally {
      setSending(false);
    }
  }, [
    businessId,
    structuredOffer,
    ad,
    input,
    refineHistory,
    dealLang,
    variantIdx,
    updateWorkingAd,
    setRefineHistory,
    t,
  ]);

  const onReset = useCallback(() => {
    resetAdToOriginal(variantIdx);
    setRefineHistory([]);
    setBanner(null);
  }, [resetAdToOriginal, variantIdx, setRefineHistory]);

  if (!structuredOffer || !adsReady) {
    return (
      <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, justifyContent: "center" }}>
        <Text style={{ opacity: 0.75 }}>{t("adRefine.emptySession")}</Text>
      </View>
    );
  }

  if (invalidVariant) {
    return (
      <View
        style={{
          flex: 1,
          paddingTop: top,
          paddingHorizontal: horizontal,
          justifyContent: "center",
          gap: Spacing.md,
        }}
      >
        <Text style={{ opacity: 0.85 }}>{t("adRefine.errInvalidVariant")}</Text>
        <SecondaryButton title={t("adRefine.goBack")} onPress={() => router.back()} />
      </View>
    );
  }

  if (ad == null) {
    return (
      <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, justifyContent: "center" }}>
        <Text style={{ opacity: 0.75 }}>{t("adRefine.emptySession")}</Text>
      </View>
    );
  }

  const displayMessages = refineHistory.filter((m) => m.role === "user");
  const previewSplit = splitSubheadlineForPromoAndBody(ad.subheadline ?? "");

  return (
    <KeyboardScreen>
      <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
        <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: Spacing.sm }}>
          {t("adRefine.title")}
        </Text>
        {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

        <View
          style={{
            padding: Spacing.md,
            borderRadius: Radii.md,
            borderWidth: 1,
            borderColor: Colors.light.border,
            marginBottom: Spacing.md,
            backgroundColor: Colors.light.surface,
            gap: 6,
          }}
        >
          <Text style={{ fontWeight: "800" }}>{ad.headline}</Text>
          {previewSplit.bodyCopy ? (
            <>
              <Text style={{ fontSize: 12, fontWeight: "700", opacity: 0.55 }}>
                {t("adRefine.promoLineLabel")}
              </Text>
              <Text style={{ opacity: 0.85 }}>{previewSplit.promoLine}</Text>
              <Text style={{ fontSize: 12, fontWeight: "700", opacity: 0.55, marginTop: 4 }}>
                {t("adRefine.bodyCopyLabel")}
              </Text>
              <Text style={{ opacity: 0.8 }}>{previewSplit.bodyCopy}</Text>
            </>
          ) : (
            <Text style={{ opacity: 0.85 }}>{ad.subheadline}</Text>
          )}
          <Text style={{ fontWeight: "700" }}>{ad.cta}</Text>
        </View>

        <Text style={{ fontWeight: "600", marginBottom: 6 }}>{t("adRefine.yourEdits")}</Text>
        <FlatList
          data={displayMessages}
          keyExtractor={(_, i) => `u-${i}`}
          style={{ flex: 1, marginBottom: Spacing.sm }}
          {...FORM_SCROLL_KEYBOARD_PROPS}
          renderItem={({ item }) => (
            <View
              style={{
                alignSelf: "flex-end",
                maxWidth: "90%",
                backgroundColor: Colors.light.primary,
                padding: 10,
                borderRadius: 12,
                marginBottom: 8,
              }}
            >
              <Text style={{ color: Colors.light.primaryText }}>{item.content}</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={{ opacity: 0.5 }}>—</Text>}
        />

        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={t("adRefine.placeholder")}
          multiline
          style={{
            minHeight: 72,
            borderWidth: 1,
            borderColor: "#ccc",
            borderRadius: 12,
            padding: 12,
            marginBottom: Spacing.sm,
            textAlignVertical: "top",
          }}
        />
        <PrimaryButton
          title={sending ? t("adRefine.sending") : t("adRefine.send")}
          onPress={() => void sendInstruction()}
          disabled={sending || !input.trim()}
        />
        {sending ? <ActivityIndicator style={{ marginTop: 8 }} /> : null}
        <SecondaryButton title={t("adRefine.reset")} onPress={onReset} />
        <View style={{ height: scrollBottom }} />
      </View>
    </KeyboardScreen>
  );
}
