import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Image, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useNavigation, useRouter, type Href } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import * as ImagePicker from "expo-image-picker";

import { Banner } from "@/components/ui/banner";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { LegalExternalLinks } from "@/components/legal-external-links";
import { consumePendingDeepLink } from "@/lib/post-auth-route";
import { getBusinessSetupCopyKeys, type BusinessSetupMode } from "@/lib/business-setup-copy";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { supabase } from "@/lib/supabase";
import { fetchOwnerBusiness } from "@/lib/owner-business";
import { Colors, Radii, Shadows } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { isAuthBypassEnabled } from "@/lib/auth-bypass";
import { aiBusinessLookup, aiBusinessLookupDetails, type BusinessLookupResult } from "@/lib/functions";
import { isVerifiedBusinessLookupResult } from "@/lib/business-lookup";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";
import { signOutAndRedirectToAuthLanding } from "@/lib/auth-app-sign-out";
import { useBrandedConfirm } from "@/hooks/use-branded-confirm";
import {
  BUSINESS_INVITE_PENDING_META_KEY,
  isUserInviteValidated,
  isValidBusinessInviteCode,
  submitBusinessInvite,
} from "@/lib/business-invite";

type Tone = "error" | "success" | "info";

const CATEGORY_KEYS = [
  "restaurant",
  "cafe",
  "bakery",
  "retail",
  "salon",
  "gym",
  "services",
  "other",
] as const;

const HOURS_PRESET_KEYS = [
  "weekday_9_5",
  "daily_8_8",
  "weekends",
  "late_night",
  "custom_prompt",
] as const;

type CategoryKey = (typeof CATEGORY_KEYS)[number];

type BusinessSetupSnapshot = {
  businessName: string;
  address: string;
  phone: string;
  shortDescription: string;
  category: string;
  customCategory: string;
  hoursPreset: string;
  customHours: string;
  logoUri: string;
};

function serializeBusinessSetupSnapshot(snapshot: BusinessSetupSnapshot): string {
  return JSON.stringify({
    businessName: snapshot.businessName.trim(),
    address: snapshot.address.trim(),
    phone: snapshot.phone.trim(),
    shortDescription: snapshot.shortDescription.trim(),
    category: snapshot.category.trim(),
    customCategory: snapshot.customCategory.trim(),
    hoursPreset: snapshot.hoursPreset.trim(),
    customHours: snapshot.customHours.trim(),
    logoUri: snapshot.logoUri.trim(),
  });
}

const EMPTY_BUSINESS_SETUP_SNAPSHOT = serializeBusinessSetupSnapshot({
  businessName: "",
  address: "",
  phone: "",
  shortDescription: "",
  category: "",
  customCategory: "",
  hoursPreset: "",
  customHours: "",
  logoUri: "",
});

function categoryKeyFromLookup(value: string): CategoryKey | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("cafe") || normalized.includes("coffee")) return "cafe";
  if (normalized.includes("bakery")) return "bakery";
  if (normalized.includes("restaurant") || normalized.includes("bar") || normalized.includes("food")) return "restaurant";
  if (normalized.includes("store") || normalized.includes("retail")) return "retail";
  if (normalized.includes("salon") || normalized.includes("spa")) return "salon";
  if (normalized.includes("gym") || normalized.includes("fitness")) return "gym";
  if (normalized.includes("service")) return "services";
  return null;
}

