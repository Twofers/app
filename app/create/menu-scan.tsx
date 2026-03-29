import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useBusiness } from "@/hooks/use-business";
import { aiExtractMenu } from "@/lib/functions";
import { looksLikeMissingMenuTable } from "@/lib/menu-workflow-errors";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { supabase } from "@/lib/supabase";
import { Colors, Radii } from "@/constants/theme";

type EditableRow = {
  key: string;
  name: string;
  category: string;
  price_text: string;
};

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function MenuScanScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { businessId, loading: bizLoading } = useBusiness();

  const [rows, setRows] = useState<EditableRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" } | null>(
    null,
  );

  const pickAndScan = useCallback(async () => {
    if (!businessId) {
      setBanner({ message: t("menuScan.needBusiness"), tone: "error" });
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setBanner({ message: "Photo library access is needed to pick a menu image.", tone: "error" });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.85,
      base64: true,
    });
    if (result.canceled || !result.assets[0]) {
      return;
    }
    const asset = result.assets[0];
    const b64 = asset.base64;
    if (!b64) {
      setBanner({ message: t("menuScan.errScan"), tone: "error" });
      return;
    }
    const mime: string =
      asset.mimeType != null && asset.mimeType.startsWith("image/") ? asset.mimeType : "image/jpeg";
    setScanning(true);
    setBanner(null);
    try {
      const out = await aiExtractMenu({
        business_id: businessId,
        image_base64: b64,
        image_mime_type: mime,
      });
      const next: EditableRow[] = out.items.map((it) => ({
        key: newKey(),
        name: it.name,
        category: it.category ?? "",
        price_text: it.price_text ?? "",
      }));
      setRows(next);
      if (next.length === 0) {
        setBanner({ message: t("menuScan.emptyExtract"), tone: "info" });
      } else if (out.low_legibility) {
        setBanner({ message: t("menuScan.lowLegibility"), tone: "info" });
      }
    } catch (e) {
      setBanner({
        message: e instanceof Error ? e.message : t("menuScan.errScan"),
        tone: "error",
      });
    } finally {
      setScanning(false);
    }
  }, [businessId, t]);

  const addRow = useCallback(() => {
    setRows((r) => [...r, { key: newKey(), name: "", category: "", price_text: "" }]);
  }, []);

  const removeRow = useCallback((key: string) => {
    setRows((r) => r.filter((x) => x.key !== key));
  }, []);

  const saveMenu = useCallback(async () => {
    if (!businessId) {
      setBanner({ message: t("menuScan.needBusiness"), tone: "error" });
      return;
    }
    const valid = rows
      .map((r) => ({ ...r, name: r.name.trim() }))
      .filter((r) => r.name.length > 0);
    if (valid.length === 0) {
      setBanner({ message: t("menuScan.emptyExtract"), tone: "error" });
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      const payload = valid.map((r, i) => ({
        business_id: businessId,
        name: r.name,
        category: r.category.trim() || null,
        price_text: r.price_text.trim() || null,
        sort_order: i,
        source: "scan" as const,
      }));
      const { error } = await supabase.from("business_menu_items").insert(payload);
      if (error) throw new Error(error.message);
      setBanner({ message: t("menuScan.saved"), tone: "success" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("menuScan.errScan");
      setBanner({
        message: looksLikeMissingMenuTable(msg) ? t("menuWorkflow.errSchema") : msg,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }, [businessId, rows, t]);

  if (bizLoading) {
    return (
      <View style={{ flex: 1, paddingTop: top, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

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
      <Text style={{ fontSize: 22, fontWeight: "700" }}>{t("menuScan.title")}</Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      <PrimaryButton
        title={scanning ? t("menuScan.scanning") : t("menuScan.pickImage")}
        onPress={() => void pickAndScan()}
        disabled={scanning || !businessId}
      />
      {rows.length > 0 ? (
        <>
          <SecondaryButton title={t("menuScan.addRow")} onPress={addRow} />
          <FlatList
            data={rows}
            keyExtractor={(item) => item.key}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View
                style={{
                  marginBottom: Spacing.md,
                  padding: Spacing.md,
                  borderRadius: Radii.md,
                  borderWidth: 1,
                  borderColor: Colors.light.border,
                  backgroundColor: Colors.light.surface,
                  gap: Spacing.sm,
                }}
              >
                <TextInput
                  value={item.name}
                  onChangeText={(text) =>
                    setRows((prev) =>
                      prev.map((x) => (x.key === item.key ? { ...x, name: text } : x)),
                    )
                  }
                  placeholder={t("menuScan.namePlaceholder")}
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                  }}
                />
                <TextInput
                  value={item.category}
                  onChangeText={(text) =>
                    setRows((prev) =>
                      prev.map((x) => (x.key === item.key ? { ...x, category: text } : x)),
                    )
                  }
                  placeholder={t("menuScan.categoryPlaceholder")}
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                  }}
                />
                <TextInput
                  value={item.price_text}
                  onChangeText={(text) =>
                    setRows((prev) =>
                      prev.map((x) => (x.key === item.key ? { ...x, price_text: text } : x)),
                    )
                  }
                  placeholder={t("menuScan.pricePlaceholder")}
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                  }}
                />
                <Pressable onPress={() => removeRow(item.key)}>
                  <Text style={{ color: "#c62828", fontWeight: "600" }}>{t("menuScan.removeLine")}</Text>
                </Pressable>
              </View>
            )}
          />
          <PrimaryButton
            title={saving ? t("menuScan.saving") : t("menuScan.save")}
            onPress={() => void saveMenu()}
            disabled={saving}
          />
          <SecondaryButton
            title={t("menuScan.buildOffer")}
            onPress={() => router.push("/create/menu-offer" as Href)}
          />
        </>
      ) : (
        <Text style={{ opacity: 0.7 }}>{t("menuScan.emptyExtract")}</Text>
      )}
    </ScrollView>
  );
}
