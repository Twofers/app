import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Image, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import * as ImagePicker from "expo-image-picker";
import { File as ExpoFsFile, Paths } from "expo-file-system";

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
import {
  aiBusinessLookup,
  aiBusinessLookupDetails,
  getBusinessOnboardingContext,
  updateBusinessProfileSection,
  type BusinessLookupResult,
  type BusinessOnboardingContext,
} from "@/lib/functions";
import { isVerifiedBusinessLookupResult } from "@/lib/business-lookup";
import { isBusinessNameLocked } from "@/lib/business-name-change";
import { BusinessNameChangeCard } from "@/components/business-name-change-request";
import { isSiteImportEnabled } from "@/lib/runtime-env";
import {
  importBusinessWebsite,
  SiteImportError,
  type SiteImportMenuItem,
  type SiteImportResult,
} from "@/lib/business-site-import";
import { splitMenuItemDescription } from "@/lib/menu-item-text";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";
import { signOutAndRedirectToAuthLanding } from "@/lib/auth-app-sign-out";

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
  const params = useLocalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { session, isInitialLoading: authLoading } = useAuthSession();
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
  // Already-saved logo (remote public URL) shown in the circle on return so the
  // owner sees their logo persisted. Display-only: uploadLogo runs off logoUri.
  const [existingLogoUrl, setExistingLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone: Tone } | null>(null);
  const [searching, setSearching] = useState(false);
  const [detailsLoadingPlaceId, setDetailsLoadingPlaceId] = useState<string | null>(null);
  const [lookupResults, setLookupResults] = useState<BusinessLookupResult[] | null>(null);
  const [verifiedLookupCoords, setVerifiedLookupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [setupMode, setSetupMode] = useState<BusinessSetupMode>("loading");
  const [onboardingContext, setOnboardingContext] = useState<BusinessOnboardingContext | null>(null);
  // Existing business id + lifecycle status (from either prefill path). Once
  // the business is publicly visible the name is locked server-side
  // (migration 20260816120000); the UI mirrors that with a read-only field +
  // the name change request card.
  const [existingBusinessId, setExistingBusinessId] = useState<string | null>(null);
  const [businessStatus, setBusinessStatus] = useState<string | null>(null);
  const [importedFromWebsite, setImportedFromWebsite] = useState(false);
  // Website-import (flag-gated). `websiteUrl` is populated by applyLookupResult
  // from the verified Google Places result; the card only shows once it's set.
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [siteImport, setSiteImport] = useState<null | "loading" | SiteImportResult | "error">(null);
  const [siteImportError, setSiteImportError] = useState<string | null>(null);
  const [selectedLogoCandidate, setSelectedLogoCandidate] = useState<number | null>(null);
  const [importItems, setImportItems] = useState<SiteImportMenuItem[]>([]);
  const [importConsent, setImportConsent] = useState(false);
  const [logoFromImport, setLogoFromImport] = useState(false);
  // Shown inline when someone taps an imported logo before checking the
  // copyright-consent box — otherwise the tap is a silent no-op.
  const [showLogoConsentHint, setShowLogoConsentHint] = useState(false);
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

  const exitSetup = useCallback(async () => {
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
  }, [router, session?.user?.id]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      void exitSetup();
      return true;
    });
    return () => sub.remove();
  }, [exitSetup]);

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
  const setupBypass = useMemo(
    () =>
      isAuthBypassEnabled({
        skipSetup: String(params.skipSetup ?? ""),
        e2e: String(params.e2e ?? ""),
        isDev: __DEV__,
      }),
    [params.skipSetup, params.e2e],
  );
  const nameLocked = isBusinessNameLocked(businessStatus);

  useEffect(() => {
    if (authLoading) return;
    if (!setupBypass && !session?.user?.id) router.replace("/auth-landing");
  }, [router, setupBypass, session?.user?.id, authLoading]);

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
      try {
        const context = await getBusinessOnboardingContext();
        if (cancelled) return;
        setOnboardingContext(context);
        if (context.business) {
          const row = context.business;
          setSetupMode("edit");
          setExistingBusinessId(row.id);
          setBusinessStatus(row.status ?? null);
          setImportedFromWebsite(
            Boolean(context.field_sources?.some((source) => source.source === "website_signup" || source.source === "app_login")),
          );
          setExistingLogoUrl((prev) => prev ?? (row.logo_url ?? null));
          setBusinessName((prev) => prev || (row.name ?? ""));
          setAddress((prev) => prev || (row.address ?? row.location ?? ""));
          setPhone((prev) => prev || (row.phone ?? ""));
          setShortDescription((prev) => prev || (row.short_description ?? ""));
          const storedCategory = row.category?.trim();
          if (storedCategory) {
            const categoryKey = CATEGORY_KEYS.includes(storedCategory as CategoryKey)
              ? (storedCategory as CategoryKey)
              : categoryKeyFromLookup(storedCategory);
            setCategory((prev) => prev || categoryKey || "other");
            if (!categoryKey) setCustomCategory((prev) => prev || storedCategory);
          }
          const importedSlowHours = context.slow_hours?.[0]?.raw_text;
          const storedHours = row.hours_text?.trim() || (typeof importedSlowHours === "string" ? importedSlowHours.trim() : "");
          if (storedHours) {
            const presetKey = HOURS_PRESET_KEYS.find(
              (key) => key !== "custom_prompt" && t(`businessSetup.hoursPreset.${key}`) === storedHours,
            );
            setHoursPreset((prev) => prev || presetKey || "custom_prompt");
            if (!presetKey) setCustomHours((prev) => prev || storedHours);
          }
          const lat = row.latitude != null ? Number(row.latitude) : NaN;
          const lng = row.longitude != null ? Number(row.longitude) : NaN;
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            setVerifiedLookupCoords((prev) => prev ?? { lat, lng });
          }
          return;
        }
      } catch (e) {
        if (__DEV__) console.warn("[business-setup] Onboarding context error:", e);
      }
      // Owner reads of `businesses` go through get_my_business() — an
      // `owner_id` filter stops working once the PII column-grant migration
      // lands (the helper still falls back to a direct select pre-migration).
      const { row, error } = await fetchOwnerBusiness(supabase, uid);
      if (cancelled) return;
      if (error || !row) {
        setSetupMode("create");
        return;
      }
      setSetupMode("edit");
      setExistingBusinessId(row.id);
      setBusinessStatus(row.status ?? null);
      setExistingLogoUrl((prev) => prev ?? (row.logo_url ?? null));
      setBusinessName((prev) => prev || (row.name ?? ""));
      setAddress((prev) => prev || (row.address ?? ""));
      setPhone((prev) => prev || (row.phone ?? ""));
      setShortDescription((prev) => prev || (row.short_description ?? ""));
      const storedCategory = row.category?.trim();
      if (storedCategory) {
        const categoryKey = CATEGORY_KEYS.includes(storedCategory as CategoryKey)
          ? (storedCategory as CategoryKey)
          : categoryKeyFromLookup(storedCategory);
        setCategory((prev) => prev || categoryKey || "other");
        if (!categoryKey) setCustomCategory((prev) => prev || storedCategory);
      }
      const storedHours = row.hours_text?.trim();
      if (storedHours) {
        const presetKey = HOURS_PRESET_KEYS.find(
          (key) => key !== "custom_prompt" && t(`businessSetup.hoursPreset.${key}`) === storedHours,
        );
        setHoursPreset((prev) => prev || presetKey || "custom_prompt");
        if (!presetKey) setCustomHours((prev) => prev || storedHours);
      }
      const lat = row.latitude != null ? Number(row.latitude) : NaN;
      const lng = row.longitude != null ? Number(row.longitude) : NaN;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setVerifiedLookupCoords((prev) => prev ?? { lat, lng });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user?.id, t]);

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
      // A manual upload wins over any imported logo candidate.
      setLogoUri(result.assets[0].uri);
      setLogoFromImport(false);
      setSelectedLogoCandidate(null);
    }
  }

  // Clear all website-import review state (new lookup, skip, or consent revoked).
  const resetSiteImport = useCallback(() => {
    setSiteImport(null);
    setSiteImportError(null);
    setSelectedLogoCandidate(null);
    setImportItems([]);
    setImportConsent(false);
    setShowLogoConsentHint(false);
    setLogoFromImport((wasImport) => {
      if (wasImport) setLogoUri(null);
      return false;
    });
  }, []);

  async function onImportWebsite() {
    if (!websiteUrl) return;
    setSiteImport("loading");
    setSiteImportError(null);
    setSelectedLogoCandidate(null);
    setImportConsent(false);
    setShowLogoConsentHint(false);
    try {
      const result = await importBusinessWebsite({
        website_url: websiteUrl,
        business_id: onboardingContext?.business?.id,
      });
      setSiteImport(result);
      setImportItems(result.menu?.items ?? []);
    } catch (e: unknown) {
      if (__DEV__) console.warn("[business-setup] Website import error:", e);
      const code = e instanceof SiteImportError ? e.code : "SERVER";
      setSiteImport("error");
      setSiteImportError(
        code === "RATE_LIMITED"
          ? t("businessSetup.import.rateLimited")
          : t("businessSetup.import.failGeneric"),
      );
    }
  }

  function mimeToExt(mime: string): string {
    if (/png/i.test(mime)) return "png";
    if (/webp/i.test(mime)) return "webp";
    if (/gif/i.test(mime)) return "gif";
    return "jpg";
  }

  // Selecting a candidate applies it to the same `logoUri` the manual upload
  // path uses (via a cache file), so uploadLogo() works unchanged. Gated on
  // consent — the copyright confirmation must be checked first.
  function selectLogoCandidate(index: number) {
    if (!importConsent) {
      // Legal gate stays closed, but tell the user why nothing happened.
      setShowLogoConsentHint(true);
      return;
    }
    const result = siteImport;
    if (!result || typeof result === "string") return;
    if (selectedLogoCandidate === index) {
      setSelectedLogoCandidate(null);
      setLogoUri(null);
      setLogoFromImport(false);
      return;
    }
    const candidate = result.logo_candidates[index];
    if (!candidate) return;
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(candidate.data_uri);
    if (!match) return;
    try {
      // expo-file-system SDK 54 File API (the legacy writeAsStringAsync/cacheDirectory
      // throws at runtime). Write the base64 payload to a cache file, then feed the
      // resulting file:// URI through the existing logoUri → uploadLogo() path unchanged.
      const file = new ExpoFsFile(Paths.cache, `import-logo-${Date.now()}.${mimeToExt(match[1])}`);
      file.create({ overwrite: true, intermediates: true });
      file.write(match[2], { encoding: "base64" });
      setLogoUri(file.uri);
      setLogoFromImport(true);
      setSelectedLogoCandidate(index);
    } catch (e) {
      if (__DEV__) console.warn("[business-setup] Import logo cache write failed:", e);
      setBanner({ message: t("businessSetup.errLogoUpload"), tone: "error" });
    }
  }

  function toggleImportConsent() {
    setImportConsent((prev) => {
      const next = !prev;
      // Revoking consent unwinds any imported logo (menu is gated at submit).
      if (!next && logoFromImport) {
        setLogoUri(null);
        setLogoFromImport(false);
        setSelectedLogoCandidate(null);
      }
      return next;
    });
  }

  function removeImportItem(index: number) {
    setImportItems((prev) => prev.filter((_, i) => i !== index));
  }

  const scheduleDashboardRedirect = useCallback(
    (delayMs: number) => {
      redirectTimerRef.current = setTimeout(async () => {
        const pending = await consumePendingDeepLink();
        router.replace((pending ?? "/(tabs)/dashboard") as Href);
      }, delayMs);
    },
    [router],
  );

  // Persist kept menu items after the business row exists. Best-effort: never
  // blocks the business save. Deduped against the existing library by name.
  async function saveImportedMenuItems(businessId: string): Promise<boolean> {
    if (!importConsent || importItems.length === 0) return true;
    try {
      const { data: existing } = await supabase
        .from("business_menu_items")
        .select("name")
        .eq("business_id", businessId);
      // Legacy library rows may still carry "Name ( long description )" — dedupe
      // on the split short name so a re-import doesn't duplicate those items.
      const nameKey = (value: string) => splitMenuItemDescription(value).name.toLowerCase();
      const existingNames = new Set(
        (existing ?? [])
          .map((r) => (typeof (r as { name?: unknown }).name === "string" ? nameKey((r as { name: string }).name) : ""))
          .filter(Boolean),
      );
      const toInsert = importItems.filter((r) => !existingNames.has(nameKey(r.name)));
      if (toInsert.length === 0) return true;
      const payload = toInsert.map((r, i) => ({
        business_id: businessId,
        name: r.name,
        description: r.description?.trim() || null,
        category: r.category?.trim() || null,
        price_text: r.price_text?.trim() || null,
        size_options: r.size_options.length > 0 ? r.size_options : null,
        sort_order: i,
        source: "import" as const,
      }));
      const { error } = await supabase.from("business_menu_items").insert(payload);
      if (error) throw error;
      return true;
    } catch (e) {
      if (__DEV__) console.warn("[business-setup] Import menu save failed:", e);
      return false;
    }
  }

  async function uploadLogo(businessId: string): Promise<string | null> {
    if (!logoUri) return null;
    setLogoUploading(true);
    try {
      const rawExt = logoUri.split(".").pop()?.toLowerCase() ?? "jpg";
      const ext = rawExt === "png" ? "png" : rawExt === "webp" ? "webp" : rawExt === "gif" ? "gif" : "jpg";
      const mime =
        ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
      const path = `${businessId}/logo_${Date.now()}.${ext}`;
      // fetch(file://).blob() returns an empty body on native RN, so the logo
      // uploaded as a 0-byte object and never showed on the profile. Read the
      // file as base64 and upload raw bytes instead — mirrors the proven path
      // in lib/upload-deal-photo.ts. Web still uses fetch/blob.
      let body: Blob | ArrayBuffer;
      if (Platform.OS === "web") {
        const response = await fetch(logoUri);
        body = await response.blob();
      } else {
        const b64 = await new ExpoFsFile(logoUri).base64();
        const raw = atob(b64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        body = bytes.buffer;
      }
      const { error } = await supabase.storage
        .from("business-logos")
        .upload(path, body, { contentType: mime, upsert: true });
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
      // Enable the (flag-gated) website-import card and clear any prior import.
      resetSiteImport();
      setWebsiteUrl(details.website ?? "");
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

      // Not an upsert on owner_id anymore: `ON CONFLICT (owner_id) DO UPDATE`
      // reads excluded.owner_id, which needs SELECT privilege on that column —
      // revoked by the PII column-grant migration. Look up the existing row via
      // get_my_business() (helper falls back pre-migration) and branch instead.
      const { row: existingBiz, error: existingErr } = await fetchOwnerBusiness(supabase, uid);
      if (existingErr) throw new Error(existingErr.message);
      if (!setupBypass && !existingBiz && !onboardingContext?.business) {
        setBanner({ message: t("businessSetup.approvalRequired"), tone: "info" });
        return;
      }

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
      const submitCopyKeys = getBusinessSetupCopyKeys(existingBiz || onboardingContext?.business ? "edit" : "create", false);
      if (onboardingContext?.business) {
        await updateBusinessProfileSection({
          business_id: onboardingContext.business.id,
          section_key: "business_setup",
          profile_version: Number(onboardingContext.business.current_profile_version ?? 1),
          payload: bizPayload,
        });
        if (logoUri) {
          const logoUrl = await uploadLogo(onboardingContext.business.id);
          if (logoUrl) {
            await supabase
              .from("businesses")
              .update({ logo_url: logoUrl })
              .eq("id", onboardingContext.business.id);
          }
        }
        const menuSaveOk = await saveImportedMenuItems(onboardingContext.business.id);
        if (menuSaveOk) {
          setBanner({ message: t(submitCopyKeys.successKey), tone: "success" });
          scheduleDashboardRedirect(250);
        } else {
          setBanner({ message: t("businessSetup.import.menuSaveFailed"), tone: "error" });
          scheduleDashboardRedirect(1500);
        }
        return;
      }
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

      const profilePayloadByUser = {
        user_id: uid,
        name: trimmed.businessName,
        address: addr,
        category: resolvedCategory || trimmed.businessName || null,
        setup_completed: true,
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
        };
        const upsertByOwner = await supabase
          .from("business_profiles")
          .upsert(profilePayloadByOwner, { onConflict: "owner_id" });
        if (upsertByOwner.error) throw upsertByOwner.error;
      }

      const savedBizId = existingBiz?.id ?? bizData?.id;
      const menuSaveOk = savedBizId ? await saveImportedMenuItems(savedBizId) : true;
      if (menuSaveOk) {
        setBanner({ message: t(submitCopyKeys.successKey), tone: "success" });
        scheduleDashboardRedirect(250);
      } else {
        setBanner({ message: t("businessSetup.import.menuSaveFailed"), tone: "error" });
        scheduleDashboardRedirect(1500);
      }
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

  // Circle preview: a freshly picked/imported logo (local file) wins; otherwise
  // fall back to the already-saved logo so returning owners see it persisted.
  const shownLogoUri = logoUri ?? existingLogoUrl;

  const siteImportResult: SiteImportResult | null =
    siteImport && typeof siteImport === "object" ? siteImport : null;
  const siteImportEmpty =
    siteImportResult != null &&
    siteImportResult.logo_candidates.length === 0 &&
    importItems.length === 0 &&
    (!siteImportResult.menu || siteImportResult.menu.items.length === 0);

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
      {importedFromWebsite ? (
        <Text style={{ marginTop: -Spacing.sm, marginBottom: Spacing.md, opacity: 0.72, fontSize: 13, lineHeight: 18, color: theme.text }}>
          {t("businessSetup.importedWebsiteHint")}
        </Text>
      ) : null}
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: scrollBottom, gap: Spacing.md }}
        {...FORM_SCROLL_KEYBOARD_PROPS}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo upload */}
        <View style={{ alignItems: "center", marginBottom: Spacing.xs }}>
          <Pressable onPress={pickLogo} style={{ alignItems: "center" }}>
            {shownLogoUri ? (
              <Image
                source={{ uri: shownLogoUri }}
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
                  <Text style={{ fontSize: 28, opacity: 0.4, color: theme.text }}>+</Text>
                )}
              </View>
            )}
            <Text style={{ marginTop: Spacing.xs, fontSize: 13, opacity: 0.6, color: theme.text }}>
              {t("businessSetup.logoUploadHint", "Tap to upload your logo")}
            </Text>
          </Pressable>
        </View>

        {nameLocked ? (
          <View>
            <Text style={{ fontWeight: "700", marginBottom: 6, color: theme.text }}>
              {t("businessSetup.businessName")}
            </Text>
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: Radii.lg,
                backgroundColor: theme.surfaceMuted ?? theme.surface,
                paddingVertical: Spacing.sm,
                paddingHorizontal: Spacing.md,
              }}
            >
              <Text style={{ fontSize: 16, color: theme.text }}>{businessName}</Text>
            </View>
            <Text style={{ marginTop: 6, fontSize: 12, opacity: 0.6, color: theme.text }}>
              {t("businessSetup.nameChange.lockedHint")}
            </Text>
          </View>
        ) : (
          <Field
            label={t("businessSetup.businessName")}
            value={businessName}
            onChangeText={(s) => {
              setBusinessName(s);
              setLookupResults(null);
              // Editing the name invalidates a prior verified match + its import.
              if (websiteUrl) setWebsiteUrl("");
              resetSiteImport();
            }}
            theme={theme}
          />
        )}

        {nameLocked && existingBusinessId && session?.user?.id ? (
          <BusinessNameChangeCard
            businessId={existingBusinessId}
            userId={session.user.id}
            currentName={businessName || null}
          />
        ) : null}

        {!nameLocked && (
          <SecondaryButton
            title={searching ? t("businessSetup.searching") : t("businessSetup.lookupButton")}
            onPress={() => void onLookup()}
            disabled={searching || detailsLoadingPlaceId !== null || !businessName.trim()}
          />
        )}

        {searching && (
          <View style={{ alignItems: "center", paddingVertical: Spacing.sm }}>
            <ActivityIndicator color={theme.primary} />
          </View>
        )}

        {lookupResults && lookupResults.length > 0 && (
          <View style={{ gap: Spacing.sm }}>
            <Text style={{ fontSize: 13, fontWeight: "600", opacity: 0.6, color: theme.text }}>
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

        {isSiteImportEnabled() && websiteUrl ? (
          <View
            style={{
              backgroundColor: theme.surface,
              borderRadius: Radii.lg,
              borderWidth: 1,
              borderColor: theme.border,
              padding: Spacing.md,
              gap: Spacing.sm,
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 15, color: theme.text }}>
              {t("businessSetup.import.title")}
            </Text>

            {siteImport === null ? (
              <>
                <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.7, color: theme.text }}>
                  {t("businessSetup.import.hint")}
                </Text>
                <SecondaryButton
                  title={t("businessSetup.import.scanButton")}
                  onPress={() => void onImportWebsite()}
                />
              </>
            ) : null}

            {siteImport === "loading" ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: Spacing.sm,
                  paddingVertical: Spacing.xs,
                }}
              >
                <ActivityIndicator color={theme.primary} />
                <Text style={{ flex: 1, fontSize: 13, color: theme.text }}>
                  {t("businessSetup.import.loading")}
                </Text>
              </View>
            ) : null}

            {siteImport === "error" ? (
              <>
                <Text style={{ fontSize: 13, lineHeight: 18, color: theme.danger }}>
                  {siteImportError}
                </Text>
                <SecondaryButton
                  title={t("businessSetup.import.scanButton")}
                  onPress={() => void onImportWebsite()}
                />
              </>
            ) : null}

            {siteImportResult ? (
              <View style={{ gap: Spacing.sm }}>
                {/* Copyright consent gate — must be checked before importing content. */}
                <Pressable
                  onPress={toggleImportConsent}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: importConsent }}
                  style={{ flexDirection: "row", alignItems: "flex-start", gap: Spacing.xs }}
                >
                  <MaterialIcons
                    name={importConsent ? "check-box" : "check-box-outline-blank"}
                    size={22}
                    color={importConsent ? theme.primary : theme.icon}
                  />
                  <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: theme.text }}>
                    {t("businessSetup.import.consent")}
                  </Text>
                </Pressable>

                {siteImportResult.logo_candidates.length > 0 ? (
                  <View style={{ gap: Spacing.xs }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: theme.text }}>
                      {t("businessSetup.import.logoHeader")}
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, opacity: importConsent ? 1 : 0.4 }}>
                      {siteImportResult.logo_candidates.map((c, i) => {
                        const active = selectedLogoCandidate === i;
                        return (
                          <Pressable
                            key={i}
                            onPress={() => void selectLogoCandidate(i)}
                            accessibilityRole="button"
                            accessibilityLabel={t("businessSetup.import.logoHeader")}
                            accessibilityState={{ selected: active }}
                          >
                            <Image
                              source={{ uri: c.data_uri }}
                              style={{
                                width: 56,
                                height: 56,
                                borderRadius: Radii.md,
                                borderWidth: active ? 3 : 1,
                                borderColor: active ? theme.primary : theme.border,
                                backgroundColor: theme.surfaceMuted,
                              }}
                            />
                          </Pressable>
                        );
                      })}
                    </View>
                    {!importConsent && showLogoConsentHint ? (
                      <Text style={{ fontSize: 12, fontWeight: "700", color: theme.primary }}>
                        {t("businessSetup.import.logoConsentHint")}
                      </Text>
                    ) : null}
                    {importConsent && logoFromImport && selectedLogoCandidate !== null ? (
                      <Text style={{ fontSize: 12, fontWeight: "700", color: theme.primary }}>
                        {t("businessSetup.import.logoApplied")}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {importItems.length > 0 ? (
                  <View style={{ gap: Spacing.xs }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: theme.text }}>
                      {t("businessSetup.import.menuHeader")}
                    </Text>
                    {importItems.map((item, i) => (
                      <View
                        key={`${item.name}-${i}`}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: Spacing.sm,
                          backgroundColor: theme.surfaceMuted,
                          borderRadius: Radii.md,
                          paddingVertical: Spacing.xs,
                          paddingHorizontal: Spacing.sm,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, color: theme.text }} numberOfLines={1}>
                            {item.name}
                          </Text>
                          {item.description ? (
                            <Text style={{ fontSize: 12, opacity: 0.6, color: theme.text }} numberOfLines={1}>
                              {item.description}
                            </Text>
                          ) : null}
                          {item.price_text ? (
                            <Text style={{ fontSize: 12, opacity: 0.6, color: theme.text }}>
                              {item.price_text}
                            </Text>
                          ) : null}
                        </View>
                        <Pressable
                          onPress={() => removeImportItem(i)}
                          accessibilityRole="button"
                          accessibilityLabel={t("businessSetup.import.removeItem")}
                          hitSlop={8}
                          style={{
                            minWidth: 32,
                            minHeight: 32,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <MaterialIcons name="close" size={18} color={theme.icon} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}

                {!siteImportResult.menu ? (
                  siteImportResult.warnings.includes("MENU_EXTRACTION_FAILED") ||
                  siteImportResult.warnings.includes("MENU_BUSY") ? (
                    // Transient read failure (provider blip / circuit open) — the
                    // menu is likely there, so offer a one-tap re-scan.
                    <View style={{ gap: Spacing.xs }}>
                      <Text style={{ fontSize: 12, opacity: 0.7, color: theme.text }}>
                        {siteImportResult.warnings.includes("MENU_BUSY")
                          ? t("businessSetup.import.menuBusy")
                          : t("businessSetup.import.menuRetryNotice")}
                      </Text>
                      <SecondaryButton
                        title={t("businessSetup.import.menuRetryButton")}
                        onPress={() => void onImportWebsite()}
                      />
                    </View>
                  ) : (
                    <Text style={{ fontSize: 12, opacity: 0.7, color: theme.text }}>
                      {siteImportResult.warnings.includes("MENU_PDF_ONLY")
                        ? t("businessSetup.import.menuPdf")
                        : t("businessSetup.import.menuNotFound")}
                    </Text>
                  )
                ) : null}

                {siteImportEmpty ? (
                  <Text style={{ fontSize: 12, opacity: 0.7, color: theme.text }}>
                    {t("businessSetup.import.nothingFound")}
                  </Text>
                ) : null}

                <SecondaryButton
                  title={t("businessSetup.import.skip")}
                  onPress={resetSiteImport}
                />
              </View>
            ) : null}
          </View>
        ) : null}

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
