import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { PrimaryButton } from "@/components/ui/primary-button";
import { Banner } from "@/components/ui/banner";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { supabase } from "@/lib/supabase";
import {
  BUSINESS_CATEGORY_IDS,
  BUSINESS_HOURS_PRESET_IDS,
  type BusinessCategoryId,
  type BusinessHoursPresetId,
  HOURS_PRESET_DB_VALUE,
} from "@/lib/business-signup";

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: Spacing.sm,
        paddingHorizontal: Spacing.md,
        borderRadius: 20,
        backgroundColor: active ? "#111" : "#ececec",
        marginRight: Spacing.sm,
        marginBottom: Spacing.sm,
      }}
    >
      <Text style={{ fontWeight: "700", color: active ? "#fff" : "#333", fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export default function BusinessSetupScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const [contactName, setContactName] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [categoryId, setCategoryId] = useState<BusinessCategoryId | null>(null);
  const [categoryOther, setCategoryOther] = useState("");
  const [hoursPreset, setHoursPreset] = useState<BusinessHoursPresetId | null>(null);
  const [hoursCustom, setHoursCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: "error" } | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session?.user?.id) router.replace("/(tabs)/account");
    });
  }, [router]);

  function resolveCategory(): string | null {
    if (!categoryId) return null;
    if (categoryId === "other") return categoryOther.trim() || null;
    return t(`businessSetup.cat.${categoryId}`);
  }

  function resolveHoursText(): string | null {
    if (!hoursPreset) return null;
    if (hoursPreset === "custom_prompt") return hoursCustom.trim() || null;
    return HOURS_PRESET_DB_VALUE[hoursPreset];
  }

  async function onSubmit() {
    setBanner(null);
    const email = businessEmail.trim();
    const name = businessName.trim();
    const cat = resolveCategory();
    const hours = resolveHoursText();
    if (
      !contactName.trim() ||
      !email ||
      !name ||
      !phone.trim() ||
      !address.trim() ||
      !cat ||
      !hours
    ) {
      setBanner({ message: t("businessSetup.errRequired"), tone: "error" });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setBanner({ message: t("businessSetup.errEmail"), tone: "error" });
      return;
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) {
      setBanner({ message: t("createHub.errLoginBusiness"), tone: "error" });
      return;
    }
    const addr = address.trim();
    setBusy(true);
    try {
      const { error } = await supabase.from("businesses").insert({
        owner_id: uid,
        name,
        contact_name: contactName.trim(),
        business_email: email,
        phone: phone.trim(),
        address: addr,
        location: addr,
        category: cat,
        hours_text: hours,
      });
      if (error) throw error;
      router.replace("/(tabs)/create");
    } catch (e: any) {
      setBanner({ message: e?.message ?? t("businessSetup.errSave"), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("businessSetup.title")}</Text>
      <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, opacity: 0.72, fontSize: 15, lineHeight: 22 }}>
        {t("businessSetup.subtitle")}
      </Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.md }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Field label={t("businessSetup.contactName")} value={contactName} onChangeText={setContactName} />
        <Field
          label={t("businessSetup.businessEmail")}
          value={businessEmail}
          onChangeText={setBusinessEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Field label={t("businessSetup.businessName")} value={businessName} onChangeText={setBusinessName} />
        <Field label={t("businessSetup.phone")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field label={t("businessSetup.address")} value={address} onChangeText={setAddress} />

        <View>
          <Text style={{ fontWeight: "700", marginBottom: Spacing.sm }}>{t("businessSetup.categoryLabel")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {BUSINESS_CATEGORY_IDS.map((id) => (
              <Chip
                key={id}
                label={t(`businessSetup.cat.${id}`)}
                active={categoryId === id}
                onPress={() => setCategoryId(id)}
              />
            ))}
          </View>
          {categoryId === "other" ? (
            <TextInput
              value={categoryOther}
              onChangeText={setCategoryOther}
              placeholder={t("businessSetup.categoryOtherPh")}
              style={{
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 12,
                padding: Spacing.md,
                marginTop: Spacing.sm,
                fontSize: 16,
              }}
            />
          ) : null}
        </View>

        <View>
          <Text style={{ fontWeight: "700", marginBottom: Spacing.sm }}>{t("businessSetup.hoursLabel")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {BUSINESS_HOURS_PRESET_IDS.map((id) => (
              <Chip
                key={id}
                label={t(`businessSetup.hoursPreset.${id}`)}
                active={hoursPreset === id}
                onPress={() => setHoursPreset(id)}
              />
            ))}
          </View>
          {hoursPreset === "custom_prompt" ? (
            <TextInput
              value={hoursCustom}
              onChangeText={setHoursCustom}
              placeholder={t("businessSetup.hoursCustomPh")}
              multiline
              style={{
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 12,
                padding: Spacing.md,
                marginTop: Spacing.sm,
                minHeight: 72,
                textAlignVertical: "top",
                fontSize: 16,
              }}
            />
          ) : null}
        </View>

        <View style={{ gap: Spacing.sm }}>
          <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.68 }}>{t("legal.businessSetupHint")}</Text>
          <LegalExternalLinks />
        </View>

        <PrimaryButton
          title={busy ? t("businessSetup.creating") : t("businessSetup.continue")}
          onPress={() => void onSubmit()}
          disabled={busy}
        />
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "words";
}) {
  return (
    <View>
      <Text style={{ fontWeight: "700", marginBottom: 6 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "words"}
        style={{
          borderWidth: 1,
          borderColor: "#ddd",
          borderRadius: 12,
          paddingVertical: Spacing.sm,
          paddingHorizontal: Spacing.md,
          fontSize: 16,
        }}
      />
    </View>
  );
}
