import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { File as ExpoFsFile } from "expo-file-system";
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect, useNavigation, useRouter, type Href } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { useBusiness } from "@/hooks/use-business";
import { Banner } from "@/components/ui/banner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import {
  aiComposeOfferGenerate,
  aiComposeOfferTranscribe,
  fetchAiComposeQuota,
  pickVariantCopyForLocale,
  type AiAdVariant,
  type AiComposeResultPayload,
  type AiComposeQuota,
} from "@/lib/ai-compose-offer";
import { buildPublicDealPhotoUrl } from "@/lib/deal-poster-url";

type UiPhase =
  | "idle"
  | "transcribing"
  | "generating"
  | "results"
  | "quota"
  | "cooldown"
  | "error";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

async function fileUriToBase64(uri: string): Promise<string> {
  // On native, expo-file-system handles file:// URIs correctly.
  // fetch(file://...) is blocked by the browser security model on web.
  if (Platform.OS !== "web") {
    return new ExpoFsFile(uri).base64();
  }
  const res = await fetch(uri);
  const buf = await res.arrayBuffer();
  return arrayBufferToBase64(buf);
}

function errCode(e: unknown): string | undefined {
  return e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : undefined;
}

function errQuota(e: unknown): AiComposeQuota | undefined {
  return e && typeof e === "object" && "quota" in e ? (e as { quota?: AiComposeQuota }).quota : undefined;
}

const QUOTA_FOCUS_MIN_MS = 30_000;

