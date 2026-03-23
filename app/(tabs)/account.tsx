import { useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { getAlertsEnabled, setAlertsEnabled } from "../../lib/notifications";
import { useBusiness } from "../../hooks/use-business";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import type { AppLocale } from "../../lib/i18n/config";
import { setUiLocalePreference } from "../../lib/locale/ui-locale-storage";

export default function AccountScreen() {
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const { t, i18n } = useTranslation();
  const { isLoggedIn, sessionEmail, businessId, businessProfile, loading, refresh } = useBusiness();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone?: "error" | "success" | "info" } | null>(null);
  const [alertsEnabled, setAlertsEnabledState] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [businessName, setBusinessName] = useState("");
  const [creatingBusiness, setCreatingBusiness] = useState(false);
  const [profileCategory, setProfileCategory] = useState("");
  const [profileTone, setProfileTone] = useState("");
  const [profileLocation, setProfileLocation] = useState("");
  const [profileShortDescription, setProfileShortDescription] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  /** null = follow app language for AI / deal-quality */
  const [profilePreferredLocale, setProfilePreferredLocale] = useState<string | null>(null);

  useEffect(() => {
    if (!businessProfile) {
      setProfileCategory("");
      setProfileTone("");
      setProfileLocation("");
      setProfileShortDescription("");
      setProfilePreferredLocale(null);
      return;
    }
    setProfileCategory(businessProfile.category ?? "");
    setProfileTone(businessProfile.tone ?? "");
    setProfileLocation(businessProfile.location ?? "");
    setProfileShortDescription(businessProfile.short_description ?? "");
    setProfilePreferredLocale(businessProfile.preferred_locale ?? null);
  }, [businessProfile]);

  useEffect(() => {
    (async () => {
      const enabled = await getAlertsEnabled();
      setAlertsEnabledState(enabled);
      setAlertsLoading(false);
    })();
  }, []);

  async function toggleAlerts(next: boolean) {
    if (next) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") {
        setBanner({ message: t("account.alertsEnableHint"), tone: "info" });
        return;
      }
    }
    await setAlertsEnabled(next);
    setAlertsEnabledState(next);
    setBanner({ message: next ? t("account.alertsOn") : t("account.alertsOff"), tone: "success" });
  }

  async function signUp() {
    setBusy(true);
    setBanner(null);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password: pw,
      });
      if (error) throw error;
      setBanner({ message: "Check your email to confirm, then log in.", tone: "success" });
    } catch (e: any) {
      setBanner({ message: e?.message ?? "Sign up failed.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function signIn(overrideEmail?: string, overridePw?: string) {
    setBusy(true);
    setBanner(null);
    try {
      const demoEmail = "demo@demo.com";
      const demoPassword = "demo12345";
      const emailToUse = (overrideEmail ?? email).trim();
      const pwToUse = overridePw ?? pw;
      const isDemo = emailToUse.toLowerCase() === demoEmail;

      const { error } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password: pwToUse,
      });

      if (error) {
        const isDev = process.env.NODE_ENV !== "production";
        const msg = String(error.message || "");
        const canAutoSignUp =
          isDev &&
          isDemo &&
          (msg.includes("Invalid login credentials") || msg.toLowerCase().includes("user not found"));

        if (canAutoSignUp) {
          const { error: signUpError } = await supabase.auth.signUp({
            email: demoEmail,
            password: demoPassword,
          });
          if (signUpError) throw signUpError;

          const { error: retryError } = await supabase.auth.signInWithPassword({
            email: demoEmail,
            password: demoPassword,
          });
          if (retryError) throw retryError;
        } else {
          throw error;
        }
      }

      await refresh();
      if (isDemo) {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (userId) {
          const { data } = await supabase
            .from("businesses")
            .select("id")
            .eq("owner_id", userId)
            .maybeSingle();
          if (!data) {
          await supabase.from("businesses").insert({ owner_id: userId, name: "Demo Cafe" });
          }
        }
        await refresh();
      }
      setBanner({ message: "You're logged in.", tone: "success" });
    } catch (e: any) {
      setBanner({ message: e?.message ?? "Login failed.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setBanner(null);
    try {
      await supabase.auth.signOut();
      setBanner({ message: "Logged out.", tone: "info" });
    } catch (e: any) {
      setBanner({ message: e?.message ?? "Logout failed.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function saveBusinessProfile() {
    if (!businessId) return;
    setSavingProfile(true);
    setBanner(null);
    try {
      const { error } = await supabase
        .from("businesses")
        .update({
          category: profileCategory.trim() || null,
          tone: profileTone.trim() || null,
          location: profileLocation.trim() || null,
          short_description: profileShortDescription.trim() || null,
          preferred_locale: profilePreferredLocale,
        })
        .eq("id", businessId);
      if (error) throw error;
      await refresh();
      setBanner({ message: "Business profile saved. AI ads will use this when set.", tone: "success" });
    } catch (e: any) {
      setBanner({ message: e?.message ?? "Could not save profile.", tone: "error" });
    } finally {
      setSavingProfile(false);
    }
  }

  async function createBusiness() {
    if (!sessionEmail) {
      setBanner({ message: "Please log in to create a business.", tone: "error" });
      return;
    }
    const name = businessName.trim();
    if (!name) {
      setBanner({ message: "Business name required.", tone: "error" });
      return;
    }
    setCreatingBusiness(true);
    setBanner(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error("Missing user session.");
      const { error } = await supabase.from("businesses").insert({ owner_id: userId, name });
      if (error) throw error;
      setBusinessName("");
      await refresh();
      setBanner({ message: "Business created.", tone: "success" });
    } catch (e: any) {
      setBanner({ message: e?.message ?? "Create business failed.", tone: "error" });
    } finally {
      setCreatingBusiness(false);
    }
  }

  async function chooseAppLocale(locale: AppLocale) {
    setBanner(null);
    await setUiLocalePreference(locale, { manual: true });
    await i18n.changeLanguage(locale);
    setBanner({ message: t("account.languageSaved"), tone: "success" });
  }

  function localeChip(label: string, locale: AppLocale, active: boolean, onPress: () => void) {
    return (
      <Pressable
        onPress={onPress}
        style={{
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 10,
          backgroundColor: active ? "#111" : "#f0f0f0",
          marginRight: 8,
          marginBottom: 8,
        }}
      >
        <Text style={{ color: active ? "#fff" : "#111", fontWeight: "600", fontSize: 13 }}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("account.title")}</Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {!isLoggedIn ? (
        <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
          <View>
            <Text>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                borderRadius: 10,
                padding: 12,
                marginTop: 6,
              }}
            />
          </View>

          <View>
            <Text>Password</Text>
            <TextInput
              value={pw}
              onChangeText={setPw}
              secureTextEntry
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                borderRadius: 10,
                padding: 12,
                marginTop: 6,
              }}
            />
          </View>

          <PrimaryButton title={busy ? "Logging in..." : "Log in"} onPress={() => signIn()} disabled={busy} />
          <SecondaryButton title="Sign up" onPress={signUp} disabled={busy} />
          <PrimaryButton title="Demo Login" onPress={() => signIn("demo@demo.com", "demo12345")} disabled={busy} />
        </View>
      ) : (
        <ScrollView
          style={{ marginTop: Spacing.lg, flex: 1 }}
          contentContainerStyle={{ gap: Spacing.md, paddingBottom: scrollBottom }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              borderWidth: 1,
              borderColor: "#eee",
              borderRadius: 12,
              padding: 12,
              gap: 8,
            }}
          >
            <Text style={{ fontWeight: "700" }}>{t("language.sectionApp")}</Text>
            <Text style={{ opacity: 0.7, fontSize: 13, lineHeight: 18 }}>{t("language.sectionAppHelp")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
              {localeChip(t("language.english"), "en", i18n.language === "en", () => chooseAppLocale("en"))}
              {localeChip(t("language.spanish"), "es", i18n.language === "es", () => chooseAppLocale("es"))}
              {localeChip(t("language.korean"), "ko", i18n.language === "ko", () => chooseAppLocale("ko"))}
            </View>
          </View>

          <View style={{ gap: Spacing.sm }}>
            <PrimaryButton title="Customer mode" onPress={() => router.replace("/(tabs)")} />
            <SecondaryButton title="Business mode" onPress={() => router.replace("/(tabs)/create")} />
          </View>
          <View>
            <Text style={{ opacity: 0.7 }}>Logged in as</Text>
            <Text style={{ fontWeight: "700", marginTop: 4 }}>{sessionEmail}</Text>
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: "#eee",
              borderRadius: 12,
              padding: 12,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <View>
              <Text style={{ fontWeight: "700" }}>Deal alerts</Text>
              <Text style={{ opacity: 0.7, marginTop: 4 }}>Notify me when favorites post new deals.</Text>
            </View>
            <Switch value={alertsEnabled} onValueChange={toggleAlerts} disabled={alertsLoading} />
          </View>

          {businessId ? (
            <View
              style={{
                backgroundColor: "#fafafa",
                borderRadius: 12,
                padding: 12,
                borderWidth: 1,
                borderColor: "#eee",
                gap: 10,
              }}
            >
              <Text style={{ fontWeight: "700" }}>{t("language.sectionBusiness")}</Text>
              <Text style={{ opacity: 0.7, fontSize: 13, lineHeight: 18 }}>
                {t("language.sectionBusinessHelp")}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <Pressable
                  onPress={() => setProfilePreferredLocale(null)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    backgroundColor: profilePreferredLocale == null ? "#111" : "#e8e8e8",
                    marginRight: 8,
                    marginBottom: 8,
                  }}
                >
                  <Text
                    style={{
                      color: profilePreferredLocale == null ? "#fff" : "#111",
                      fontWeight: "600",
                      fontSize: 13,
                    }}
                  >
                    {t("language.useAppLanguage")}
                  </Text>
                </Pressable>
                {(["en", "es", "ko"] as const).map((loc) => (
                  <Pressable
                    key={loc}
                    onPress={() => setProfilePreferredLocale(loc)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 10,
                      backgroundColor: profilePreferredLocale === loc ? "#111" : "#e8e8e8",
                      marginRight: 8,
                      marginBottom: 8,
                    }}
                  >
                    <Text
                      style={{
                        color: profilePreferredLocale === loc ? "#fff" : "#111",
                        fontWeight: "600",
                        fontSize: 13,
                      }}
                    >
                      {loc === "en"
                        ? t("language.english")
                        : loc === "es"
                          ? t("language.spanish")
                          : t("language.korean")}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={{ fontWeight: "700", marginTop: 8 }}>Business profile (optional)</Text>
              <Text style={{ opacity: 0.7, fontSize: 13, lineHeight: 18 }}>
                Helps AI write ads that fit your place. Skip any field — deals and AI still work without
                them.
              </Text>
              <View>
                <Text style={{ fontSize: 13 }}>Category</Text>
                <TextInput
                  value={profileCategory}
                  onChangeText={setProfileCategory}
                  placeholder="e.g. Coffee shop, bakery"
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>Tone</Text>
                <TextInput
                  value={profileTone}
                  onChangeText={setProfileTone}
                  placeholder="e.g. friendly, local, straightforward"
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>Location</Text>
                <TextInput
                  value={profileLocation}
                  onChangeText={setProfileLocation}
                  placeholder="Neighborhood or city"
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>Short description</Text>
                <TextInput
                  value={profileShortDescription}
                  onChangeText={setProfileShortDescription}
                  placeholder="One or two sentences about your business"
                  multiline
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                    minHeight: 72,
                    textAlignVertical: "top",
                  }}
                />
              </View>
              <PrimaryButton
                title={savingProfile ? "Saving…" : "Save business profile"}
                onPress={saveBusinessProfile}
                disabled={savingProfile}
              />
            </View>
          ) : null}

          {businessId ? (
            <PrimaryButton title="Business Dashboard" onPress={() => router.push("/dashboard")} />
          ) : (
            <View
              style={{
                backgroundColor: "#f8f8f8",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <Text style={{ fontWeight: "700" }}>Create business</Text>
              <Text style={{ marginTop: 6, opacity: 0.7 }}>
                Create a business to post deals and redeem QR codes.
              </Text>
              <TextInput
                value={businessName}
                onChangeText={setBusinessName}
                placeholder="Business name"
                autoCapitalize="words"
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 10,
                }}
              />
              <View style={{ marginTop: 10 }}>
                <PrimaryButton
                  title={creatingBusiness ? "Creating..." : "Create Business"}
                  onPress={createBusiness}
                  disabled={creatingBusiness}
                />
              </View>
            </View>
          )}

          <Pressable
            onPress={signOut}
            disabled={busy || loading}
            style={{
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: "#eee",
              opacity: busy || loading ? 0.7 : 1,
            }}
          >
            <Text style={{ color: "#111", fontWeight: "700", textAlign: "center" }}>Log out</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}