export default function BusinessSetupScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { session, isInitialLoading: authLoading } = useAuthSession();
  const { confirm, confirmModal } = useBrandedConfirm();
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme];
  const primary = theme.primary;

  const [businessName, setBusinessName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [category, setCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [hoursPreset, setHoursPreset] = useState("");
  const [customHours, setCustomHours] = useState("");
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: Tone } | null>(null);
  const [searching, setSearching] = useState(false);
  const [detailsLoadingPlaceId, setDetailsLoadingPlaceId] = useState<string | null>(null);
  const [lookupResults, setLookupResults] = useState<BusinessLookupResult[] | null>(null);
  const [verifiedLookupCoords, setVerifiedLookupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [setupMode, setSetupMode] = useState<BusinessSetupMode>("loading");
  const [dirtyBaseline, setDirtyBaseline] = useState<string | null>(null);
  const [allowDiscardNavigation, setAllowDiscardNavigation] = useState(false);
  const dirtyRef = useRef(false);
  // Gap fix for the invite-code soft gate. `null` while we still don't know,
  // `true` if the user has a row in business_invite_validations (or just earned
  // one by auto-consuming the code stashed at signup), `false` if they reached
  // this screen without ever validating — in which case we render the input.
  const [inviteValidated, setInviteValidated] = useState<boolean | null>(null);
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  // FIX: Track the post-submit redirect timer so it can be cancelled on unmount.
  // Without this, the setTimeout callback fires after navigation away, causing
  // state updates on an unmounted component and potential double-navigation.
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  const confirmDiscardProfileChanges = useCallback(
    (onDiscard: () => void) => {
      confirm({
        iconName: "edit-off",
        title: t("businessSetup.unsavedTitle", { defaultValue: "Discard profile changes?" }),
        message: t("businessSetup.unsavedBody", {
          defaultValue: "You have unsaved business profile edits. Discard them and leave?",
        }),
        confirmLabel: t("dealDraft.discard", { defaultValue: "Discard" }),
        onConfirm: () => {
          dirtyRef.current = false;
          setAllowDiscardNavigation(true);
          onDiscard();
        },
        cancelLabel: t("dealDraft.keepEditing", { defaultValue: "Keep editing" }),
      });
    },
    [confirm, t],
  );

  const exitSetup = useCallback(async () => {
    if (dirtyRef.current) {
      confirmDiscardProfileChanges(() => {
        if (router.canGoBack()) {
          router.back();
          return;
        }
        if (!session?.user?.id) {
          router.replace("/auth-landing");
          return;
        }
        void signOutAndRedirectToAuthLanding({ userId: session.user.id, replace: router.replace });
      });
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (!session?.user?.id) {
      router.replace("/auth-landing");
      return;
    }
    // Hard role split: a Business account can't bail into the Shopper side.
    // With no back stack and an incomplete profile, the only clean exit is sign-out.
    await signOutAndRedirectToAuthLanding({ userId: session.user.id, replace: router.replace });
  }, [confirmDiscardProfileChanges, router, session?.user?.id]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (router.canGoBack()) return false;
      void exitSetup();
      return true;
    });
    return () => sub.remove();
  }, [exitSetup, router]);

  const trimmed = useMemo(
    () => ({
      businessName: businessName.trim(),
      address: address.trim(),
      phone: phone.trim(),
      shortDescription: shortDescription.trim(),
    }),
    [businessName, address, phone, shortDescription],
  );

  const resolvedCategory = category === "other" ? customCategory.trim() : category;
  const resolvedHours = hoursPreset === "custom_prompt" ? customHours.trim() : hoursPreset ? t(`businessSetup.hoursPreset.${hoursPreset}`) : "";
  const copyKeys = useMemo(() => getBusinessSetupCopyKeys(setupMode, busy), [setupMode, busy]);
  const currentBusinessSetupSnapshot = useMemo(
    () =>
      serializeBusinessSetupSnapshot({
        businessName,
        address,
        phone,
        shortDescription,
        category,
        customCategory,
        hoursPreset,
        customHours,
        logoUri: logoUri ?? "",
      }),
    [address, businessName, category, customCategory, customHours, hoursPreset, logoUri, phone, shortDescription],
  );
  const businessSetupDirty = Boolean(
    dirtyBaseline &&
      setupMode !== "loading" &&
      currentBusinessSetupSnapshot !== dirtyBaseline,
  );

  useEffect(() => {
    dirtyRef.current = businessSetupDirty && !allowDiscardNavigation;
  }, [allowDiscardNavigation, businessSetupDirty]);

  useEffect(() => {
    if (dirtyBaseline && currentBusinessSetupSnapshot !== dirtyBaseline && allowDiscardNavigation) {
      setAllowDiscardNavigation(false);
    }
  }, [allowDiscardNavigation, currentBusinessSetupSnapshot, dirtyBaseline]);

  usePreventRemove(
    businessSetupDirty && !allowDiscardNavigation,
    useCallback(
      ({ data }) => {
        confirmDiscardProfileChanges(() => navigation.dispatch(data.action));
      },
      [confirmDiscardProfileChanges, navigation],
    ),
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
    setSetupMode("loading");
    void (async () => {
      // Owner reads of `businesses` go through get_my_business() — an
      // `owner_id` filter stops working once the PII column-grant migration
      // lands (the helper still falls back to a direct select pre-migration).
      const { row, error } = await fetchOwnerBusiness(supabase, uid);
      if (cancelled) return;
      if (error || !row) {
        setSetupMode("create");
        setDirtyBaseline(EMPTY_BUSINESS_SETUP_SNAPSHOT);
        return;
      }
      setSetupMode("edit");
      setBusinessName((prev) => prev || (row.name ?? ""));
      setAddress((prev) => prev || (row.address ?? ""));
      setPhone((prev) => prev || (row.phone ?? ""));
      setShortDescription((prev) => prev || (row.short_description ?? ""));
      const storedCategory = row.category?.trim();
      let baselineCategory = "";
      let baselineCustomCategory = "";
      if (storedCategory) {
        const categoryKey = CATEGORY_KEYS.includes(storedCategory as CategoryKey)
          ? (storedCategory as CategoryKey)
          : categoryKeyFromLookup(storedCategory);
        baselineCategory = categoryKey || "other";
        baselineCustomCategory = categoryKey ? "" : storedCategory;
        setCategory((prev) => prev || baselineCategory);
        if (baselineCustomCategory) setCustomCategory((prev) => prev || baselineCustomCategory);
      }
      const storedHours = row.hours_text?.trim();
      let baselineHoursPreset = "";
      let baselineCustomHours = "";
      if (storedHours) {
        const presetKey = HOURS_PRESET_KEYS.find(
          (key) => key !== "custom_prompt" && t(`businessSetup.hoursPreset.${key}`) === storedHours,
        );
        baselineHoursPreset = presetKey || "custom_prompt";
        baselineCustomHours = presetKey ? "" : storedHours;
        setHoursPreset((prev) => prev || baselineHoursPreset);
        if (baselineCustomHours) setCustomHours((prev) => prev || baselineCustomHours);
      }
      const lat = row.latitude != null ? Number(row.latitude) : NaN;
      const lng = row.longitude != null ? Number(row.longitude) : NaN;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setVerifiedLookupCoords((prev) => prev ?? { lat, lng });
      }
      setDirtyBaseline(
        serializeBusinessSetupSnapshot({
          businessName: row.name ?? "",
          address: row.address ?? "",
          phone: row.phone ?? "",
          shortDescription: row.short_description ?? "",
          category: baselineCategory,
          customCategory: baselineCustomCategory,
          hoursPreset: baselineHoursPreset,
          customHours: baselineCustomHours,
          logoUri: "",
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user?.id, t]);

  // Invite-validation check. Lives separately from the business prefill so a
  // first-time user (no business row yet) still gets the right gate state.
  // If the signup stashed a code in user_metadata we try it server-side once;
  // either way, the resulting state drives whether the invite-code field is
  // rendered below.
  useEffect(() => {
    if (authLoading) return;
    const uid = session?.user?.id;
    if (!uid) return;
    let cancelled = false;
    void (async () => {
      if (await isUserInviteValidated(supabase, uid)) {
        if (!cancelled) setInviteValidated(true);
        return;
      }
      const meta = session?.user?.user_metadata as Record<string, unknown> | undefined;
      const pending = meta?.[BUSINESS_INVITE_PENDING_META_KEY];
      if (typeof pending === "string" && pending.length > 0) {
        const result = await submitBusinessInvite(supabase, pending);
        if (!cancelled && result.ok) {
          setInviteValidated(true);
          return;
        }
      }
      if (!cancelled) setInviteValidated(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user?.id, session?.user?.user_metadata]);

  async function pickLogo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setBanner({ message: t("businessSetup.errPhotoPermission", "Photo library permission is needed to upload a logo."), tone: "error" });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.65,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled && result.assets[0]) {
      setLogoUri(result.assets[0].uri);
    }
  }

  async function uploadLogo(businessId: string): Promise<string | null> {
    if (!logoUri) return null;
    setLogoUploading(true);
    try {
      const ext = logoUri.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${businessId}/logo_${Date.now()}.${ext}`;
      const response = await fetch(logoUri);
      const blob = await response.blob();
      const { error } = await supabase.storage
        .from("business-logos")
        .upload(path, blob, { contentType: `image/${ext === "png" ? "png" : "jpeg"}`, upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("business-logos").getPublicUrl(path);
      return urlData.publicUrl;
    } catch {
      setBanner({ message: t("businessSetup.errLogoUpload", "Could not upload logo. Try again."), tone: "error" });
      return null;
    } finally {
      setLogoUploading(false);
    }
  }

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

  function applyCategoryFromLookup(categoryLabel: string) {
    const key = categoryKeyFromLookup(categoryLabel);
    if (key) {
      setCategory(key);
      setCustomCategory("");
      return;
    }
    if (categoryLabel.trim()) {
      setCategory("other");
      setCustomCategory(categoryLabel.trim());
    }
  }

  async function applyLookupResult(result: BusinessLookupResult) {
    if (detailsLoadingPlaceId !== null) return;
    if (!isVerifiedBusinessLookupResult(result)) {
      setBanner({ message: t("businessSetup.unverifiedResult"), tone: "info" });
      return;
    }

    setDetailsLoadingPlaceId(result.place_id);
    setBanner(null);
    try {
      const details = await aiBusinessLookupDetails({ place_id: result.place_id });
      if (!isVerifiedBusinessLookupResult(details)) {
        setBanner({ message: t("businessSetup.unverifiedResult"), tone: "info" });
        return;
      }

      setBusinessName(details.name);
      setAddress(details.formatted_address);
      setPhone(details.phone);
      setVerifiedLookupCoords(
        details.lat != null && details.lng != null
          ? { lat: details.lat, lng: details.lng }
          : null,
      );
      applyCategoryFromLookup(details.category);
      if (details.hours_text) {
        setHoursPreset("custom_prompt");
        setCustomHours(details.hours_text);
      }
      setLookupResults(null);
      setBanner({ message: t("businessSetup.infoFilled"), tone: "success" });
    } catch (e: unknown) {
      if (__DEV__) console.warn("[business-setup] Place details error:", e);
      setBanner({ message: t("businessSetup.lookupDetailsError"), tone: "error" });
    } finally {
      setDetailsLoadingPlaceId(null);
    }
  }

  async function onSubmit() {
    if (busy) return;
    setBanner(null);
    setInviteError(null);
    if (!trimmed.businessName || !trimmed.address) {
      setBanner({ message: t("businessSetup.errNameAddress"), tone: "error" });
      return;
    }

    const uid = session?.user?.id;
    if (!uid) {
      setBanner({ message: t("createHub.errLoginBusiness"), tone: "error" });
      return;
    }

    // Gap fix: if we still don't know whether this user is invite-validated,
    // make them wait one beat instead of letting them slip through. This is
    // briefly true on first mount before the validations check resolves.
    if (inviteValidated === null) {
      setBanner({ message: t("businessSetup.errCheckingInvite", { defaultValue: "Hold on a moment…" }), tone: "info" });
      return;
    }

    setBusy(true);
    try {
      // Gap fix: a customer who switched roles to Business gets challenged
      // here, since they never went through the signup-side invite gate.
      // submitBusinessInvite re-validates the code server-side, so a forged
      // client check still can't get past the trigger on businesses.
      if (inviteValidated === false) {
        if (!isValidBusinessInviteCode(inviteCodeInput)) {
          setInviteError(
            t("businessSetup.errInviteCode", {
              defaultValue: "That invite code isn't valid. Reach out to Twofer to get one.",
            }),
          );
          setBusy(false);
          return;
        }
        const result = await submitBusinessInvite(supabase, inviteCodeInput);
        if (!result.ok) {
          setInviteError(
            t("businessSetup.errInviteCode", {
              defaultValue: "That invite code isn't valid. Reach out to Twofer to get one.",
            }),
          );
          setBusy(false);
          return;
        }
        setInviteValidated(true);
      }

      const addr = trimmed.address;
      const trialEndsIso = new Date(Date.now() + 30 * 86400000).toISOString();

      // Not an upsert on owner_id anymore: `ON CONFLICT (owner_id) DO UPDATE`
      // reads excluded.owner_id, which needs SELECT privilege on that column —
      // revoked by the PII column-grant migration. Look up the existing row via
      // get_my_business() (helper falls back pre-migration) and branch instead.
      const { row: existingBiz, error: existingErr } = await fetchOwnerBusiness(supabase, uid);
      if (existingErr) throw new Error(existingErr.message);

      const bizPayload = {
        name: trimmed.businessName,
        phone: trimmed.phone || null,
        address: addr,
        location: addr,
        short_description: trimmed.shortDescription || null,
        category: resolvedCategory || null,
        hours_text: resolvedHours || null,
        latitude: verifiedLookupCoords?.lat ?? null,
        longitude: verifiedLookupCoords?.lng ?? null,
      };
      const submitCopyKeys = getBusinessSetupCopyKeys(existingBiz ? "edit" : "create", false);
      const { data: bizData, error } = existingBiz
        ? await supabase
            .from("businesses")
            .update(bizPayload)
            .eq("id", existingBiz.id)
            .select("id")
            .single()
        : await supabase
            .from("businesses")
            .insert({ owner_id: uid, ...bizPayload })
            .select("id")
            .single();
      if (error) throw error;

      // Upload logo if picked
      if (logoUri && bizData?.id) {
        const logoUrl = await uploadLogo(bizData.id);
        if (logoUrl) {
          await supabase
            .from("businesses")
            .update({ logo_url: logoUrl })
            .eq("id", bizData.id);
        }
      }

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
        category: resolvedCategory || trimmed.businessName || null,
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
          category: resolvedCategory || trimmed.businessName || null,
          setup_completed: true,
          ...billingDefaults,
        };
        const upsertByOwner = await supabase
          .from("business_profiles")
          .upsert(profilePayloadByOwner, { onConflict: "owner_id" });
        if (upsertByOwner.error) throw upsertByOwner.error;
      }

      setBanner({ message: t(submitCopyKeys.successKey), tone: "success" });
      setDirtyBaseline(currentBusinessSetupSnapshot);
      setAllowDiscardNavigation(true);
      dirtyRef.current = false;
      redirectTimerRef.current = setTimeout(async () => {
        const pending = await consumePendingDeepLink();
        router.replace((pending ?? "/(tabs)/dashboard") as Href);
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
        message: friendly && friendly !== raw ? friendly : t(copyKeys.errorKey),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardScreen>
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, backgroundColor: theme.background }}>
      {/* The stack header back arrow covers navigation when there is a back
          stack. Fresh signups land here with NO back stack (no header arrow),
          and exitSetup()'s only clean exit is sign-out — keep the pill for
          that case only. */}
      {!router.canGoBack() ? (
        <Pressable
          onPress={() => void exitSetup()}
          accessibilityRole="button"
          accessibilityLabel={t("commonUi.goBack", { defaultValue: "Back" })}
          style={{
            alignSelf: "flex-start",
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: Spacing.xs,
            borderRadius: Radii.pill,
            backgroundColor: theme.surfaceMuted,
            paddingHorizontal: Spacing.sm,
            marginBottom: Spacing.sm,
          }}
        >
          <MaterialIcons name="arrow-back" size={20} color={theme.text} />
          <Text style={{ color: theme.text, fontWeight: "800" }}>
            {t("commonUi.goBack", { defaultValue: "Back" })}
          </Text>
        </Pressable>
      ) : null}
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3, color: theme.text }}>{t(copyKeys.titleKey)}</Text>
      <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, opacity: 0.72, fontSize: 15, lineHeight: 22, color: theme.text }}>
        {t(copyKeys.subtitleKey)}
      </Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.md }}
        {...FORM_SCROLL_KEYBOARD_PROPS}
        showsVerticalScrollIndicator={false}
      >
        {inviteValidated === false ? (
          <View
            style={{
              backgroundColor: "rgba(255,159,28,0.08)",
              borderRadius: Radii.lg,
              borderWidth: 1,
              borderColor: theme.primary,
              padding: Spacing.md,
              gap: Spacing.sm,
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 15, color: theme.text }}>
              {t("businessSetup.inviteCodeLabel", { defaultValue: "Business invite code" })}
            </Text>
            <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.75, color: theme.text }}>
              {t("businessSetup.inviteCodeHint", {
                defaultValue:
                  "Twofer is invite-only for business accounts during the pilot. Enter the code we shared with you to continue.",
              })}
            </Text>
            <TextInput
              value={inviteCodeInput}
              onChangeText={(v) => {
                setInviteCodeInput(v);
                if (inviteError) setInviteError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t("businessSetup.inviteCodePlaceholder", {
                defaultValue: "Enter the code Twofer gave you",
              })}
              placeholderTextColor={theme.mutedText}
              style={{
                borderWidth: 1,
                borderColor: inviteError ? theme.danger : theme.border,
                borderRadius: Radii.md,
                backgroundColor: theme.surface,
                color: theme.text,
                paddingVertical: Spacing.sm,
                paddingHorizontal: Spacing.md,
                fontSize: 16,
              }}
            />
            {inviteError ? (
              <Text style={{ fontSize: 13, color: theme.danger }}>{inviteError}</Text>
            ) : null}
          </View>
        ) : null}

        {/* Logo upload */}
        <View style={{ alignItems: "center", marginBottom: Spacing.xs }}>
          <Pressable onPress={pickLogo} style={{ alignItems: "center" }}>
            {logoUri ? (
              <Image
                source={{ uri: logoUri }}
                style={{ width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: primary }}
              />
            ) : (
              <View
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: 44,
                  borderWidth: 2,
                  borderColor: theme.border,
                  borderStyle: "dashed",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.surface,
                }}
              >
                {logoUploading ? (
                  <ActivityIndicator color={primary} />
                ) : (
                  <Text style={{ fontSize: 28, opacity: 0.4 }}>+</Text>
                )}
              </View>
            )}
            <Text style={{ marginTop: Spacing.xs, fontSize: 13, opacity: 0.6, color: theme.text }}>
              {t("businessSetup.logoUploadHint", "Add a logo")}
            </Text>
          </Pressable>
        </View>

        <Field
          label={t("businessSetup.businessName")}
          value={businessName}
          onChangeText={(s) => {
            setBusinessName(s);
            setLookupResults(null);
          }}
          theme={theme}
        />

        <SecondaryButton
          title={searching ? t("businessSetup.searching") : t("businessSetup.lookupButton")}
          onPress={() => void onLookup()}
          disabled={searching || detailsLoadingPlaceId !== null || !businessName.trim()}
        />

        {searching && (
          <View style={{ alignItems: "center", paddingVertical: Spacing.sm }}>
            <ActivityIndicator color={theme.primary} />
          </View>
        )}

        {lookupResults && lookupResults.length > 0 && (
          <View style={{ gap: Spacing.sm }}>
            <Text style={{ fontSize: 13, fontWeight: "600", opacity: 0.6 }}>
              {t("businessSetup.selectResult")}
            </Text>
            {lookupResults.map((r, i) => (
              <Pressable key={r.place_id || i} onPress={() => void applyLookupResult(r)}>
                <View
                  style={{
                    backgroundColor: theme.surface,
                    borderRadius: Radii.lg,
                    padding: Spacing.md,
                    borderWidth: 1,
                    borderColor: theme.border,
                    ...Shadows.soft,
                  }}
                >
                  <Text style={{ fontWeight: "700", fontSize: 15, color: theme.text }}>{r.name}</Text>
                  <Text style={{ fontSize: 13, opacity: 0.7, marginTop: 2, color: theme.text }}>{r.formatted_address}</Text>
                  {r.phone ? <Text style={{ fontSize: 13, opacity: 0.6, marginTop: 2, color: theme.text }}>{r.phone}</Text> : null}
                  {r.category ? <Text style={{ fontSize: 12, opacity: 0.5, marginTop: 2, color: theme.text }}>{r.category}</Text> : null}
                  <Text style={{ fontSize: 11, color: theme.accentText, marginTop: 4 }}>
                    {t("businessSetup.verifiedSource")}
                  </Text>
                  {detailsLoadingPlaceId === r.place_id ? (
                    <ActivityIndicator color={theme.primary} style={{ marginTop: Spacing.xs }} />
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <Field
          label={t("businessSetup.address")}
          value={address}
          onChangeText={(s) => {
            setAddress(s);
            setVerifiedLookupCoords(null);
          }}
          theme={theme}
        />
        <Field label={t("businessSetup.phone")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" theme={theme} />
        <Field
          label={t("businessSetup.shortDescription")}
          value={shortDescription}
          onChangeText={setShortDescription}
          multiline
          placeholder={t("businessSetup.shortDescriptionPh")}
          theme={theme}
        />

        {/* Category picker */}
        <View>
          <Text style={{ fontWeight: "700", marginBottom: 6, color: theme.text }}>{t("businessSetup.categoryLabel")}</Text>
          {!category ? (
            <Text style={{ marginBottom: Spacing.xs, color: theme.mutedText, fontSize: 13, lineHeight: 18 }}>
              {t("businessSetup.categoryUnset", { defaultValue: "Choose one" })}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs }}>
            {CATEGORY_KEYS.map((key) => {
              const active = category === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setCategory(active ? "" : key)}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 14,
                    borderRadius: Radii.pill,
                    backgroundColor: active ? primary : theme.surfaceMuted,
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: active ? "800" : "600", color: active ? theme.primaryText : theme.text }}>
                    {t(`businessSetup.cat.${key}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {category === "other" ? (
            <TextInput
              value={customCategory}
              onChangeText={setCustomCategory}
              placeholder={t("businessSetup.categoryOtherPh")}
              placeholderTextColor={theme.icon}
              style={{
                marginTop: Spacing.sm,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: Radii.lg,
                backgroundColor: theme.surface,
                paddingVertical: Spacing.sm,
                paddingHorizontal: Spacing.md,
                fontSize: 16,
                color: theme.text,
              }}
            />
          ) : null}
        </View>

        {/* Hours picker */}
        <View>
          <Text style={{ fontWeight: "700", marginBottom: 6, color: theme.text }}>{t("businessSetup.hoursLabel")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs }}>
            {HOURS_PRESET_KEYS.map((key) => {
              const active = hoursPreset === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setHoursPreset(active ? "" : key)}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 14,
                    borderRadius: Radii.pill,
                    backgroundColor: active ? primary : theme.surfaceMuted,
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: active ? "800" : "600", color: active ? theme.primaryText : theme.text }}>
                    {t(`businessSetup.hoursPreset.${key}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {hoursPreset === "custom_prompt" ? (
            <TextInput
              value={customHours}
              onChangeText={setCustomHours}
              placeholder={t("businessSetup.hoursCustomPh")}
              placeholderTextColor={theme.icon}
              multiline
              style={{
                marginTop: Spacing.sm,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: Radii.lg,
                backgroundColor: theme.surface,
                paddingVertical: Spacing.sm,
                paddingHorizontal: Spacing.md,
                fontSize: 16,
                color: theme.text,
                minHeight: 60,
                textAlignVertical: "top",
              }}
            />
          ) : null}
        </View>

        <View style={{ gap: Spacing.sm }}>
          <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.68, color: theme.text }}>{t(copyKeys.legalHintKey)}</Text>
          <LegalExternalLinks />
        </View>

        <PrimaryButton
          title={t(copyKeys.submitKey)}
          onPress={() => void onSubmit()}
          disabled={busy || logoUploading || setupMode === "loading"}
        />
      </ScrollView>
      {confirmModal}
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
  theme,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "words";
  multiline?: boolean;
  placeholder?: string;
  theme: typeof Colors.light;
}) {
  return (
    <View>
      <Text style={{ fontWeight: "700", marginBottom: 6, color: theme.text }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "words"}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={theme.icon}
        style={{
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: Radii.lg,
          backgroundColor: theme.surface,
          paddingVertical: Spacing.sm,
          paddingHorizontal: Spacing.md,
          fontSize: 16,
          color: theme.text,
          minHeight: multiline ? 92 : undefined,
          textAlignVertical: multiline ? "top" : "auto",
        }}
      />
    </View>
  );
}