export default function AiComposeOfferScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { isLoggedIn, businessId, loading } = useBusiness();

  // Android LOW_QUALITY is .3gp + AMR-NB; Whisper expects AAC/M4A/MP4/WebM/etc. Use MPEG4+AAC on Android.
  const recorder = useAudioRecorder(
    Platform.OS === "android" ? RecordingPresets.HIGH_QUALITY : RecordingPresets.LOW_QUALITY,
  );

  const [prompt, setPrompt] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const [quota, setQuota] = useState<AiComposeQuota | null>(null);
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" } | null>(null);
  const [result, setResult] = useState<AiComposeResultPayload | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  const lastFocusQuotaFetchAtRef = useRef(0);

  const reloadQuota = useCallback(async () => {
    if (!businessId) return;
    const q = await fetchAiComposeQuota(businessId);
    setQuota(q);
  }, [businessId]);

  useFocusEffect(
    useCallback(() => {
      if (!businessId) return;
      const now = Date.now();
      const skip =
        quota !== null && now - lastFocusQuotaFetchAtRef.current < QUOTA_FOCUS_MIN_MS;
      if (skip) return;
      void reloadQuota().then(() => {
        lastFocusQuotaFetchAtRef.current = Date.now();
      });
    }, [businessId, reloadQuota, quota]),
  );

  const draftDirty = useMemo(
    () =>
      prompt.trim().length > 0 ||
      !!imageUri ||
      result != null ||
      isRecording ||
      phase === "transcribing" ||
      phase === "generating" ||
      phase === "results",
    [prompt, imageUri, result, isRecording, phase],
  );

  usePreventRemove(
    draftDirty,
    useCallback(
      ({ data }) => {
        Alert.alert(t("dealDraft.unsavedTitle"), t("dealDraft.unsavedBody"), [
          { text: t("dealDraft.keepEditing"), style: "cancel" },
          {
            text: t("dealDraft.discard"),
            style: "destructive",
            onPress: () => navigation.dispatch(data.action),
          },
        ]);
      },
      [navigation, t],
    ),
  );

  function handlePickedAsset(a: ImagePicker.ImagePickerAsset) {
    setImageUri(a.uri);
    if (a.base64) {
      const mime = a.mimeType ?? "image/jpeg";
      setImageBase64(`data:${mime};base64,${a.base64}`);
    } else {
      setImageBase64(null);
      setBanner({ message: t("aiCompose.errImageRead"), tone: "error" });
    }
  }

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setBanner({ message: t("aiCompose.errPhotoPermission"), tone: "error" });
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.65,
      base64: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    handlePickedAsset(picked.assets[0]);
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setBanner({ message: t("aiCompose.errCameraPermission"), tone: "error" });
      return;
    }
    const taken = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.65,
      base64: true,
    });
    if (taken.canceled || !taken.assets?.[0]) return;
    handlePickedAsset(taken.assets[0]);
  }

  async function startRecording() {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        setBanner({ message: t("aiCompose.errMicPermission"), tone: "error" });
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
      setBanner(null);
    } catch {
      setBanner({ message: t("aiCompose.errRecordingStart"), tone: "error" });
    }
  }

  async function stopRecordingAndTranscribe() {
    if (!businessId || !isRecording) return;
    setIsRecording(false);
    setPhase("transcribing");
    setBanner(null);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("no_uri");
      const b64 = await fileUriToBase64(uri);
      const { transcript } = await aiComposeOfferTranscribe({ business_id: businessId, audio_base64: b64 });
      if (transcript) {
        setPrompt((p) => (p.trim() ? `${p.trim()}\n${transcript}` : transcript));
        setBanner({ message: t("aiCompose.transcribeDone"), tone: "success" });
      } else {
        setBanner({ message: t("aiCompose.transcribeEmpty"), tone: "info" });
      }
      setPhase("idle");
    } catch (e: unknown) {
      const code = errCode(e);
      if (code === "COOLDOWN_ACTIVE") {
        setPhase("cooldown");
        setBanner({ message: t("aiCompose.cooldownTranscribe"), tone: "info" });
      } else {
        setBanner({
          message: e instanceof Error ? e.message : t("aiCompose.transcribeFailed"),
          tone: "error",
        });
        setPhase("idle");
      }
    }
  }

  async function onGenerate() {
    if (!businessId) return;
    const hasImg = !!imageBase64;
    const hasTxt = prompt.trim().length > 0;
    if (!hasImg && !hasTxt) {
      setBanner({ message: t("aiCompose.errNeedInput"), tone: "error" });
      return;
    }
    setPhase("generating");
    setBanner(null);
    setResult(null);
    setSelectedVariantId(null);
    try {
      const out = await aiComposeOfferGenerate({
        business_id: businessId,
        prompt_text: hasTxt ? prompt : undefined,
        image_base64: hasImg ? imageBase64! : undefined,
        generate_poster_image: !hasImg && hasTxt,
      });
      setResult(out.result);
      setQuota(out.quota);
      setPhase("results");
      if (out.duplicate_cached) {
        setBanner({ message: t("aiCompose.duplicateCached"), tone: "info" });
      }
    } catch (e: unknown) {
      const code = errCode(e);
      const q = errQuota(e);
      if (q) setQuota(q);
      if (code === "QUOTA_EXCEEDED") {
        setPhase("quota");
        setBanner({ message: t("aiCompose.quotaExceededBody"), tone: "info" });
      } else if (code === "COOLDOWN_ACTIVE") {
        setPhase("cooldown");
        setBanner({ message: t("aiCompose.cooldownGenerate"), tone: "info" });
      } else if (code === "PROFILE_INCOMPLETE") {
        setBanner({ message: t("aiCompose.profileIncomplete"), tone: "error" });
        setPhase("idle");
      } else {
        setBanner({
          message: e instanceof Error ? e.message : t("aiCompose.genericError"),
          tone: "error",
        });
        setPhase("idle");
      }
    }
  }

  function applyVariant(v: AiAdVariant) {
    const copy = pickVariantCopyForLocale(v, i18n.language);
    const ro = result?.recommended_offer;
    const title = [copy.headline, ro?.item_name].filter(Boolean).join(" · ").slice(0, 120);
    const hint = [ro?.display_offer, copy.sub, copy.cta].filter(Boolean).join(" — ").slice(0, 500);
    const posterPath = result?.poster_storage_path?.trim();
    router.push({
      pathname: "/create/quick",
      params: {
        prefillTitle: title,
        prefillHint: hint,
        fromAiCompose: "1",
        ...(posterPath ? { prefillPosterPath: posterPath } : {}),
      },
    } as Href);
  }

  function renderVariantCard(v: AiAdVariant, recommended: boolean) {
    const copy = pickVariantCopyForLocale(v, i18n.language);
    const selected = selectedVariantId === v.variant_id;
    return (
      <Pressable
        key={v.variant_id}
        onPress={() => setSelectedVariantId(v.variant_id)}
        style={{
          borderRadius: 16,
          padding: Spacing.md,
          marginBottom: Spacing.md,
          borderWidth: 2,
          borderColor: selected ? "#111" : "#e5e5e5",
          backgroundColor: "#fafafa",
        }}
      >
        {recommended ? (
          <Text style={{ fontSize: 11, fontWeight: "800", opacity: 0.5, marginBottom: 6 }}>
            {t("aiCompose.recommendedTag")}
          </Text>
        ) : null}
        <Text style={{ fontSize: 12, fontWeight: "700", opacity: 0.45, marginBottom: 4 }}>{v.style_label}</Text>
        <Text style={{ fontSize: 18, fontWeight: "800" }}>{copy.headline}</Text>
        <Text style={{ marginTop: 6, opacity: 0.78, fontSize: 15, lineHeight: 22 }}>{copy.sub}</Text>
        <Text style={{ marginTop: Spacing.sm, fontWeight: "700", fontSize: 14 }}>{copy.cta}</Text>
        <PrimaryButton
          title={t("aiCompose.useThisOption")}
          onPress={() => applyVariant(v)}
          style={{ marginTop: Spacing.md }}
        />
      </Pressable>
    );
  }

  const busy = phase === "generating" || phase === "transcribing";

  return (
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 20, fontWeight: "700", letterSpacing: -0.3 }}>{t("aiCompose.title")}</Text>
        {quota ? (
          <Text style={{ fontSize: 12, opacity: 0.5 }}>
            {t("aiCompose.usageLeft", { remaining: quota.remaining, limit: quota.limit })}
          </Text>
        ) : null}
      </View>
      <Text style={{ marginTop: 2, opacity: 0.55, fontSize: 12, lineHeight: 16 }}>{t("aiCompose.subtitle")}</Text>

      {quota && quota.remaining <= 5 && quota.remaining > 0 ? (
        <Banner message={t("aiCompose.quotaWarning", { remaining: quota.remaining })} tone="info" />
      ) : null}
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {!isLoggedIn || loading ? (
        <Text style={{ marginTop: Spacing.lg }}>{t("aiCompose.loginOrLoad")}</Text>
      ) : !businessId ? (
        <Text style={{ marginTop: Spacing.lg }}>{t("aiCompose.needBusiness")}</Text>
      ) : (
        <ScrollView
          style={{ flex: 1, marginTop: Spacing.md }}
          contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.sm }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md, flexWrap: "wrap" }}>
            <SecondaryButton title={t("aiCompose.reuseSavedAds")} onPress={() => router.push("/create/reuse" as Href)} />
          </View>

          {phase === "quota" ? (
            <View style={{ gap: Spacing.md, marginBottom: Spacing.lg }}>
              <Text style={{ fontSize: 16, fontWeight: "700" }}>{t("aiCompose.quotaExceededTitle")}</Text>
              <Text style={{ opacity: 0.75, lineHeight: 22 }}>{t("aiCompose.quotaExceededBody")}</Text>
              <PrimaryButton title={t("aiCompose.ctaReuseAds")} onPress={() => router.push("/create/reuse" as Href)} />
              <SecondaryButton title={t("aiCompose.ctaQuickDeal")} onPress={() => router.push("/create/quick" as Href)} />
            </View>
          ) : null}

          {result && phase === "results" ? (
            <View style={{ marginBottom: Spacing.lg }}>
              {result.low_confidence ? (
                <Banner message={t("aiCompose.lowConfidence", { reason: result.recommendation_reason ?? "" })} tone="info" />
              ) : null}
              <Text style={{ fontSize: 17, fontWeight: "800", marginBottom: Spacing.sm }}>{t("aiCompose.offerSummary")}</Text>
              <Text style={{ opacity: 0.8, marginBottom: Spacing.md, lineHeight: 22 }}>
                {result.recommended_offer?.display_offer}
              </Text>
              {result.poster_storage_path ? (
                <View style={{ marginBottom: Spacing.lg }}>
                  <Text style={{ fontSize: 15, fontWeight: "800", marginBottom: Spacing.sm }}>
                    {t("aiCompose.aiPosterPreview")}
                  </Text>
                  {(() => {
                    const posterUri = buildPublicDealPhotoUrl(result.poster_storage_path);
                    return posterUri ? (
                      <Image
                        source={{ uri: posterUri }}
                        style={{
                          width: "100%",
                          aspectRatio: 1,
                          borderRadius: 20,
                          backgroundColor: "#eee",
                        }}
                        contentFit="cover"
                      />
                    ) : null;
                  })()}
                </View>
              ) : null}
              <Text style={{ fontSize: 17, fontWeight: "800", marginBottom: Spacing.sm }}>{t("aiCompose.pickVariant")}</Text>
              {result.ad_variants.map((v, i) => renderVariantCard(v, i === 0))}
              <SecondaryButton
                title={t("aiCompose.regenerateHint")}
                onPress={() => {
                  setPhase("idle");
                  setResult(null);
                }}
              />
            </View>
          ) : null}

          {(!result || phase !== "results") && phase !== "quota" ? (
            <>
              <View
                style={{
                  marginTop: 4,
                  borderRadius: 14,
                  backgroundColor: "#f6f7fb",
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  alignSelf: "flex-start",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "800", letterSpacing: 0.2, opacity: 0.7 }}>
                  {t("aiCompose.stepOfTotal", { current: 1, total: 2 })}
                </Text>
              </View>
              <Text style={{ fontWeight: "700", marginBottom: 6, marginTop: 8 }}>{t("aiCompose.photoLabel")}</Text>
              {imageUri ? (
                <Pressable
                  onPress={pickImage}
                  style={{
                    borderWidth: 1.5,
                    borderColor: "#d8d8d8",
                    borderRadius: 20,
                    minHeight: 260,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: Spacing.md,
                    overflow: "hidden",
                    backgroundColor: "#f8f8f8",
                  }}
                >
                  <Image source={{ uri: imageUri }} style={{ width: "100%", height: 260 }} contentFit="cover" />
                </Pressable>
              ) : (
                <View style={{ flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md }}>
                  <Pressable
                    onPress={takePhoto}
                    style={{
                      flex: 1,
                      borderWidth: 1.5,
                      borderColor: "#cfd7ff",
                      borderRadius: 20,
                      minHeight: 160,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "#f3f6ff",
                    }}
                  >
                    <MaterialIcons name="camera-alt" size={36} color="#4d5ed9" />
                    <Text style={{ marginTop: 8, fontWeight: "700", fontSize: 14, opacity: 0.75 }}>
                      {t("aiCompose.takePhoto")}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={pickImage}
                    style={{
                      flex: 1,
                      borderWidth: 1.5,
                      borderColor: "#cfd7ff",
                      borderRadius: 20,
                      minHeight: 160,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "#f3f6ff",
                    }}
                  >
                    <MaterialIcons name="photo-library" size={36} color="#4d5ed9" />
                    <Text style={{ marginTop: 8, fontWeight: "700", fontSize: 14, opacity: 0.75 }}>
                      {t("aiCompose.fromGallery")}
                    </Text>
                  </Pressable>
                </View>
              )}

              <View
                style={{
                  borderRadius: 14,
                  backgroundColor: "#f6f7fb",
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  alignSelf: "flex-start",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "800", letterSpacing: 0.2, opacity: 0.7 }}>
                  {t("aiCompose.stepOfTotal", { current: 2, total: 2 })}
                </Text>
              </View>
              <Text style={{ fontWeight: "700", marginBottom: 6, marginTop: 8 }}>{t("aiCompose.promptLabel")}</Text>
              <View style={{ position: "relative" }}>
                <TextInput
                  value={prompt}
                  onChangeText={setPrompt}
                  placeholder={t("aiCompose.promptPlaceholder")}
                  multiline
                  style={{
                    borderWidth: 1,
                    borderColor: "#cfd3de",
                    borderRadius: 14,
                    padding: 14,
                    paddingRight: 52,
                    minHeight: 120,
                    textAlignVertical: "top",
                    fontSize: 16,
                    backgroundColor: "#fff",
                  }}
                />
                {Platform.OS !== "web" ? (
                  <Pressable
                    onPress={isRecording ? () => void stopRecordingAndTranscribe() : () => void startRecording()}
                    style={{
                      position: "absolute",
                      right: 10,
                      bottom: 10,
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: isRecording ? "#e0245e" : "#111",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {phase === "transcribing" ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <MaterialIcons name={isRecording ? "stop" : "mic"} size={22} color="#fff" />
                    )}
                  </Pressable>
                ) : null}
              </View>
              {Platform.OS !== "web" ? (
                <Text style={{ fontSize: 12, opacity: 0.5, marginTop: 6 }}>{t("aiCompose.micHint")}</Text>
              ) : null}

              <PrimaryButton
                title={busy ? t("aiCompose.generating") : t("aiCompose.generateCta")}
                onPress={() => void onGenerate()}
                disabled={busy}
                style={{ marginTop: Spacing.lg, height: 62, borderRadius: 18 }}
              />
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
