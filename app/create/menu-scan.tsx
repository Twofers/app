import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { BrandedSwitch } from "@/components/ui/branded-switch";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useBusiness } from "@/hooks/use-business";
import { aiExtractMenu } from "@/lib/functions";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";
import {
  getMenuScanEmptyStateKey,
  isMenuScanBusy,
  shouldShowAppendMenuPhotoActions,
  type MenuScanState,
} from "@/lib/menu-scan-state";
import { looksLikeMissingMenuTable } from "@/lib/menu-workflow-errors";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { supabase } from "@/lib/supabase";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getSwitchAccessibilityState } from "@/lib/switch-accessibility";

type EditableRow = {
  key: string;
  name: string;
  category: string;
  price_text: string;
  size_options: string[];
};

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Server caps the menu-scan base64 payload at 1.2M chars (see ai-extract-menu).
 * Pre-checking here lets us skip oversized photos with a clear per-batch warning
 * instead of failing the entire scan loop on the first too-big shot. Margin gives
 * room for any small base64-vs-payload header overhead.
 */
const MAX_MENU_SCAN_BASE64_LENGTH = 1_100_000;

/** Normalize for dedupe against saved library lines */
function libraryDedupeKey(name: string, priceText: string): string {
  return `${name.trim().toLowerCase()}|${priceText.trim().toLowerCase()}`;
}

