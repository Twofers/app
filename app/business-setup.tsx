import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/hooks/use-business";
import { Colors, Radii } from "@/constants/theme";

type Tone = "error" | "success" | "info";

const CATEGORIES = ["Cafe", "Bakery", "Coffee Shop", "Restaurant", "Other"];

export default function BusinessSetupScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { sessionEmail } = useBusiness();

  const [businessName, setBusinessName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState("");
  const [hours, setHours] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: Tone } | null>(null);

  const trimmed = useMemo(
    () => ({
      businessName: businessName.trim(),
      address: address.trim(),
      phone: phone.trim(),
      category: category.trim(),
      hours: hours.trim(),
      shortDescription: shortDescription.trim(),
    }),
    [businessName, address, phone, category, hours, shortDescription],
  );

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      const bypass = String(params.skipSetup ?? "") === "1" || String(params.e2e ?? "") === "1";
      if (!bypass && !data.session?.user?.id) router.replace("/(tabs)/account");
    });
  }, [router, params.skipSetup, params.e2e]);


  async function onSubmit() {
    setBanner(null);
    if (
      !trimmed.businessName ||
      !trimmed.address ||
      !trimmed.phone ||
      !trimmed.category ||
      !trimmed.shortDescription
    ) {
      setBanner({ message: "All fields except hours are required.", tone: "error" });
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

    setBusy(true);
    try {
      const addr = trimmed.address;
      const { data: business, error } = await supabase
        .from("businesses")
        .upsert(
          {
            owner_id: uid,
            name: trimmed.businessName,
            phone: trimmed.phone,
            address: addr,
            location: addr,
            category: trimmed.category,
            hours_text: trimmed.hours || null,
            short_description: trimmed.shortDescription,
          },
          { onConflict: "owner_id" },
        )
        .select("id")
        .single();
      if (error) throw error;

      const { error: profileError } = await supabase.from("business_profiles").upsert(
        {
          user_id: uid,
          name: trimmed.businessName,
          address: addr,
          category: trimmed.category,
          setup_completed: true,
        },
        { onConflict: "user_id" },
      );
      if (profileError) throw profileError;

      setBanner({ message: "Setup complete - ready to launch BOGO deals!", tone: "success" });
      setTimeout(() => {
        router.replace("/create/quick");
      }, 250);
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
        <Field label={t("businessSetup.businessName")} value={businessName} onChangeText={setBusinessName} />
        <Field label={t("businessSetup.address")} value={address} onChangeText={setAddress} />
        <Field label={t("businessSetup.phone")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

        {/* Category picker */}
        <View>
          <Text style={{ fontWeight: "700", marginBottom: 8 }}>Category *</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {CATEGORIES.map((cat) => {
              const selected = category === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: Radii.pill,
                    borderWidth: 1.5,
                    borderColor: selected ? Colors.light.primary : Colors.light.border,
                    backgroundColor: selected ? "#FFF3E0" : Colors.light.surface,
                  }}
                >
                  <Text
                    style={{
                      color: selected ? Colors.light.primary : "#11181C",
                      fontWeight: selected ? "600" : "400",
                      fontSize: 14,
                    }}
                  >
                    {cat}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <Field
          label="Hours (optional)"
          value={hours}
          onChangeText={setHours}
          placeholder="e.g. Mon–Fri 7am–6pm, Sat 8am–4pm"
        />

        <Field
          label={t("businessSetup.shortDescription")}
          value={shortDescription}
          onChangeText={setShortDescription}
          multiline
          placeholder={t("businessSetup.shortDescriptionPh")}
        />

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
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "words";
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <View>
      <Text style={{ fontWeight: "700", marginBottom: 6 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "words"}
        multiline={multiline}
        placeholder={placeholder}
        style={{
          borderWidth: 1,
          borderColor: Colors.light.border,
          borderRadius: Radii.lg,
          backgroundColor: Colors.light.surface,
          paddingVertical: Spacing.sm,
          paddingHorizontal: Spacing.md,
          fontSize: 16,
          minHeight: multiline ? 92 : undefined,
          textAlignVertical: multiline ? "top" : "auto",
        }}
      />
    </View>
  );
}
