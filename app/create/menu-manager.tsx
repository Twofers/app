import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SectionList,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { Colors, Radii } from "../../constants/theme";
import { useBusiness } from "../../hooks/use-business";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import {
  fetchMenuItems,
  updateMenuItem,
  deleteMenuItem,
  type MenuItem,
} from "../../lib/menu-items";
import { supabase } from "../../lib/supabase";

type Section = {
  title: string;
  data: MenuItem[];
};

export default function MenuManagerScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { isLoggedIn, businessId, loading } = useBusiness();

  const [items, setItems] = useState<MenuItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [banner, setBanner] = useState<{
    message: string;
    tone: "error" | "success" | "info";
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCategory, setNewCategory] = useState("");

  const loadItems = useCallback(async () => {
    if (!businessId) return;
    setLoadingItems(true);
    try {
      const data = await fetchMenuItems(businessId);
      setItems(data);
    } catch (err: any) {
      setBanner({ message: err?.message ?? t("menuManager.errLoad"), tone: "error" });
    } finally {
      setLoadingItems(false);
    }
  }, [businessId, t]);

  useFocusEffect(
    useCallback(() => {
      void loadItems();
    }, [loadItems]),
  );

  const sections: Section[] = (() => {
    const groups: Record<string, MenuItem[]> = {};
    for (const item of items) {
      const cat = item.category || t("menuManager.uncategorized");
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }
    return Object.entries(groups).map(([title, data]) => ({ title, data }));
  })();

  function startEdit(item: MenuItem) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditPrice(item.price != null ? String(item.price) : "");
    setEditCategory(item.category ?? "");
  }

  async function saveEdit() {
    if (!editingId || !editName.trim()) return;
    try {
      const priceNum = editPrice.trim() ? Number(editPrice) : null;
      await updateMenuItem(editingId, {
        name: editName.trim(),
        price: priceNum,
        category: editCategory.trim() || null,
      });
      setEditingId(null);
      await loadItems();
    } catch (err: any) {
      setBanner({ message: err?.message ?? t("menuManager.errUpdate"), tone: "error" });
    }
  }

  async function handleDelete(id: string, name: string) {
    Alert.alert(
      t("menuManager.deleteTitle"),
      t("menuManager.deleteMessage", { name }),
      [
        { text: t("menuManager.cancel"), style: "cancel" },
        {
          text: t("menuManager.delete"),
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMenuItem(id);
              await loadItems();
            } catch (err: any) {
              setBanner({ message: err?.message ?? t("menuManager.errDelete"), tone: "error" });
            }
          },
        },
      ],
    );
  }

  async function addNewItem() {
    if (!businessId || !newName.trim()) return;
    try {
      const priceNum = newPrice.trim() ? Number(newPrice) : null;
      const { error } = await supabase.from("menu_items").insert({
        business_id: businessId,
        name: newName.trim(),
        price: priceNum,
        category: newCategory.trim() || null,
        is_available: true,
        sort_order: items.length,
      });
      if (error) throw error;
      setAddingNew(false);
      setNewName("");
      setNewPrice("");
      setNewCategory("");
      await loadItems();
    } catch (err: any) {
      setBanner({ message: err?.message ?? t("menuManager.errAdd"), tone: "error" });
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
        {t("menuManager.title")}
      </Text>
      <Text style={{ marginTop: 6, opacity: 0.7, lineHeight: 20 }}>
        {t("menuManager.subtitle")}
      </Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {loadingItems ? (
        <View style={{ marginTop: Spacing.xl }}>
          <ActivityIndicator />
        </View>
      ) : items.length === 0 && !addingNew ? (
        <View style={{ marginTop: Spacing.xl, gap: Spacing.md, alignItems: "center" }}>
          <Text style={{ fontSize: 16, opacity: 0.6, textAlign: "center" }}>
            {t("menuManager.empty")}
          </Text>
          <PrimaryButton
            title={t("menuManager.scanMenu")}
            onPress={() => router.push("/create/menu-scan" as Href)}
          />
          <SecondaryButton
            title={t("menuManager.addManually")}
            onPress={() => setAddingNew(true)}
          />
        </View>
      ) : (
        <>
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            style={{ flex: 1, marginTop: Spacing.md }}
            contentContainerStyle={{ paddingBottom: scrollBottom }}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "800",
                  textTransform: "uppercase",
                  opacity: 0.5,
                  marginTop: Spacing.lg,
                  marginBottom: Spacing.xs,
                }}
              >
                {section.title}
              </Text>
            )}
            renderItem={({ item }) => {
              if (editingId === item.id) {
                return (
                  <View
                    style={{
                      borderRadius: Radii.lg,
                      backgroundColor: Colors.light.surfaceMuted,
                      padding: Spacing.md,
                      marginBottom: Spacing.sm,
                      gap: Spacing.sm,
                    }}
                  >
                    <TextInput
                      value={editName}
                      onChangeText={setEditName}
                      style={{ fontWeight: "700", fontSize: 16, borderBottomWidth: 1, borderBottomColor: Colors.light.border, paddingBottom: 4 }}
                      placeholder={t("menuScan.itemName")}
                    />
                    <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                      <TextInput
                        value={editPrice}
                        onChangeText={setEditPrice}
                        keyboardType="decimal-pad"
                        style={{ flex: 1, borderBottomWidth: 1, borderBottomColor: Colors.light.border, paddingBottom: 4 }}
                        placeholder={t("menuScan.itemPrice")}
                      />
                      <TextInput
                        value={editCategory}
                        onChangeText={setEditCategory}
                        style={{ flex: 1, borderBottomWidth: 1, borderBottomColor: Colors.light.border, paddingBottom: 4 }}
                        placeholder={t("menuScan.itemCategory")}
                      />
                    </View>
                    <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <PrimaryButton title={t("menuManager.save")} onPress={saveEdit} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <SecondaryButton title={t("menuManager.cancel")} onPress={() => setEditingId(null)} />
                      </View>
                    </View>
                  </View>
                );
              }

              return (
                <Pressable
                  onPress={() => startEdit(item)}
                  style={{
                    borderRadius: Radii.lg,
                    backgroundColor: Colors.light.surface,
                    borderWidth: 1,
                    borderColor: Colors.light.border,
                    padding: Spacing.md,
                    marginBottom: Spacing.sm,
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 15 }}>{item.name}</Text>
                    {item.description ? (
                      <Text style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>
                        {item.description}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    {item.price != null ? (
                      <Text style={{ fontWeight: "700", fontSize: 15, color: Colors.light.primary }}>
                        ${Number(item.price).toFixed(2)}
                      </Text>
                    ) : null}
                    <Pressable onPress={() => handleDelete(item.id, item.name)}>
                      <Text style={{ color: "#e33", fontSize: 12, fontWeight: "600" }}>
                        {t("menuManager.delete")}
                      </Text>
                    </Pressable>
                  </View>
                </Pressable>
              );
            }}
            ListFooterComponent={
              <View style={{ gap: Spacing.sm, marginTop: Spacing.md }}>
                {addingNew ? (
                  <View
                    style={{
                      borderRadius: Radii.lg,
                      backgroundColor: Colors.light.surfaceMuted,
                      padding: Spacing.md,
                      gap: Spacing.sm,
                    }}
                  >
                    <TextInput
                      value={newName}
                      onChangeText={setNewName}
                      style={{ fontWeight: "700", fontSize: 16, borderBottomWidth: 1, borderBottomColor: Colors.light.border, paddingBottom: 4 }}
                      placeholder={t("menuScan.itemName")}
                      autoFocus
                    />
                    <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                      <TextInput
                        value={newPrice}
                        onChangeText={setNewPrice}
                        keyboardType="decimal-pad"
                        style={{ flex: 1, borderBottomWidth: 1, borderBottomColor: Colors.light.border, paddingBottom: 4 }}
                        placeholder={t("menuScan.itemPrice")}
                      />
                      <TextInput
                        value={newCategory}
                        onChangeText={setNewCategory}
                        style={{ flex: 1, borderBottomWidth: 1, borderBottomColor: Colors.light.border, paddingBottom: 4 }}
                        placeholder={t("menuScan.itemCategory")}
                      />
                    </View>
                    <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <PrimaryButton title={t("menuManager.save")} onPress={addNewItem} disabled={!newName.trim()} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <SecondaryButton title={t("menuManager.cancel")} onPress={() => setAddingNew(false)} />
                      </View>
                    </View>
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <SecondaryButton
                      title={t("menuManager.addManually")}
                      onPress={() => setAddingNew(true)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <SecondaryButton
                      title={t("menuManager.scanMore")}
                      onPress={() => router.push("/create/menu-scan" as Href)}
                    />
                  </View>
                </View>
              </View>
            }
          />
        </>
      )}
    </View>
  );
}
