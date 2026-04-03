import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Colors, Radii } from "../constants/theme";
import { Spacing } from "../lib/screen-layout";
import { HapticScalePressable as Pressable } from "./ui/haptic-scale-pressable";
import { PrimaryButton } from "./ui/primary-button";
import { SecondaryButton } from "./ui/secondary-button";
import { fetchMenuItems, type MenuItem } from "../lib/menu-items";

type Props = {
  businessId: string;
  visible: boolean;
  onClose: () => void;
  onSelect: (items: MenuItem[]) => void;
  maxSelect?: number;
};

export function MenuItemPicker({ businessId, visible, onClose, onSelect, maxSelect = 2 }: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMenuItems(businessId);
      setItems(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (visible) {
      void load();
      setSelected([]);
      setSearch("");
    }
  }, [visible, load]);

  const filtered = search.trim()
    ? items.filter(
        (i) =>
          i.name.toLowerCase().includes(search.toLowerCase()) ||
          (i.category ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : items;

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= maxSelect) return prev;
      return [...prev, id];
    });
  }

  function confirm() {
    const picked = selected.map((id) => items.find((i) => i.id === id)!).filter(Boolean);
    onSelect(picked);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, paddingTop: 20, paddingHorizontal: 16, backgroundColor: "#fff" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 22, fontWeight: "700" }}>{t("menuPicker.title")}</Text>
          <Pressable onPress={onClose}>
            <Text style={{ fontSize: 16, color: Colors.light.primary, fontWeight: "600" }}>
              {t("menuPicker.close")}
            </Text>
          </Pressable>
        </View>

        <Text style={{ marginTop: 4, opacity: 0.6, fontSize: 14 }}>
          {t("menuPicker.hint", { max: maxSelect })}
        </Text>

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t("menuPicker.search")}
          style={{
            borderWidth: 1,
            borderColor: Colors.light.border,
            borderRadius: Radii.lg,
            padding: Spacing.md,
            marginTop: Spacing.md,
            fontSize: 16,
            backgroundColor: Colors.light.surface,
          }}
        />

        {loading ? (
          <View style={{ marginTop: Spacing.xl }}>
            <ActivityIndicator />
          </View>
        ) : filtered.length === 0 ? (
          <View style={{ marginTop: Spacing.xl, alignItems: "center" }}>
            <Text style={{ opacity: 0.6 }}>{t("menuPicker.empty")}</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            style={{ flex: 1, marginTop: Spacing.md }}
            contentContainerStyle={{ paddingBottom: 100 }}
            renderItem={({ item }) => {
              const isSelected = selected.includes(item.id);
              return (
                <Pressable
                  onPress={() => toggle(item.id)}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: Spacing.md,
                    marginBottom: Spacing.sm,
                    borderRadius: Radii.lg,
                    borderWidth: isSelected ? 2 : 1,
                    borderColor: isSelected ? Colors.light.primary : Colors.light.border,
                    backgroundColor: isSelected ? "#FFF5E6" : Colors.light.surface,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 15 }}>{item.name}</Text>
                    {item.category ? (
                      <Text style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>{item.category}</Text>
                    ) : null}
                  </View>
                  {item.price != null ? (
                    <Text style={{ fontWeight: "700", fontSize: 15, color: Colors.light.primary }}>
                      ${Number(item.price).toFixed(2)}
                    </Text>
                  ) : null}
                </Pressable>
              );
            }}
          />
        )}

        {selected.length > 0 ? (
          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              padding: 16,
              paddingBottom: 34,
              backgroundColor: "#fff",
              borderTopWidth: 1,
              borderTopColor: Colors.light.border,
              flexDirection: "row",
              gap: Spacing.sm,
            }}
          >
            <View style={{ flex: 1 }}>
              <SecondaryButton title={t("menuPicker.clear")} onPress={() => setSelected([])} />
            </View>
            <View style={{ flex: 2 }}>
              <PrimaryButton
                title={t("menuPicker.select", { count: selected.length })}
                onPress={confirm}
              />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
