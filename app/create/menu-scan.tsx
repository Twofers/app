import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
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

/** Normalize for dedupe against saved library lines */
function libraryDedupeKey(name: string, priceText: string): string {
  return `${name.trim().toLowerCase()}|${priceText.trim().toLowerCase()}`;
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
  const [existingLibraryKeys, setExistingLibraryKeys] = useState<Set<string>>(() => new Set());
  const [skipDuplicatesOnSave, setSkipDuplicatesOnSave] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("business_menu_items")
        .select("name,price_text,archived_at")
        .eq("business_id", businessId);
      if (cancelled || error) return;
      const keys = new Set<string>();
      for (const row of data ?? []) {
        const r = row as { name: string; price_text: string | null; archived_at: string | null };
        if (r.archived_at) continue;
        keys.add(libraryDedupeKey(r.name, r.price_text ?? ""));
      }
      setExistingLibraryKeys(keys);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const pickAndScan = useCallback(
    async (source: "camera" | "library", append: boolean) => {
      if (!businessId) {
        setBanner({ message: t("menuScan.needBusiness"), tone: "error" });
        return;
      }
      // Camera: live capture (one photo). Library: pick up to 10 photos.
      if (source === "camera") {
        const camPerm = await ImagePicker.requestCameraPermissionsAsync();
        if (!camPerm.granted) {
          setBanner({ message: t("menuScan.cameraPermissionDenied"), tone: "error" });
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setBanner({ message: t("menuScan.photoPermissionDenied"), tone: "error" });
          return;
        }
      }
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ["images"],
              allowsEditing: false,
              quality: 0.85,
              base64: true,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              allowsEditing: false,
              quality: 0.85,
              base64: true,
              allowsMultipleSelection: true,
              selectionLimit: 10,
            });
      if (result.canceled || result.assets.length === 0) {
        return;
      }
      setScanning(true);
      setBanner(null);
      try {
        const merged: EditableRow[] = [];
        let anyLow = false;
        for (const asset of result.assets) {
          const b64 = asset.base64;
          if (!b64) continue;
          const mime: string =
            asset.mimeType != null && asset.mimeType.startsWith("image/") ? asset.mimeType : "image/jpeg";
          const out = await aiExtractMenu({
            business_id: businessId,
            image_base64: b64,
            image_mime_type: mime,
          });
          if (out.low_legibility) anyLow = true;
          for (const it of out.items) {
            merged.push({
              key: newKey(),
              name: it.name,
              category: it.category ?? "",
              price_text: it.price_text ?? "",
            });
          }
        }
        if (merged.length === 0) {
          setBanner({ message: t("menuScan.emptyExtract"), tone: "info" });
          return;
        }
        const sessionDedupe = new Set<string>();
        const uniqueMerged: EditableRow[] = [];
        for (const row of merged) {
          const k = libraryDedupeKey(row.name, row.price_text);
          if (sessionDedupe.has(k)) continue;
          sessionDedupe.add(k);
          uniqueMerged.push(row);
        }
        setRows((prev) => (append ? [...prev, ...uniqueMerged] : uniqueMerged));
        if (anyLow) {
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
    },
    [businessId, t],
  );

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
    let toInsert = valid;
    let skippedLib = 0;
    if (skipDuplicatesOnSave) {
      const next: typeof valid = [];
      for (const r of valid) {
        const k = libraryDedupeKey(r.name, r.price_text);
        if (existingLibraryKeys.has(k)) {
          skippedLib += 1;
          continue;
        }
        next.push(r);
      }
      toInsert = next;
      if (toInsert.length === 0) {
        setBanner({
          message:
            skippedLib > 0 ? t("menuScan.allDuplicatesInLibrary") : t("menuScan.emptyExtract"),
          tone: "info",
        });
        return;
      }
    }
    setSaving(true);
    setBanner(null);
    try {
      const payload = toInsert.map((r, i) => ({
        business_id: businessId,
        name: r.name,
        category: r.category.trim() || null,
        price_text: r.price_text.trim() || null,
        sort_order: i,
        source: "scan" as const,
      }));
      const { error } = await supabase.from("business_menu_items").insert(payload);
      if (error) throw new Error(error.message);
      setExistingLibraryKeys((prev: Set<string>) => {
        const n = new Set(prev);
        for (const r of toInsert) {
          n.add(libraryDedupeKey(r.name, r.price_text));
        }
        return n;
      });
      if (skippedLib > 0) {
        setBanner({
          message: t("menuScan.savedWithSkipped", { count: payload.length, skipped: skippedLib }),
          tone: "success",
        });
      } else {
        setBanner({ message: t("menuScan.saved"), tone: "success" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("menuScan.errScan");
      setBanner({
        message: looksLikeMissingMenuTable(msg) ? t("menuWorkflow.errSchema") : msg,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }, [businessId, rows, t, skipDuplicatesOnSave, existingLibraryKeys]);

  if (bizLoading) {
    return (
      <View style={{ flex: 1, paddingTop: top, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <KeyboardScreen>
    <ScrollView
      style={{ flex: 1, paddingTop: top }}
      contentContainerStyle={{
        paddingHorizontal: horizontal,
        paddingBottom: scrollBottom,
        gap: Spacing.md,
      }}
      {...FORM_SCROLL_KEYBOARD_PROPS}
    >
      <Text style={{ fontSize: 22, fontWeight: "700" }}>{t("menuScan.title")}</Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      <PrimaryButton
        title={scanning ? t("menuScan.scanning") : t("menuScan.takePhoto")}
        onPress={() => void pickAndScan("camera", false)}
        disabled={scanning || !businessId}
      />
      <SecondaryButton
        title={scanning ? t("menuScan.scanning") : t("menuScan.pickImage")}
        onPress={() => void pickAndScan("library", false)}
        disabled={scanning || !businessId}
      />
      <Text style={{ opacity: 0.65, fontSize: 13 }}>{t("menuScan.multiHint")}</Text>
      <SecondaryButton
        title={scanning ? t("menuScan.scanning") : t("menuScan.takeMore")}
        onPress={() => void pickAndScan("camera", true)}
        disabled={scanning || !businessId}
      />
      <SecondaryButton
        title={scanning ? t("menuScan.scanning") : t("menuScan.pickMore")}
        onPress={() => void pickAndScan("library", true)}
        disabled={scanning || !businessId}
      />
      {rows.length > 0 ? (
        <>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: Spacing.md,
              paddingVertical: Spacing.xs,
            }}
          >
            <Text style={{ flex: 1, fontWeight: "600", fontSize: 14 }}>{t("menuScan.skipDupLabel")}</Text>
            <Switch value={skipDuplicatesOnSave} onValueChange={setSkipDuplicatesOnSave} />
          </View>
          <SecondaryButton title={t("menuScan.addRow")} onPress={addRow} />
          {rows.map((item) => (
              <View
                key={item.key}
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
            ))}
          <PrimaryButton
            title={saving ? t("menuScan.saving") : t("menuScan.save")}
            onPress={() => void saveMenu()}
            disabled={saving}
          />
          <SecondaryButton
            title={t("menuManager.title")}
            onPress={() => router.push("/create/menu-manager" as Href)}
          />
          <SecondaryButton
            title={t("menuScan.buildOffer")}
            onPress={() => router.push("/create/menu-offer" as Href)}
          />
          <Text style={{ opacity: 0.68, fontSize: 13, marginTop: 4 }}>{t("menuScan.strongDealHint")}</Text>
        </>
      ) : (
        <Text style={{ opacity: 0.7 }}>{t("menuScan.emptyExtract")}</Text>
      )}
    </ScrollView>
    </KeyboardScreen>
  );
}
