import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { useRouter, type Href } from "expo-router";
import * as Notifications from "expo-notifications";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { getAlertsEnabled, setAlertsEnabled } from "../../lib/notifications";
import { useBusiness } from "../../hooks/use-business";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import type { AppLocale } from "../../lib/i18n/config";
import { setUiLocalePreference } from "../../lib/locale/ui-locale-storage";
import { useTabMode } from "../../lib/tab-mode";
import { LegalExternalLinks } from "../../components/legal-external-links";
import { DELETE_ACCOUNT_BLOCKED_BUSINESS_OWNER, deleteUserAccount } from "../../lib/functions";
import { DELETE_ACCOUNT_URL, SUPPORT_URL, openWebsiteUrl } from "../../lib/legal-urls";
import { isDemoAuthHelperEnabled } from "../../lib/runtime-env";

export default function AccountScreen() {
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const { mode: tabMode, setMode: setTabMode } = useTabMode();
  const { t, i18n } = useTranslation();
  const {
    isLoggedIn,
    sessionEmail,
    businessId,
    businessOwnershipAmbiguous,
    businessProfile,
    loading,
    refresh,
  } = useBusiness();
  const blockInAppSelfDelete = Boolean(businessId || businessOwnershipAmbiguous);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone?: "error" | "success" | "info" } | null>(null);
  const [alertsEnabled, setAlertsEnabledState] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [profileBusinessName, setProfileBusinessName] = useState("");
  const [profileContactName, setProfileContactName] = useState("");
  const [profileBusinessEmail, setProfileBusinessEmail] = useState("");
  const [profileAddress, setProfileAddress] = useState("");
  const [profileCategory, setProfileCategory] = useState("");
  const [profileTone, setProfileTone] = useState("");
  const [profileLocation, setProfileLocation] = useState("");
  const [profileLatitude, setProfileLatitude] = useState("");
  const [profileLongitude, setProfileLongitude] = useState("");
  const [profileShortDescription, setProfileShortDescription] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  /** null = follow app language for AI / deal-quality */
  const [profilePreferredLocale, setProfilePreferredLocale] = useState<string | null>(null);
  const [profilePhone, setProfilePhone] = useState("");
  const [profileHours, setProfileHours] = useState("");

  useEffect(() => {
    if (!businessProfile) {
      setProfileBusinessName("");
      setProfileContactName("");
      setProfileBusinessEmail("");
      setProfileAddress("");
      setProfileCategory("");
      setProfileTone("");
      setProfileLocation("");
      setProfileLatitude("");
      setProfileLongitude("");
      setProfileShortDescription("");
      setProfilePreferredLocale(null);
      setProfilePhone("");
      setProfileHours("");
      return;
    }
    setProfileBusinessName(businessProfile.name ?? "");
    setProfileContactName(businessProfile.contact_name ?? "");
    setProfileBusinessEmail(businessProfile.business_email ?? "");
    setProfileAddress(businessProfile.address ?? "");
    setProfileCategory(businessProfile.category ?? "");
    setProfileTone(businessProfile.tone ?? "");
    setProfileLocation(businessProfile.location ?? "");
    setProfileLatitude(
      businessProfile.latitude != null && Number.isFinite(businessProfile.latitude)
        ? String(businessProfile.latitude)
        : "",
    );
    setProfileLongitude(
      businessProfile.longitude != null && Number.isFinite(businessProfile.longitude)
        ? String(businessProfile.longitude)
        : "",
    );
    setProfileShortDescription(businessProfile.short_description ?? "");
    setProfilePreferredLocale(businessProfile.preferred_locale ?? null);
    setProfilePhone(businessProfile.phone ?? "");
    setProfileHours(businessProfile.hours_text ?? "");
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
      setBanner({ message: t("auth.alertSignUpSuccessMsg"), tone: "success" });
    } catch (e: any) {
      setBanner({ message: e?.message ?? t("account.errSignUpFailed"), tone: "error" });
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
        const msg = String(error.message || "");
        const canAutoSignUp =
          isDemoAuthHelperEnabled() &&
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
            await supabase.from("businesses").insert({
              owner_id: userId,
              name: t("account.demoBusinessName"),
              contact_name: "Demo Owner",
              business_email: "hello@demo.twofer.app",
              phone: "(555) 555-0100",
              address: "Austin, TX",
              location: "Austin, TX",
              category: "Demo",
              hours_text: "Mon–Fri 9am–5pm",
            });
          }
        }
        await refresh();
      }
      setBanner({ message: t("auth.alertLoggedInMsg"), tone: "success" });
    } catch (e: any) {
      setBanner({ message: e?.message ?? t("account.errLoginFailed"), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setBanner(null);
    try {
      await supabase.auth.signOut();
      setBanner({ message: t("account.loggedOut"), tone: "info" });
    } catch (e: any) {
      setBanner({ message: e?.message ?? t("account.errLogoutFailed"), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  function confirmDeleteAccount() {
    Alert.alert(t("deleteAccount.title"), t("deleteAccount.bodyConsumer"), [
      { text: t("commonUi.cancel"), style: "cancel" },
      {
        text: t("deleteAccount.confirmDestructive"),
        style: "destructive",
        onPress: () => void runDeleteAccount(),
      },
    ]);
  }

  async function runDeleteAccount() {
    setBusy(true);
    setBanner(null);
    try {
      await deleteUserAccount();
      await supabase.auth.signOut();
      router.replace("/(tabs)/account" as Href);
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : undefined;
      if (code === DELETE_ACCOUNT_BLOCKED_BUSINESS_OWNER) {
        setBanner({ message: t("deleteAccount.businessOwnerBlockedShort"), tone: "info" });
        Alert.alert(t("deleteAccount.businessOwnerBlockedTitle"), t("deleteAccount.businessOwnerBlockedBody"), [
          { text: t("deleteAccount.alertDismiss"), style: "cancel" },
          { text: t("deleteAccount.contactSupportCta"), onPress: () => void openWebsiteUrl(SUPPORT_URL) },
        ]);
        return;
      }
      const msg = e instanceof Error ? e.message : t("deleteAccount.errFailed");
      setBanner({ message: msg, tone: "error" });
      Alert.alert(t("deleteAccount.errFailed"), t("deleteAccount.fallbackWebBody"), [
        { text: t("deleteAccount.alertDismiss"), style: "cancel" },
        {
          text: t("deleteAccount.openWebsiteFallbackCta"),
          onPress: () => void openWebsiteUrl(DELETE_ACCOUNT_URL),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function parseOptionalCoord(raw: string, kind: "lat" | "lng", tr: TFunction): number | null {
    const s = raw.trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) {
      throw new Error(kind === "lat" ? tr("account.errLatNumber") : tr("account.errLngNumber"));
    }
    if (kind === "lat" && (n < -90 || n > 90)) {
      throw new Error(tr("account.errLatRange"));
    }
    if (kind === "lng" && (n < -180 || n > 180)) {
      throw new Error(tr("account.errLngRange"));
    }
    return n;
  }

  async function saveBusinessProfile() {
    if (!businessId) return;
    setSavingProfile(true);
    setBanner(null);
    try {
      let latitude: number | null;
      let longitude: number | null;
      try {
        latitude = parseOptionalCoord(profileLatitude, "lat", t);
        longitude = parseOptionalCoord(profileLongitude, "lng", t);
      } catch (e: any) {
        setBanner({ message: e?.message ?? t("account.errCoordsInvalid"), tone: "error" });
        return;
      }
      if ((latitude == null) !== (longitude == null)) {
        setBanner({
          message: t("account.errCoordsBoth"),
          tone: "error",
        });
        return;
      }
      const nm = profileBusinessName.trim();
      const cn = profileContactName.trim();
      const em = profileBusinessEmail.trim();
      const ph = profilePhone.trim();
      const ad = profileAddress.trim();
      const cat = profileCategory.trim();
      const hrs = profileHours.trim();
      if (!nm || !cn || !em || !ph || !ad || !cat || !hrs) {
        setBanner({ message: t("account.errBizCoreRequired"), tone: "error" });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        setBanner({ message: t("account.errBizEmailInvalid"), tone: "error" });
        return;
      }
      const addr = ad;
      const { error } = await supabase
        .from("businesses")
        .update({
          name: nm,
          contact_name: cn,
          business_email: em,
          address: addr,
          category: cat,
          tone: profileTone.trim() || null,
          location: profileLocation.trim() || addr,
          latitude,
          longitude,
          short_description: profileShortDescription.trim() || null,
          preferred_locale: profilePreferredLocale,
          phone: ph,
          hours_text: hrs,
        })
        .eq("id", businessId);
      if (error) throw error;
      await refresh();
      setBanner({ message: t("account.profileSaved"), tone: "success" });
    } catch (e: any) {
      setBanner({ message: e?.message ?? t("account.errSaveProfileFailed"), tone: "error" });
    } finally {
      setSavingProfile(false);
    }
  }

  function goToBusinessSetup() {
    if (!sessionEmail) {
      setBanner({ message: t("account.errLoginForBiz"), tone: "error" });
      return;
    }
    router.push("/business-setup" as Href);
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
            <Text>{t("auth.email")}</Text>
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
            <Text>{t("auth.password")}</Text>
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

          <Pressable
            onPress={() => router.push("/forgot-password" as Href)}
            style={{ alignSelf: "flex-start", paddingVertical: 4 }}
          >
            <Text style={{ fontSize: 15, fontWeight: "600", color: "#2563eb" }}>{t("passwordRecovery.forgotLink")}</Text>
          </Pressable>

          <PrimaryButton title={busy ? t("auth.loggingIn") : t("auth.logIn")} onPress={() => void signIn()} disabled={busy} />
          <SecondaryButton title={t("auth.signUp")} onPress={() => void signUp()} disabled={busy} />
          <PrimaryButton title={t("auth.demoLogin")} onPress={() => void signIn("demo@demo.com", "demo12345")} disabled={busy} />
          <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
            <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.68 }}>{t("legal.authFooterHint")}</Text>
            <LegalExternalLinks />
          </View>
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

          <View
            style={{
              borderWidth: 1,
              borderColor: "#eee",
              borderRadius: 12,
              padding: Spacing.md,
              gap: Spacing.sm,
            }}
          >
            <Text style={{ fontWeight: "700" }}>{t("tabMode.title")}</Text>
            <Text style={{ opacity: 0.7, fontSize: 13, lineHeight: 18 }}>{t("tabMode.subtitle")}</Text>
            <View style={{ gap: Spacing.sm }}>
              <PrimaryButton
                title={t("tabMode.customer")}
                onPress={async () => {
                  await setTabMode("customer");
                  router.replace("/(tabs)");
                }}
              />
              <SecondaryButton
                title={t("tabMode.business")}
                onPress={async () => {
                  await setTabMode("business");
                  router.replace("/(tabs)/create");
                }}
              />
            </View>
            <Text style={{ fontSize: 12, opacity: 0.55 }}>
              {tabMode === "business" ? t("tabMode.currentBusiness") : t("tabMode.currentCustomer")}
            </Text>
          </View>
          <View>
            <Text style={{ opacity: 0.7 }}>{t("account.loggedInAsLabel")}</Text>
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

              <Text style={{ fontWeight: "700", marginTop: 8 }}>{t("account.bizProfileHeader")}</Text>
              <Text style={{ opacity: 0.7, fontSize: 13, lineHeight: 18 }}>{t("account.bizProfileHelp")}</Text>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldBusinessName")}</Text>
                <TextInput
                  value={profileBusinessName}
                  onChangeText={setProfileBusinessName}
                  placeholder={t("account.phBusinessName")}
                  autoCapitalize="words"
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
                <Text style={{ fontSize: 13 }}>{t("account.fieldContactName")}</Text>
                <TextInput
                  value={profileContactName}
                  onChangeText={setProfileContactName}
                  placeholder={t("account.phContactName")}
                  autoCapitalize="words"
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
                <Text style={{ fontSize: 13 }}>{t("account.fieldBusinessEmail")}</Text>
                <TextInput
                  value={profileBusinessEmail}
                  onChangeText={setProfileBusinessEmail}
                  placeholder={t("account.phBusinessEmail")}
                  autoCapitalize="none"
                  keyboardType="email-address"
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
                <Text style={{ fontSize: 13 }}>{t("account.fieldAddress")}</Text>
                <TextInput
                  value={profileAddress}
                  onChangeText={setProfileAddress}
                  placeholder={t("account.phAddress")}
                  autoCapitalize="words"
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
                <Text style={{ fontSize: 13 }}>{t("account.fieldPhoneRequired")}</Text>
                <TextInput
                  value={profilePhone}
                  onChangeText={setProfilePhone}
                  placeholder={t("account.phPhone")}
                  keyboardType="phone-pad"
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
                <Text style={{ fontSize: 13 }}>{t("account.fieldCategory")}</Text>
                <TextInput
                  value={profileCategory}
                  onChangeText={setProfileCategory}
                  placeholder={t("account.phCategory")}
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
                <Text style={{ fontSize: 13 }}>{t("account.fieldHoursRequired")}</Text>
                <TextInput
                  value={profileHours}
                  onChangeText={setProfileHours}
                  placeholder={t("account.phHours")}
                  multiline
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 4,
                    minHeight: 56,
                    textAlignVertical: "top",
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
                <Text style={{ fontSize: 13 }}>{t("account.fieldLocation")}</Text>
                <TextInput
                  value={profileLocation}
                  onChangeText={setProfileLocation}
                  placeholder={t("account.phLocation")}
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
                <Text style={{ fontSize: 13 }}>Latitude / longitude (optional, WGS84)</Text>
                <Text style={{ opacity: 0.65, fontSize: 12, marginTop: 4, lineHeight: 16 }}>
                  Lets customers sort by distance with Near me. Leave blank if unsure — Location text still helps.
                </Text>
                <TextInput
                  value={profileLatitude}
                  onChangeText={setProfileLatitude}
                  placeholder="e.g. 30.2672"
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 6,
                  }}
                />
                <TextInput
                  value={profileLongitude}
                  onChangeText={setProfileLongitude}
                  placeholder={t("account.phLng")}
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    borderWidth: 1,
                    borderColor: "#ccc",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 8,
                  }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 13 }}>{t("account.fieldShortDescription")}</Text>
                <TextInput
                  value={profileShortDescription}
                  onChangeText={setProfileShortDescription}
                  placeholder={t("account.phShortDescription")}
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
                title={savingProfile ? t("account.savingProfile") : t("account.saveBizProfile")}
                onPress={saveBusinessProfile}
                disabled={savingProfile}
              />
            </View>
          ) : null}

          {businessId ? (
            <PrimaryButton title={t("account.businessDashboard")} onPress={() => router.push("/(tabs)/dashboard")} />
          ) : (
            <View
              style={{
                backgroundColor: "#f8f8f8",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <Text style={{ fontWeight: "700" }}>{t("account.createBizCardTitle")}</Text>
              <Text style={{ marginTop: 6, opacity: 0.7 }}>{t("account.createBizCardBody")}</Text>
              <View style={{ marginTop: 10 }}>
                <PrimaryButton title={t("account.startBusinessSetup")} onPress={goToBusinessSetup} />
              </View>
            </View>
          )}

          <View
            style={{
              borderWidth: 1,
              borderColor: "#eee",
              borderRadius: 12,
              padding: Spacing.md,
              gap: Spacing.sm,
            }}
          >
            <Text style={{ fontWeight: "700" }}>{t("legal.sectionTitle")}</Text>
            <LegalExternalLinks />
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: blockInAppSelfDelete ? "#e5e5e5" : "#f3d4d4",
              borderRadius: 12,
              padding: Spacing.md,
              gap: Spacing.sm,
              backgroundColor: blockInAppSelfDelete ? "#fafafa" : "#fffafa",
            }}
          >
            <Text
              style={{
                fontWeight: "700",
                color: blockInAppSelfDelete ? "#444" : "#7f1d1d",
              }}
            >
              {t("deleteAccount.sectionTitle")}
            </Text>
            {blockInAppSelfDelete ? (
              <>
                <Text style={{ fontSize: 14, lineHeight: 20, opacity: 0.88, color: "#333" }}>
                  {businessId
                    ? t("deleteAccount.businessOwnerBlockedBody")
                    : t("deleteAccount.ownershipAmbiguousBlockedBody")}
                </Text>
                <Pressable
                  onPress={() => void openWebsiteUrl(SUPPORT_URL)}
                  style={{ alignSelf: "flex-start", paddingVertical: 4 }}
                >
                  <Text style={{ fontSize: 14, fontWeight: "600", color: "#2563eb" }}>
                    {t("deleteAccount.contactSupportCta")}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 14, lineHeight: 20, opacity: 0.85, color: "#444" }}>
                  {t("deleteAccount.sectionBodyConsumer")}
                </Text>
                <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.75, color: "#444" }}>
                  {t("deleteAccount.fallbackWebHint")}
                </Text>
                <Pressable
                  onPress={() => void openWebsiteUrl(DELETE_ACCOUNT_URL)}
                  style={{ alignSelf: "flex-start", paddingVertical: 4 }}
                >
                  <Text style={{ fontSize: 14, fontWeight: "600", color: "#2563eb" }}>
                    {t("legal.deleteAccount")}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={confirmDeleteAccount}
                  disabled={busy || loading}
                  style={{
                    paddingVertical: 12,
                    borderRadius: 12,
                    backgroundColor: "#b91c1c",
                    opacity: busy || loading ? 0.65 : 1,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "800", textAlign: "center" }}>
                    {t("deleteAccount.cta")}
                  </Text>
                </Pressable>
              </>
            )}
          </View>

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
            <Text style={{ color: "#111", fontWeight: "700", textAlign: "center" }}>{t("account.logOut")}</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}
