import { useState } from "react";
import { Alert, Modal, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Colors, Radii } from "../constants/theme";
import { Spacing } from "../lib/screen-layout";
import { PrimaryButton } from "./ui/primary-button";
import { SecondaryButton } from "./ui/secondary-button";
import { HapticScalePressable as Pressable } from "./ui/haptic-scale-pressable";
import { supabase } from "../lib/supabase";

export type BusinessLocation = {
  id: string;
  business_id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  hours_text: string | null;
  is_primary: boolean;
};

type Props = {
  businessId: string;
  location?: BusinessLocation | null;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function LocationEditor({ businessId, location, visible, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const isEdit = !!location;

  const [name, setName] = useState(location?.name ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [phone, setPhone] = useState(location?.phone ?? "");
  const [hoursText, setHoursText] = useState(location?.hours_text ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || !address.trim()) {
      setError(t("locations.errRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isEdit && location) {
        const { error: err } = await supabase
          .from("business_locations")
          .update({
            name: name.trim(),
            address: address.trim(),
            phone: phone.trim() || null,
            hours_text: hoursText.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", location.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("business_locations").insert({
          business_id: businessId,
          name: name.trim(),
          address: address.trim(),
          phone: phone.trim() || null,
          hours_text: hoursText.trim() || null,
          is_primary: false,
        });
        if (err) throw err;
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? t("locations.errSave"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, paddingTop: 20, paddingHorizontal: 16, backgroundColor: "#fff" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 22, fontWeight: "700" }}>
            {isEdit ? t("locations.editTitle") : t("locations.addTitle")}
          </Text>
          <Pressable onPress={onClose}>
            <Text style={{ fontSize: 16, color: Colors.light.primary, fontWeight: "600" }}>
              {t("locations.close")}
            </Text>
          </Pressable>
        </View>

        {error ? (
          <Text style={{ color: "#e33", marginTop: Spacing.sm, fontSize: 14 }}>{error}</Text>
        ) : null}

        <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
          <View>
            <Text style={{ fontWeight: "700", fontSize: 14 }}>{t("locations.fieldName")}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t("locations.placeholderName")}
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.lg,
                padding: Spacing.md,
                marginTop: 6,
                fontSize: 16,
              }}
            />
          </View>
          <View>
            <Text style={{ fontWeight: "700", fontSize: 14 }}>{t("locations.fieldAddress")}</Text>
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder={t("locations.placeholderAddress")}
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.lg,
                padding: Spacing.md,
                marginTop: 6,
                fontSize: 16,
              }}
            />
          </View>
          <View>
            <Text style={{ fontWeight: "700", fontSize: 14 }}>{t("locations.fieldPhone")}</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder={t("locations.placeholderPhone")}
              keyboardType="phone-pad"
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.lg,
                padding: Spacing.md,
                marginTop: 6,
                fontSize: 16,
              }}
            />
          </View>
          <View>
            <Text style={{ fontWeight: "700", fontSize: 14 }}>{t("locations.fieldHours")}</Text>
            <TextInput
              value={hoursText}
              onChangeText={setHoursText}
              placeholder={t("locations.placeholderHours")}
              multiline
              style={{
                borderWidth: 1,
                borderColor: Colors.light.border,
                borderRadius: Radii.lg,
                padding: Spacing.md,
                marginTop: 6,
                fontSize: 16,
                minHeight: 72,
                textAlignVertical: "top",
              }}
            />
          </View>
        </View>

        <View style={{ marginTop: Spacing.xl }}>
          <PrimaryButton
            title={saving ? t("locations.saving") : t("locations.save")}
            onPress={save}
            disabled={saving}
          />
        </View>
      </View>
    </Modal>
  );
}
