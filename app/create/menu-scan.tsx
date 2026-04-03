import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { Colors, Radii } from "../../constants/theme";
import { useBusiness } from "../../hooks/use-business";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { Image } from "expo-image";
import {
  extractMenuFromImage,
  saveExtractedItems,
  type ExtractedMenuItem,
} from "../../lib/menu-items";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

async function fileUriToBase64(uri: string): Promise<string> {
  if (Platform.OS !== "web") {
    return FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  }
  const res = await fetch(uri);
  const buf = await res.arrayBuffer();
  return arrayBufferToBase64(buf);
}

export default function MenuScanScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { isLoggedIn, businessId, loading } = useBusiness();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [extractPrices, setExtractPrices] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{
    message: string;
    tone: "error" | "success" | "info";
  } | null>(null);
  const [items, setItems] = useState<ExtractedMenuItem[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setBanner({ message: t("menuScan.errPhotoPermission"), tone: "error" });
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.65,
      base64: false,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    setImageUri(picked.assets[0].uri);
    setItems([]);
    setConfidence(null);
    setBanner(null);
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setBanner({ message: t("menuScan.errCameraPermission"), tone: "error" });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.65,
      base64: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setImageUri(result.assets[0].uri);
    setItems([]);
    setConfidence(null);
    setBanner(null);
  }

  async function extractItems() {
    if (!imageUri || !businessId) return;
    setExtracting(true);
    setBanner(null);
    try {
      const base64 = await fileUriToBase64(imageUri);
      const result = await extractMenuFromImage(base64, businessId, extractPrices);
      if (result.error) {
        setBanner({ message: result.error, tone: "error" });
        return;
      }
      setItems(result.items);
      setConfidence(result.confidence);
      if (result.items.length === 0) {
        setBanner({ message: t("menuScan.noItemsFound"), tone: "info" });
      } else {
        setBanner({
          message: t("menuScan.itemsFound", { count: result.items.length }),
          tone: "success",
        });
      }
    } catch (err: any) {
      setBanner({
        message: err?.message ?? t("menuScan.errExtractFailed"),
        tone: "error",
      });
    } finally {
      setExtracting(false);
    }
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateItem(index: number, field: keyof ExtractedMenuItem, value: string) {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        if (field === "price") {
          const num = value.trim() ? Number(value) : null;
          return { ...item, price: num };
        }
        return { ...item, [field]: value || null };
      }),
    );
  }

  async function saveAll() {
    if (!businessId || items.length === 0) return;
    setSaving(true);
    setBanner(null);
    try {
      await saveExtractedItems(businessId, items);
      setBanner({ message: t("menuScan.saved"), tone: "success" });
      setTimeout(() => {
        router.replace("/create/menu-manager");
      }, 600);
    } catch (err: any) {
      setBanner({ message: err?.message ?? t("menuScan.errSaveFailed"), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  if (!isLoggedIn || loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>
        {t("menuScan.title")}
      </Text>
      <Text style={{ marginTop: 6, opacity: 0.7, lineHeight: 20 }}>
        {t("menuScan.subtitle")}
      </Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      <ScrollView
        style={{ flex: 1, marginTop: Spacing.lg }}
        contentContainerStyle={{ gap: Spacing.md, paddingBottom: scrollBottom }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Image capture */}
        <View style={{ flexDirection: "row", gap: Spacing.sm }}>
          <View style={{ flex: 1 }}>
            <PrimaryButton title={t("menuScan.takePhoto")} onPress={takePhoto} />
          </View>
          <View style={{ flex: 1 }}>
            <SecondaryButton title={t("menuScan.pickFromLibrary")} onPress={pickImage} />
          </View>
        </View>

        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={{ width: "100%", height: 200, borderRadius: Radii.lg }}
            contentFit="cover"
          />
        ) : null}

        {/* Price extraction toggle */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: Spacing.sm,
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: "600" }}>
            {t("menuScan.extractPrices")}
          </Text>
          <Switch
            value={extractPrices}
            onValueChange={setExtractPrices}
            trackColor={{ true: Colors.light.primary }}
          />
        </View>

        {/* Extract button */}
        {imageUri && items.length === 0 ? (
          <PrimaryButton
            title={extracting ? t("menuScan.extracting") : t("menuScan.extractButton")}
            onPress={extractItems}
            disabled={extracting}
          />
        ) : null}

        {/* Extracted items review */}
        {items.length > 0 ? (
          <View style={{ gap: Spacing.md }}>
            <Text style={{ fontWeight: "700", fontSize: 16 }}>
              {t("menuScan.reviewItems")} ({items.length})
            </Text>
            {confidence != null ? (
              <Text style={{ fontSize: 13, opacity: 0.6 }}>
                {t("menuScan.confidence", { pct: Math.round(confidence * 100) })}
              </Text>
            ) : null}

            {items.map((item, idx) => (
              <View
                key={idx}
                style={{
                  borderRadius: Radii.lg,
                  backgroundColor: Colors.light.surface,
                  borderWidth: 1,
                  borderColor: Colors.light.border,
                  padding: Spacing.md,
                  gap: Spacing.sm,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "700",
                      opacity: 0.5,
                      textTransform: "uppercase",
                    }}
                  >
                    {item.category ?? t("menuScan.uncategorized")}
                  </Text>
                  <Pressable onPress={() => removeItem(idx)}>
                    <Text style={{ color: "#e33", fontWeight: "700", fontSize: 13 }}>
                      {t("menuScan.remove")}
                    </Text>
                  </Pressable>
                </View>
                <TextInput
                  value={item.name}
                  onChangeText={(v) => updateItem(idx, "name", v)}
                  style={{
                    fontWeight: "700",
                    fontSize: 16,
                    borderBottomWidth: 1,
                    borderBottomColor: Colors.light.border,
                    paddingBottom: 4,
                  }}
                  placeholder={t("menuScan.itemName")}
                />
                <TextInput
                  value={item.description ?? ""}
                  onChangeText={(v) => updateItem(idx, "description", v)}
                  style={{
                    fontSize: 14,
                    opacity: 0.7,
                    borderBottomWidth: 1,
                    borderBottomColor: Colors.light.border,
                    paddingBottom: 4,
                  }}
                  placeholder={t("menuScan.itemDescription")}
                />
                <View style={{ flexDirection: "row", gap: Spacing.sm, alignItems: "center" }}>
                  <Text style={{ fontSize: 14, fontWeight: "600" }}>$</Text>
                  <TextInput
                    value={item.price != null ? String(item.price) : ""}
                    onChangeText={(v) => updateItem(idx, "price", v)}
                    keyboardType="decimal-pad"
                    style={{
                      flex: 1,
                      fontSize: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: Colors.light.border,
                      paddingBottom: 4,
                    }}
                    placeholder={t("menuScan.itemPrice")}
                  />
                  <TextInput
                    value={item.category ?? ""}
                    onChangeText={(v) => updateItem(idx, "category", v)}
                    style={{
                      flex: 1,
                      fontSize: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: Colors.light.border,
                      paddingBottom: 4,
                    }}
                    placeholder={t("menuScan.itemCategory")}
                  />
                </View>
              </View>
            ))}

            <PrimaryButton
              title={saving ? t("menuScan.saving") : t("menuScan.saveAll")}
              onPress={saveAll}
              disabled={saving || items.length === 0}
              style={{ height: 66, borderRadius: 20, marginTop: 4 }}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
