/**
 * Express deal flow: photo / menu item -> AI offer draft -> review -> publish.
 *
 * Deliberately lean. The full editor (app/create/ai.tsx) stays one tap away via
 * "More options" for scheduling, pricing, recurring windows, multi-location, etc.
 *
 * The strong-deal guard is NOT weakened here: this screen runs the same client
 * mirror (validateStrongDealOnly) as the full editor, and every insert still hits
 * the server-side SQL trigger that hard-rejects weak deals.
 */
import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { useBusiness } from "@/hooks/use-business";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Banner } from "@/components/ui/banner";
import { KeyboardScreen, FORM_SCROLL_KEYBOARD_PROPS } from "@/components/ui/keyboard-screen";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { supabase } from "@/lib/supabase";
import { aiGenerateAd, notifyDealPublished, translateDeal } from "@/lib/functions";
import { adToDealDraft, composeListingDescription, type GeneratedAd } from "@/lib/ad-variants";
import { assessDealQuality } from "@/lib/deal-quality";
import { resolveDealFlowLanguage, translateDealQualityBlock } from "@/lib/translate-deal-quality";
import { validateStrongDealOnly } from "@/lib/strong-deal-guard";
import { buildPublicDealPhotoUrl } from "@/lib/deal-poster-url";
import { uploadDealPhoto } from "@/lib/upload-deal-photo";
import { markRecentPublish } from "@/lib/recent-publish";

// Express defaults; owners who need to tune these use "More options" (the full editor).
const EXPRESS_DURATION_DAYS = 7;
const EXPRESS_MAX_CLAIMS = 50;
const EXPRESS_CUTOFF_MINUTES = 15;

type BannerState = { message: string; tone: "error" | "success" | "info" | "warning" };

export default function QuickDealExpress() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { businessId, businessContextForAi, businessPreferredLocale } = useBusiness();
  const dealOutputLang = resolveDealFlowLanguage(businessPreferredLocale, i18n.language);
  const theme = Colors.light;

  const [hint, setHint] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [draft, setDraft] = useState<GeneratedAd | null>(null);
  const [title, setTitle] = useState("");
  const [offerLine, setOfferLine] = useState("");
  const [banner, setBanner] = useState<BannerState | null>(null);

  const posterUri = draft?.poster_storage_path
    ? buildPublicDealPhotoUrl(draft.poster_storage_path)
    : photoUri;

  function resetDraft() {
    setDraft(null);
    setTitle("");
    setOfferLine("");
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
    setGenerating(true);
    setBanner(null);
    try {
      let path = photoPath;
      if (photoUri && !path) {
        path = await uploadDealPhoto(businessId, photoUri);
        setPhotoPath(path);
      }
      const { ad } = await aiGenerateAd({
        business_id: businessId,
        hint_text: hint.trim(),
        business_context: businessContextForAi,
        output_language: dealOutputLang,
        ...(path ? { photo_path: path } : {}),
      });
      const d = adToDealDraft(ad, hint);
      setDraft(ad);
      setTitle(d.title);
      setOfferLine(d.promo_line || d.offer_details);
    } catch (err) {
      setBanner({ message: friendlyGenerateError(err, t), tone: "error" });
    } finally {
      setGenerating(false);
    }
  }

  async function onPublish() {
    if (!businessId || !draft) return;
    const cleanTitle = title.trim();
    const cleanOffer = offerLine.trim();
    if (!cleanTitle) {
      setBanner({ message: t("createQuick.needTitle"), tone: "info" });
      return;
    }

    // Same composition the full editor uses: the CTA is included only for the
    // guard checks (so an offer phrase living in the CTA still validates), while
    // the stored description omits it (the card renders its own Claim button).
    const guardDescription = composeListingDescription(cleanOffer, draft.cta ?? "", "");
    const listingDescription = cleanOffer;

    const quality = assessDealQuality({ title: cleanTitle, description: guardDescription, price: null });
    if (quality.blocked) {
      setBanner({ message: translateDealQualityBlock(quality, dealOutputLang), tone: "error" });
      return;
    }
    const guard = validateStrongDealOnly({ title: cleanTitle, description: guardDescription });
    if (!guard.ok) {
      const key = `dealQuality.strongGuard.${guard.reason}`;
      setBanner({ message: t(key, { defaultValue: t("dealQuality.strongDealMessage") }), tone: "warning" });
      return;
    }

    setPublishing(true);
    setBanner(null);
    try {
      const posterPath = draft.poster_storage_path ?? photoPath ?? null;
      const posterPublic = posterPath ? buildPublicDealPhotoUrl(posterPath) : null;
      const now = new Date();
      const end = new Date(now.getTime() + EXPRESS_DURATION_DAYS * 24 * 60 * 60 * 1000);

      const { data, error } = await supabase
        .from("deals")
        .insert({
          business_id: businessId,
          title: cleanTitle,
          description: listingDescription,
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
        })
        .select("id");
      if (error) throw error;

      const id = data?.[0]?.id as string | undefined;
      if (id) {
        void notifyDealPublished(id);
        void translateDeal(id);
      }
      await markRecentPublish(cleanTitle);
      router.replace("/(tabs)");
    } catch (err) {
      setBanner({ message: publishErrorMessage(err, t), tone: "error" });
    } finally {
      setPublishing(false);
    }
  }

  function goToFullEditor() {
    router.push({ pathname: "/create/ai", params: hint.trim() ? { hint: hint.trim() } : {} } as Href);
  }

  const strongHint =
    draft && title.trim()
      ? validateStrongDealOnly({
          title: title.trim(),
          description: composeListingDescription(offerLine.trim(), draft.cta ?? "", ""),
        })
      : null;

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

            <Pressable onPress={goToFullEditor} style={{ marginTop: Spacing.lg, alignItems: "center" }}>
              <Text style={{ color: theme.mutedText, fontSize: 14, fontWeight: "600" }}>
                {t("createQuick.advanced")}
              </Text>
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
              style={{
                marginTop: 6,
                borderWidth: 1.5,
                borderColor: theme.border,
                borderRadius: Radii.md,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 16,
                fontWeight: "700",
                color: theme.text,
                backgroundColor: theme.surface,
              }}
            />

            <Text style={{ marginTop: Spacing.md, fontWeight: "700", fontSize: 13, color: theme.text }}>
              {t("createQuick.offerLineLabel")}
            </Text>
            <TextInput
              value={offerLine}
              onChangeText={setOfferLine}
              multiline
              style={{
                marginTop: 6,
                borderWidth: 1.5,
                borderColor: theme.border,
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

            {strongHint && !strongHint.ok ? (
              <Text style={{ marginTop: 8, fontSize: 12, color: theme.danger }}>
                {t("dealQuality.strongDealMessage")}
              </Text>
            ) : null}

            <View style={{ marginTop: Spacing.lg }}>
              <PrimaryButton
                title={publishing ? t("createAi.publishing") : t("createAi.publishDeal")}
                onPress={() => void onPublish()}
                disabled={publishing}
              />
            </View>
            <View style={{ marginTop: Spacing.sm }}>
              <SecondaryButton title={t("createQuick.startOver")} onPress={resetDraft} />
            </View>
            <Pressable onPress={goToFullEditor} style={{ marginTop: Spacing.md, alignItems: "center" }}>
              <Text style={{ color: theme.mutedText, fontSize: 14, fontWeight: "600" }}>
                {t("createQuick.advanced")}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardScreen>
  );
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