function parseSizesInput(text: string): string[] {
  return text
    .split(/[,/\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export default function MenuScanScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { businessId, loading: bizLoading } = useBusiness();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  const [rows, setRows] = useState<EditableRow[]>([]);
  const [scanState, setScanState] = useState<MenuScanState>("idle");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" | "info" } | null>(
    null,
  );
  const [existingLibraryKeys, setExistingLibraryKeys] = useState<Set<string>>(() => new Set());
  const [skipDuplicatesOnSave, setSkipDuplicatesOnSave] = useState(true);
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number } | null>(null);
  const scanRequestIdRef = useRef(0);
  const scanning = isMenuScanBusy(scanState);
  const emptyStateKey = getMenuScanEmptyStateKey(scanState);
  const showAppendPhotoActions = shouldShowAppendMenuPhotoActions(rows.length);

  function cancelScan() {
    // Bumping the id makes any in-flight result a no-op when it returns; clearing the
    // flags here re-enables the buttons immediately so the owner is not stuck waiting.
    scanRequestIdRef.current += 1;
    setScanState(rows.length > 0 ? "success" : "idle");
    setScanProgress(null);
    setBanner(null);
  }

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
        setScanState("error");
        return;
      }
      setScanState("pickingPhoto");
      // Camera: live capture (one photo). Library: pick up to 10 photos.
      if (source === "camera") {
        const camPerm = await ImagePicker.requestCameraPermissionsAsync();
        if (!camPerm.granted) {
          setBanner({ message: t("menuScan.cameraPermissionDenied"), tone: "error" });
          setScanState("error");
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setBanner({ message: t("menuScan.photoPermissionDenied"), tone: "error" });
          setScanState("error");
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
        setScanState(rows.length > 0 ? "success" : "idle");
        return;
      }
      const requestId = ++scanRequestIdRef.current;
      setScanState("analyzing");
      setBanner(null);
      setScanProgress({ current: 0, total: result.assets.length });
      try {
        const merged: EditableRow[] = [];
        let anyLow = false;
        let anySyntheticFallback = false;
        let processed = 0;
        let oversizedCount = 0;
        for (const asset of result.assets) {
          // Cancel mid-loop: stop walking the asset list and discard in-flight work.
          if (requestId !== scanRequestIdRef.current) return;
          processed += 1;
          setScanProgress({ current: processed, total: result.assets.length });
          const b64 = asset.base64;
          if (!b64) continue;
          // Pre-check the payload size — high-res phone photos can exceed the server
          // cap on a single shot, which would fail the whole loop. Skip oversize ones
          // and surface a count at the end so the rest of the batch still saves.
          if (b64.length > MAX_MENU_SCAN_BASE64_LENGTH) {
            oversizedCount += 1;
            continue;
          }
          const mime: string =
            asset.mimeType != null && asset.mimeType.startsWith("image/") ? asset.mimeType : "image/jpeg";
          const out = await aiExtractMenu({
            business_id: businessId,
            image_base64: b64,
            image_mime_type: mime,
          });
          if (requestId !== scanRequestIdRef.current) return;
          if (out.low_legibility) anyLow = true;
          if (out.extraction_source === "synthetic_fallback") anySyntheticFallback = true;
          for (const it of out.items) {
            merged.push({
              key: newKey(),
              name: it.name,
              category: it.category ?? "",
              price_text: it.price_text ?? "",
              size_options: Array.isArray(it.size_options) ? it.size_options : [],
            });
          }
        }
        if (requestId !== scanRequestIdRef.current) return;
        if (merged.length === 0) {
          // All photos either gave nothing OR were too large — pick the more informative banner.
          if (oversizedCount > 0 && oversizedCount === result.assets.length) {
            setBanner({ message: t("menuScan.allOversized"), tone: "error" });
            setScanState("error");
          } else {
            setBanner(null);
            setScanState("emptyResult");
          }
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
        setScanState("success");
        // Combine oversize and low-legibility into a single info banner so the owner
        // sees both signals — fewer message-clobbers when both happen on the same batch.
        const notes: string[] = [];
        if (oversizedCount > 0) {
          notes.push(t("menuScan.someOversizedSkipped", { count: oversizedCount }));
        }
        if (anyLow) {
          notes.push(t("menuScan.lowLegibility"));
        }
        if (anySyntheticFallback) {
          notes.push(t("menuScan.syntheticFallbackNotice"));
        }
        if (notes.length > 0) {
          setBanner({ message: notes.join(" "), tone: "info" });
        }
      } catch (e) {
        // Stale-result guard: don't surface an error from a request the user already canceled.
        if (scanRequestIdRef.current !== requestId) return;
        const raw = e instanceof Error ? e.message : "";
        setBanner({
          message: raw ? translateKnownApiMessage(raw, t) : t("menuScan.errScan"),
          tone: "error",
        });
        setScanState("error");
      } finally {
        // Don't fight with cancelScan — it already cleared state for the canceled request.
        if (scanRequestIdRef.current === requestId) {
          setScanProgress(null);
        }
      }
    },
    [businessId, rows.length, t],
  );

  const addRow = useCallback(() => {
    setScanState("success");
    setRows((r) => [...r, { key: newKey(), name: "", category: "", price_text: "", size_options: [] }]);
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
        size_options: r.size_options.length > 0 ? r.size_options : null,
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
      const msg = e instanceof Error ? e.message : "";
      // Schema/migration errors get a dedicated message so the owner sees something
      // actionable. Everything else flows through translateKnownApiMessage so RLS,
      // JWT, network, and constraint errors render as friendly translated text rather
      // than raw Postgres output.
      setBanner({
        message: looksLikeMissingMenuTable(msg)
          ? t("menuWorkflow.errSchema")
          : msg
            ? translateKnownApiMessage(msg, t)
            : t("menuScan.errScan"),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }, [businessId, rows, t, skipDuplicatesOnSave, existingLibraryKeys]);

  if (bizLoading) {
    return (
      <View style={{ flex: 1, paddingTop: top, justifyContent: "center", alignItems: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <KeyboardScreen style={{ backgroundColor: theme.background }}>
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{
        paddingHorizontal: horizontal,
        paddingTop: Spacing.xxxl,
        paddingBottom: scrollBottom,
        gap: Spacing.md,
      }}
      {...FORM_SCROLL_KEYBOARD_PROPS}
    >
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
      <Text style={{ opacity: 0.65, fontSize: 13, color: theme.text }}>{t("menuScan.multiHint")}</Text>
      {showAppendPhotoActions ? (
        <>
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
        </>
      ) : null}
      {scanning ? (
        <View style={{ marginTop: 4, gap: Spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <ActivityIndicator color={theme.primary} />
            <Text style={{ opacity: 0.75, flex: 1, color: theme.text }}>
              {t("menuScan.scanning")}
              {scanProgress ? ` (${scanProgress.current}/${scanProgress.total})` : ""}
            </Text>
          </View>
          <SecondaryButton title={t("commonUi.cancel")} onPress={cancelScan} />
        </View>
      ) : null}
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
            <Text style={{ flex: 1, fontWeight: "600", fontSize: 14, color: theme.text }}>{t("menuScan.skipDupLabel")}</Text>
            <BrandedSwitch
              value={skipDuplicatesOnSave}
              onValueChange={setSkipDuplicatesOnSave}
              accessibilityRole="switch"
              accessibilityLabel={t("menuScan.skipDupLabel")}
              accessibilityHint={t("menuScan.skipDupA11yHint")}
              accessibilityState={getSwitchAccessibilityState(skipDuplicatesOnSave)}
            />
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
                  borderColor: theme.border,
                  backgroundColor: theme.surface,
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
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    color: theme.text,
                    backgroundColor: theme.surface,
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
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    color: theme.text,
                    backgroundColor: theme.surface,
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
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    color: theme.text,
                    backgroundColor: theme.surface,
                  }}
                />
                <TextInput
                  value={item.size_options.join(", ")}
                  onChangeText={(text) =>
                    setRows((prev) =>
                      prev.map((x) => (x.key === item.key ? { ...x, size_options: parseSizesInput(text) } : x)),
                    )
                  }
                  placeholder={t("menuScan.sizePlaceholder", { defaultValue: "Sizes as shown (optional)" })}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    padding: 10,
                    color: theme.text,
                    backgroundColor: theme.surface,
                  }}
                />
                <Pressable onPress={() => removeRow(item.key)}>
                  <Text style={{ color: theme.danger, fontWeight: "600" }}>{t("menuScan.removeLine")}</Text>
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
          <Text style={{ opacity: 0.68, fontSize: 13, marginTop: 4, color: theme.text }}>{t("menuScan.strongDealHint")}</Text>
        </>
      ) : (
        emptyStateKey ? (
          <Text style={{ opacity: 0.7, color: theme.text }}>{t(emptyStateKey)}</Text>
        ) : null
      )}
    </ScrollView>
    </KeyboardScreen>
  );
}
