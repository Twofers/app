import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { consumePendingDeepLink } from "@/lib/post-auth-route";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { supabase } from "@/lib/supabase";
import { Colors, Radii, Shadows } from "@/constants/theme";
import { isAuthBypassEnabled } from "@/lib/auth-bypass";
import { aiBusinessLookup, type BusinessLookupResult } from "@/lib/functions";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";

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
  const [searching, setSearching] = useState(false);
  const [lookupResults, setLookupResults] = useState<BusinessLookupResult[] | null>(null);

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
    const bypass = isAuthBypassEnabled({
      skipSetup: String(params.skipSetup ?? ""),
      e2e: String(params.e2e ?? ""),
      isDev: __DEV__,
    });
    if (!bypass && !session?.user?.id) router.replace("/auth-landing");
  }, [router, params.skipSetup, params.e2e, session?.user?.id, authLoading]);

  // Pre-fill the form when an existing business is found for this owner. Without
  // this, navigating back to /business-setup to "edit" shows an empty form, and
  // submitting after typing only one field would wipe everything else (the upsert
  // sends the full row). Uses `prev ||` so a user mid-type isn't clobbered by a
  // late-resolving fetch.
  useEffect(() => {
    if (authLoading) return;
    const uid = session?.user?.id;
    if (!uid) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("businesses")
        .select("name,address,phone,short_description")
        .eq("owner_id", uid)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const row = data as {
        name: string | null;
        address: string | null;
        phone: string | null;
        short_description: string | null;
      };
      setBusinessName((prev) => prev || (row.name ?? ""));
      setAddress((prev) => prev || (row.address ?? ""));
      setPhone((prev) => prev || (row.phone ?? ""));
      setShortDescription((prev) => prev || (row.short_description ?? ""));
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user?.id]);


  async function onLookup() {
    if (!businessName.trim()) {
      setBanner({ message: t("businessSetup.errEnterName"), tone: "error" });
      return;
    }
    setSearching(true);
    setLookupResults(null);
    setBanner(null);
    try {
      const results = await aiBusinessLookup({ business_name: businessName.trim() });
      if (results.length === 0) {
        setBanner({ message: t("businessSetup.noResults"), tone: "info" });
      }
      setLookupResults(results.length > 0 ? results : null);
    } catch (e: unknown) {
      if (__DEV__) console.warn("[business-setup] Lookup error:", e);
      setBanner({ message: t("businessSetup.lookupError"), tone: "error" });
    } finally {
      setSearching(false);
    }
  }

  function applyLookupResult(result: BusinessLookupResult) {
    setBusinessName(result.name);
    setAddress(result.formatted_address);
    if (result.phone) setPhone(result.phone);
    if (result.category) setShortDescription(result.category);
    setLookupResults(null);
    const isEstimate = result.source === "ai_estimate";
    setBanner({
      message: isEstimate
        ? t("businessSetup.estimatedInfo")
        : t("businessSetup.infoFilled"),
      tone: isEstimate ? "info" : "success",
    });
  }

  async function onSubmit() {
    if (busy) return;
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
      const trialEndsIso = new Date(Date.now() + 30 * 86400000).toISOString();
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

      const selectCols =
        "id,user_id,owner_id,subscription_status,subscription_tier,trial_ends_at,current_period_ends_at";
      const { data: profileByUser } = await supabase
        .from("business_profiles")
        .select(selectCols)
        .eq("user_id", uid)
        .maybeSingle();
      const { data: profileByOwner } = await supabase
        .from("business_profiles")
        .select(selectCols)
        .eq("owner_id", uid)
        .maybeSingle();

      const existingProfile = profileByUser ?? profileByOwner ?? null;
      const billingDefaults: Record<string, unknown> = {};
      if (!existingProfile?.subscription_status) billingDefaults.subscription_status = "trial";
      if (!existingProfile?.subscription_tier) billingDefaults.subscription_tier = "pro";
      if (!existingProfile?.trial_ends_at) billingDefaults.trial_ends_at = trialEndsIso;
      if (!existingProfile?.current_period_ends_at) {
        billingDefaults.current_period_ends_at = String(existingProfile?.trial_ends_at ?? trialEndsIso);
      }

      const profilePayloadByUser = {
        user_id: uid,
        name: trimmed.businessName,
        address: addr,
        category: trimmed.shortDescription || trimmed.businessName || null,
        setup_completed: true,
        ...billingDefaults,
      };
      const upsertByUser = await supabase
        .from("business_profiles")
        .upsert(profilePayloadByUser, { onConflict: "user_id" });
      if (upsertByUser.error) {
        const profilePayloadByOwner = {
          owner_id: uid,
          name: trimmed.businessName,
          address: addr,
          category: trimmed.shortDescription || trimmed.businessName || null,
          setup_completed: true,
          ...billingDefaults,
        };
        const upsertByOwner = await supabase
          .from("business_profiles")
          .upsert(profilePayloadByOwner, { onConflict: "owner_id" });
        if (upsertByOwner.error) throw upsertByOwner.error;
      }

      setBanner({ message: t("businessSetup.setupComplete"), tone: "success" });
      setTimeout(async () => {
        const pending = await consumePendingDeepLink();
        router.replace((pending ?? "/(tabs)/dashboard") as any);
      }, 250);
    } catch (e: unknown) {
      if (__DEV__) console.warn("[business-setup] Save error:", e);
      // Generic "couldn't save" leaves the owner stuck. Pass the raw message through
      // translateKnownApiMessage so JWT-expired, RLS, duplicate-name, network and
      // similar errors get a specific localized message they can act on. Fall back to
      // the generic copy only if we have nothing useful to show.
      const raw = e instanceof Error ? e.message : "";
      const friendly = raw ? translateKnownApiMessage(raw, t) : "";
      setBanner({
        message: friendly && friendly !== raw ? friendly : t("businessSetup.errSave"),
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
        <Field label={t("businessSetup.businessName")} value={businessName} onChangeText={(s) => { setBusinessName(s); setLookupResults(null); }} />

        <SecondaryButton
          title={searching ? t("businessSetup.searching") : t("businessSetup.lookupButton")}
          onPress={() => void onLookup()}
          disabled={searching || !businessName.trim()}
        />

        {searching && (
          <View style={{ alignItems: "center", paddingVertical: Spacing.sm }}>
            <ActivityIndicator color={Colors.light.primary} />
          </View>
        )}

        {lookupResults && lookupResults.length > 0 && (
          <View style={{ gap: Spacing.sm }}>
            <Text style={{ fontSize: 13, fontWeight: "600", opacity: 0.6 }}>
              {t("businessSetup.selectResult")}
            </Text>
            {lookupResults.map((r, i) => (
              <Pressable key={i} onPress={() => applyLookupResult(r)}>
                <View
                  style={{
                    backgroundColor: Colors.light.surface,
                    borderRadius: Radii.lg,
                    padding: Spacing.md,
                    borderWidth: 1,
                    borderColor: Colors.light.border,
                    ...Shadows.soft,
                  }}
                >
                  <Text style={{ fontWeight: "700", fontSize: 15 }}>{r.name}</Text>
                  <Text style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>{r.formatted_address}</Text>
                  {r.phone ? <Text style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>{r.phone}</Text> : null}
                  {r.category ? <Text style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>{r.category}</Text> : null}
                  {r.source === "ai_estimate" && (
                    <Text style={{ fontSize: 11, color: Colors.light.primary, marginTop: 4 }}>
                      {t("businessSetup.aiEstimate")}
                    </Text>
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        )}

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
