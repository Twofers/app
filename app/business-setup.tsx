import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "@/components/ui/primary-button";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { supabase } from "@/lib/supabase";
import { Colors, Radii } from "@/constants/theme";

type Tone = "error" | "success" | "info";

export default function BusinessSetupScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { session, isInitialLoading: authLoading } = useAuthSession();

  const [businessName, setBusinessName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: Tone } | null>(null);

  const trimmed = useMemo(
    () => ({
      businessName: businessName.trim(),
      address: address.trim(),
      phone: phone.trim(),
      shortDescription: shortDescription.trim(),
    }),
    [businessName, address, phone, shortDescription],
  );

  useEffect(() => {
    if (authLoading) return;
    const bypass = String(params.skipSetup ?? "") === "1" || String(params.e2e ?? "") === "1";
    if (!bypass && !session?.user?.id) router.replace("/auth-landing");
  }, [router, params.skipSetup, params.e2e, session?.user?.id, authLoading]);


  async function onSubmit() {
    setBanner(null);
    if (!trimmed.businessName || !trimmed.address) {
      setBanner({ message: t("businessSetup.errNameAddress"), tone: "error" });
      return;
    }

    const uid = session?.user?.id;
    if (!uid) {
      setBanner({ message: t("createHub.errLoginBusiness"), tone: "error" });
      return;
    }

    setBusy(true);
    try {
      const addr = trimmed.address;
      const { error } = await supabase
        .from("businesses")
        .upsert(
          {
            owner_id: uid,
            name: trimmed.businessName,
            phone: trimmed.phone || null,
            address: addr,
            location: addr,
            short_description: trimmed.shortDescription || null,
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
          category: trimmed.shortDescription || trimmed.businessName || null,
          setup_completed: true,
        },
        { onConflict: "user_id" },
      );
      if (profileError) throw profileError;

      setBanner({ message: t("businessSetup.setupComplete"), tone: "success" });
      setTimeout(() => {
        router.replace("/create/quick");
      }, 250);
    } catch (e: unknown) {
      setBanner({
        message: (e instanceof Error ? e.message : String(e)) || t("businessSetup.errSave"),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardScreen>
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("businessSetup.title")}</Text>
      <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, opacity: 0.72, fontSize: 15, lineHeight: 22 }}>
        {t("businessSetup.subtitle")}
      </Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.md }}
        {...FORM_SCROLL_KEYBOARD_PROPS}
        showsVerticalScrollIndicator={false}
      >
        <Field label={t("businessSetup.businessName")} value={businessName} onChangeText={setBusinessName} />
        <Field label={t("businessSetup.address")} value={address} onChangeText={setAddress} />
        <Field label={t("businessSetup.phone")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
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
    </KeyboardScreen>
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
