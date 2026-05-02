import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useBusiness } from "@/hooks/use-business";
import { looksLikeMissingMenuTable } from "@/lib/menu-workflow-errors";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { supabase } from "@/lib/supabase";
import { Colors, Radii } from "@/constants/theme";

type Row = {
  id: string;
  name: string;
  category: string | null;
  price_text: string | null;
  description: string | null;
  archived_at: string | null;
};

export default function MenuManagerScreen() {
  const { t } = useTranslation();
  const genericMenuError = t("menuManager.errSave");
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { businessId, loading: bizLoading } = useBusiness();

  const [rows, setRows] = useState<Row[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: "error" | "success" } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", category: "", price_text: "", description: "" });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoadErr(null);
    const { data, error } = await supabase
      .from("business_menu_items")
      .select("id,name,category,price_text,description,archived_at")
      .eq("business_id", businessId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) {
      setLoadErr(looksLikeMissingMenuTable(error.message) ? t("menuWorkflow.errSchema") : genericMenuError);
      return;
    }
    setRows((data ?? []) as Row[]);
  }, [businessId, genericMenuError, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = showArchived ? rows : rows.filter((r) => !r.archived_at);

  const startEdit = (r: Row) => {
    setAdding(false);
    setEditingId(r.id);
    setDraft({
      name: r.name,
      category: r.category ?? "",
      price_text: r.price_text ?? "",
      description: r.description ?? "",
    });
  };

  const saveEdit = async () => {
    if (!editingId || !draft.name.trim()) return;
    setBanner(null);
    const { error } = await supabase
      .from("business_menu_items")
      .update({
        name: draft.name.trim(),
        category: draft.category.trim() || null,
        price_text: draft.price_text.trim() || null,
        description: draft.description.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", editingId);
    if (error) {
      setBanner({ message: genericMenuError, tone: "error" });
      return;
    }
    setEditingId(null);
    setBanner({ message: t("menuManager.saved"), tone: "success" });
    void load();
  };

  const toggleArchive = async (r: Row) => {
    setBanner(null);
    const next = r.archived_at ? null : new Date().toISOString();
    const { error } = await supabase
      .from("business_menu_items")
      .update({ archived_at: next, updated_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) {
      setBanner({ message: genericMenuError, tone: "error" });
      return;
    }
    void load();
  };

  const addManual = async () => {
    if (!businessId || !draft.name.trim()) return;
    setBanner(null);
    const { error } = await supabase.from("business_menu_items").insert({
      business_id: businessId,
      name: draft.name.trim(),
      category: draft.category.trim() || null,
      price_text: draft.price_text.trim() || null,
      description: draft.description.trim() || null,
      sort_order: rows.length,
      source: "manual",
    });
    if (error) {
      setBanner({ message: genericMenuError, tone: "error" });
      return;
    }
    setAdding(false);
    setDraft({ name: "", category: "", price_text: "", description: "" });
    setBanner({ message: t("menuManager.saved"), tone: "success" });
    void load();
  };

  if (bizLoading) {
    return (
      <View style={{ flex: 1, paddingTop: top, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!businessId) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal }}>
        <Text>{t("menuScan.needBusiness")}</Text>
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
        <Text style={{ fontSize: 22, fontWeight: "700" }}>{t("menuManager.title")}</Text>
        <Text style={{ opacity: 0.7 }}>{t("menuManager.subtitle")}</Text>
        {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}
        {loadErr ? <Banner message={loadErr} tone="error" /> : null}

        <SecondaryButton
          title={showArchived ? t("menuManager.hideArchived") : t("menuManager.showArchived")}
          onPress={() => setShowArchived((s) => !s)}
        />

        {!adding ? (
          <PrimaryButton title={t("menuManager.addManual")} onPress={() => { setEditingId(null); setDraft({ name: "", category: "", price_text: "", description: "" }); setAdding(true); }} />
        ) : (
          <View style={{ gap: Spacing.sm }}>
            <TextInput
              value={draft.name}
              onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
              placeholder={t("menuManager.namePlaceholder")}
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.md,
                padding: Spacing.md,
              }}
            />
            <TextInput
              value={draft.category}
              onChangeText={(category) => setDraft((d) => ({ ...d, category }))}
              placeholder={t("menuManager.categoryPlaceholder")}
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.md,
                padding: Spacing.md,
              }}
            />
            <TextInput
              value={draft.price_text}
              onChangeText={(price_text) => setDraft((d) => ({ ...d, price_text }))}
              placeholder={t("menuManager.pricePlaceholder")}
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.md,
                padding: Spacing.md,
              }}
            />
            <TextInput
              value={draft.description}
              onChangeText={(description) => setDraft((d) => ({ ...d, description }))}
              placeholder={t("menuManager.descPlaceholder")}
              multiline
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.md,
                padding: Spacing.md,
                minHeight: 72,
              }}
            />
            <PrimaryButton title={t("menuManager.save")} onPress={() => void addManual()} />
            <SecondaryButton
              title={t("menuOffer.back")}
              onPress={() => {
                setAdding(false);
                setDraft({ name: "", category: "", price_text: "", description: "" });
              }}
            />
          </View>
        )}

        {visible.length === 0 && !loadErr ? (
          <Text style={{ opacity: 0.7 }}>{t("menuManager.empty")}</Text>
        ) : null}

        {visible.map((r) => (
            <View
              key={r.id}
              style={{
                marginBottom: Spacing.md,
                padding: Spacing.md,
                borderRadius: Radii.md,
                borderWidth: 1,
                borderColor: Colors.light.border,
                backgroundColor: Colors.light.surface,
                gap: Spacing.sm,
                opacity: r.archived_at ? 0.55 : 1,
              }}
            >
              {editingId === r.id ? (
                <>
                  <TextInput
                    value={draft.name}
                    onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
                    placeholder={t("menuManager.namePlaceholder")}
                    style={{
                      borderWidth: 1,
                      borderColor: Colors.light.border,
                      borderRadius: Radii.md,
                      padding: Spacing.md,
                    }}
                  />
                  <TextInput
                    value={draft.category}
                    onChangeText={(category) => setDraft((d) => ({ ...d, category }))}
                    placeholder={t("menuManager.categoryPlaceholder")}
                    style={{
                      borderWidth: 1,
                      borderColor: Colors.light.border,
                      borderRadius: Radii.md,
                      padding: Spacing.md,
                    }}
                  />
                  <TextInput
                    value={draft.price_text}
                    onChangeText={(price_text) => setDraft((d) => ({ ...d, price_text }))}
                    placeholder={t("menuManager.pricePlaceholder")}
                    style={{
                      borderWidth: 1,
                      borderColor: Colors.light.border,
                      borderRadius: Radii.md,
                      padding: Spacing.md,
                    }}
                  />
                  <TextInput
                    value={draft.description}
                    onChangeText={(description) => setDraft((d) => ({ ...d, description }))}
                    placeholder={t("menuManager.descPlaceholder")}
                    multiline
                    style={{
                      borderWidth: 1,
                      borderColor: Colors.light.border,
                      borderRadius: Radii.md,
                      padding: Spacing.md,
                      minHeight: 64,
                    }}
                  />
                  <PrimaryButton title={t("menuManager.save")} onPress={() => void saveEdit()} />
                  <SecondaryButton title={t("menuOffer.back")} onPress={() => setEditingId(null)} />
                </>
              ) : (
                <>
                  <Text style={{ fontWeight: "700", fontSize: 16 }}>{r.name}</Text>
                  {r.category ? <Text style={{ opacity: 0.75 }}>{r.category}</Text> : null}
                  {r.price_text ? <Text style={{ opacity: 0.75 }}>{r.price_text}</Text> : null}
                  {r.description ? <Text style={{ opacity: 0.8 }}>{r.description}</Text> : null}
                  <View style={{ flexDirection: "row", gap: Spacing.sm, flexWrap: "wrap" }}>
                    <Pressable onPress={() => startEdit(r)}>
                      <Text style={{ color: Colors.light.primaryAccent, fontWeight: "700" }}>{t("menuManager.edit")}</Text>
                    </Pressable>
                    <Pressable onPress={() => void toggleArchive(r)}>
                      <Text style={{ fontWeight: "600" }}>
                        {r.archived_at ? t("menuManager.unarchive") : t("menuManager.archive")}
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          ))}
      </ScrollView>
    </KeyboardScreen>
  );
}
