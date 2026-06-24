import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, BackHandler, Linking, Platform, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors, Radii, Shadows } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { formatValiditySummary, isDealActiveNow } from "@/lib/deal-time";
import { Banner } from "@/components/ui/banner";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { PrimaryButton } from "@/components/ui/primary-button";
import { useBusiness } from "@/hooks/use-business";
import { DealStatusPill } from "@/components/deal-status-pill";
import { resolveDealPosterDisplayUri } from "@/lib/deal-poster-url";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getCustomerPreferredDealLocale, getDeviceDealLocale } from "@/lib/customer-deal-locale-storage";
import {
  fetchCustomerDealLocalizations,
  type CustomerDealLocalization,
} from "@/lib/customer-deal-localizations";
import { buildLocalizedDealDisplay, resolveDealDisplayLocale } from "@/lib/localized-deal-display";
import {
  DEAL_STRUCTURED_DISPLAY_COLUMNS,
  isMissingStructuredDisplayColumnError,
  type DealStructuredDisplayFields,
} from "@/lib/deal-feed-schema";
import { DemoOfferNotice } from "@/components/demo-offer-notice";
import {
  isAiV5CustomerLocaleResolutionEnabled,
  isAiV5LocalizedOfferRendererEnabled,
} from "@/lib/runtime-env";
import { supportedLocaleOrDefault } from "@/lib/supported-locales";

type BizRow = {
  id: string;
  name: string;
  address: string | null;
  location: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  phone: string | null;
  hours_text: string | null;
  short_description: string | null;
  logo_url: string | null;
  is_demo?: boolean | null;
};

type DealRow = DealStructuredDisplayFields & {
  id: string;
  business_id: string;
  title: string | null;
  description: string | null;
  source_locale: string | null;
  title_en: string | null;
  title_es: string | null;
  title_ko: string | null;
  description_en: string | null;
  description_es: string | null;
  description_ko: string | null;
  poster_url: string | null;
  poster_storage_path?: string | null;
  end_time: string;
  start_time: string;
  max_claims: number | null;
  price: number | null;
  is_recurring: boolean;
  days_of_week: number[] | null;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
  timezone: string | null;
  is_demo?: boolean | null;
};

const BUSINESS_DEALS_BASE_SELECT =
  "id,business_id,title,description,source_locale,title_en,title_es,title_ko,description_en,description_es,description_ko,is_demo,poster_url,poster_storage_path,end_time,start_time,max_claims,price,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone";
const BUSINESS_DEALS_SELECT = `${BUSINESS_DEALS_BASE_SELECT},${DEAL_STRUCTURED_DISPLAY_COLUMNS}`;

export default function BusinessProfileScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { id: idParam, distance: distanceParam } = useLocalSearchParams<{ id: string | string[]; distance?: string | string[] }>();
  const id = typeof idParam === "string" ? idParam : idParam?.[0] ?? "";
  const distanceLabel =
    typeof distanceParam === "string" ? distanceParam.trim() : distanceParam?.[0]?.trim() ?? "";
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { userId, isLoggedIn, loading: authLoading } = useBusiness();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const customerLocaleResolutionEnabled = isAiV5CustomerLocaleResolutionEnabled();
  const localizedOfferRendererEnabled = isAiV5LocalizedOfferRendererEnabled();
  const [biz, setBiz] = useState<BizRow | null>(null);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [customerPreferredDealLocale, setCustomerPreferredDealLocale] = useState<string | null>(null);
  const [customerDealLocalizationsByDealId, setCustomerDealLocalizationsByDealId] = useState<Map<string, CustomerDealLocalization>>(
    () => new Map(),
  );
  const deviceDealLocaleRef = useRef(getDeviceDealLocale());
  const resolvedDealDisplayLocale = customerLocaleResolutionEnabled
    ? resolveDealDisplayLocale({
        customerPreferredLocale: customerPreferredDealLocale,
        appLanguage: i18n.language,
        deviceLanguage: deviceDealLocaleRef.current,
        adSourceLocale: null,
      })
    : {
        locale: supportedLocaleOrDefault(i18n.language),
        source: "app_language" as const,
        enabledLocales: [supportedLocaleOrDefault(i18n.language)],
      };

  const load = useCallback(async () => {
    if (!id?.trim()) {
      setBiz(null);
      setDeals([]);
      setBanner(t("businessProfile.notFound"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setBanner(null);
    const { data: b, error: eb } = await supabase
      .from("businesses")
      .select("id,name,address,location,latitude,longitude,phone,hours_text,short_description,logo_url,is_demo")
      .eq("id", id)
      .maybeSingle();
    if (eb || !b) {
      setBiz(null);
      setDeals([]);
      // Don't leak Postgres details into the banner. Translate known patterns so
      // RLS / network / "not found" all render as friendly localized text.
      setBanner(eb?.message ? translateKnownApiMessage(eb.message, t) : t("businessProfile.notFound"));
      setLoading(false);
      return;
    }
    setBiz(b as BizRow);

    const enrichedDealsResult = await supabase
      .from("deals")
      .select(BUSINESS_DEALS_SELECT)
      .eq("business_id", id)
      .eq("is_active", true)
      .gte("end_time", new Date().toISOString())
      .order("end_time", { ascending: true })
      .limit(12);
    let dealsData: unknown = enrichedDealsResult.data;
    if (isMissingStructuredDisplayColumnError(enrichedDealsResult.error)) {
      const baseDealsResult = await supabase
        .from("deals")
        .select(BUSINESS_DEALS_BASE_SELECT)
        .eq("business_id", id)
        .eq("is_active", true)
        .gte("end_time", new Date().toISOString())
        .order("end_time", { ascending: true })
        .limit(12);
      dealsData = baseDealsResult.data;
    }

    const raw = (dealsData ?? []) as DealRow[];
    setDeals(raw.filter((d) => isDealActiveNow(d)));

    if (userId) {
      const { data: fav } = await supabase
        .from("favorites")
        .select("business_id")
        .eq("user_id", userId)
        .eq("business_id", id)
        .maybeSingle();
      setIsFavorite(!!fav);
    } else {
      setIsFavorite(false);
    }
    setLoading(false);
  }, [id, userId, t]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void getCustomerPreferredDealLocale().then((locale) => {
        if (!cancelled) setCustomerPreferredDealLocale(locale);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  useEffect(() => {
    if (!customerLocaleResolutionEnabled || deals.length === 0) {
      setCustomerDealLocalizationsByDealId(new Map());
      return;
    }
    let cancelled = false;
    void fetchCustomerDealLocalizations(
      deals.map((deal) => deal.id),
      resolvedDealDisplayLocale.locale,
    ).then((localizations) => {
      if (!cancelled) setCustomerDealLocalizationsByDealId(localizations);
    });
    return () => {
      cancelled = true;
    };
  }, [customerLocaleResolutionEnabled, deals, resolvedDealDisplayLocale.locale]);

  useEffect(() => {
    if (authLoading) return;
    if (!isLoggedIn) {
      router.replace("/auth-landing");
      return;
    }
    void load();
  }, [load, authLoading, isLoggedIn, router]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return undefined;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace("/(tabs)" as Href);
        }
        return true;
      });
      return () => sub.remove();
    }, [router]),
  );

  const canOpenDirections = useMemo(() => {
    if (!biz) return false;
    const lat = typeof biz.latitude === "number" ? biz.latitude : biz.latitude != null ? Number(biz.latitude) : NaN;
    const lng = typeof biz.longitude === "number" ? biz.longitude : biz.longitude != null ? Number(biz.longitude) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return true;
    return !!(biz.address?.trim() || biz.location?.trim());
  }, [biz]);

  const displayAddress = useMemo(() => {
    if (!biz) return "";
    return biz.address?.trim() || biz.location?.trim() || "";
  }, [biz]);

  const logoUri = useMemo(() => biz?.logo_url?.trim() || null, [biz]);

  async function toggleFavorite() {
    if (!userId || !id) {
      setBanner(t("dealDetail.errLoginFavorite"));
      return;
    }
    const next = !isFavorite;
    setIsFavorite(next);
    if (next) {
      const { error } = await supabase.from("favorites").insert({ user_id: userId, business_id: id });
      if (error) {
        setIsFavorite(false);
        setBanner(t("consumerHome.errFavoriteToggle"));
      }
    } else {
      const { error } = await supabase.from("favorites").delete().eq("user_id", userId).eq("business_id", id);
      if (error) {
        setIsFavorite(true);
        setBanner(t("consumerHome.errFavoriteToggle"));
      }
    }
  }

  async function openDirections() {
    if (!biz) return;
    const lat = typeof biz.latitude === "number" ? biz.latitude : biz.latitude != null ? Number(biz.latitude) : NaN;
    const lng = typeof biz.longitude === "number" ? biz.longitude : biz.longitude != null ? Number(biz.longitude) : NaN;
    const label = (biz.name ?? "Business").trim() || "Business";
    const encodedLabel = encodeURIComponent(label);
    let nativeUrl: string;
    let fallbackUrl: string;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      nativeUrl = Platform.select({
        ios: `maps://?q=${encodedLabel}&ll=${lat},${lng}`,
        android: `geo:0,0?q=${lat},${lng}(${encodedLabel})`,
        default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
      })!;
      fallbackUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    } else {
      const area = (biz.address ?? biz.location)?.trim();
      if (!area) {
        setBanner(t("businessProfile.mapsUnavailable"));
        return;
      }
      const q = encodeURIComponent(`${label} ${area}`.trim());
      nativeUrl = Platform.select({
        ios: `maps://?q=${q}`,
        android: `geo:0,0?q=${q}`,
        default: `https://www.google.com/maps/search/?api=1&query=${q}`,
      })!;
      fallbackUrl = `https://www.google.com/maps/search/?api=1&query=${q}`;
    }
    setBanner(null);
    try {
      if (await Linking.canOpenURL(nativeUrl)) {
        await Linking.openURL(nativeUrl);
        return;
      }
      if (nativeUrl !== fallbackUrl && (await Linking.canOpenURL(fallbackUrl))) {
        await Linking.openURL(fallbackUrl);
        return;
      }
      setBanner(
        t("businessProfile.mapsOpenFailed", {
          defaultValue: "We couldn't open maps. Try the address from this page.",
        }),
      );
    } catch {
      setBanner(
        t("businessProfile.mapsOpenFailed", {
          defaultValue: "We couldn't open maps. Try the address from this page.",
        }),
      );
    }
  }

  function dialPhone() {
    const p = biz?.phone?.replace(/[^\d+]/g, "");
    if (!p) return;
    void Linking.openURL(`tel:${p}`);
  }

  if (authLoading) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  if (!isLoggedIn) {
    return null;
  }

  if (loading) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={{ marginTop: Spacing.md, fontSize: 16, fontWeight: "700", color: theme.text }}>
          {t("businessProfile.loading")}
        </Text>
      </View>
    );
  }

  if (!biz) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, gap: Spacing.lg, backgroundColor: theme.background }}>
        {banner ? <Banner message={banner} tone="error" /> : null}
        <View
          style={{
            borderRadius: Radii.lg,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
            padding: Spacing.xxl,
            alignItems: "center",
            gap: Spacing.sm,
            ...Shadows.soft,
          }}
        >
          <MaterialIcons name="storefront" size={34} color={theme.primary} />
          <Text style={{ fontSize: 18, lineHeight: 24, fontWeight: "800", color: theme.text, textAlign: "center" }}>
            {t("businessProfile.notFound")}
          </Text>
        </View>
        <SecondaryButton
          title={t("commonUi.goBack")}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)");
          }}
        />
      </View>
    );
  }

  const businessInitial = biz.name.trim().charAt(0).toUpperCase() || "T";

  return (
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: biz.name || t("businessProfile.title") }} />
      {banner ? <Banner message={banner} tone="error" /> : null}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: scrollBottom }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            height: 158,
            borderRadius: Radii.lg,
            marginBottom: Spacing.lg,
            backgroundColor: "rgba(255,159,28,0.10)",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            borderWidth: 1,
            borderColor: colorScheme === "dark" ? "rgba(255,159,28,0.26)" : "rgba(255,159,28,0.18)",
          }}
        >
          {logoUri ? (
            <Image source={{ uri: logoUri }} style={{ width: "100%", height: "100%" }} contentFit="contain" />
          ) : (
            <View style={{ alignItems: "center", gap: Spacing.sm }}>
              <View
                style={{
                  width: 82,
                  height: 82,
                  borderRadius: 41,
                  backgroundColor: colorScheme === "dark" ? "rgba(255,159,28,0.18)" : "#FFF7ED",
                  borderWidth: 1,
                  borderColor: colorScheme === "dark" ? "rgba(255,159,28,0.32)" : "#FED7AA",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                }}
              >
                <MaterialIcons name="storefront" size={28} color={theme.accentText} />
                <Text style={{ fontSize: 22, fontWeight: "900", color: theme.accentText }} numberOfLines={1}>
                  {businessInitial}
                </Text>
              </View>
              <Text
                style={{ color: theme.accentText, fontSize: 13, fontWeight: "900", textTransform: "uppercase" }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                maxFontSizeMultiplier={1.15}
              >
                {biz.name}
              </Text>
            </View>
          )}
        </View>
        <Text style={{ fontSize: 28, lineHeight: 34, fontWeight: "800", color: theme.text }}>{biz.name}</Text>
        {biz.is_demo ? (
          <View style={{ marginTop: Spacing.md }}>
            <DemoOfferNotice detail />
          </View>
        ) : null}
        {biz.short_description?.trim() ? (
          <Text style={{ marginTop: Spacing.sm, color: theme.mutedText, fontSize: 16, lineHeight: 24 }}>
            {biz.short_description}
          </Text>
        ) : null}

        <Pressable
          onPress={toggleFavorite}
          accessibilityRole="button"
          accessibilityState={{ selected: isFavorite }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: Spacing.sm,
            marginTop: Spacing.lg,
            minHeight: 54,
            borderRadius: Radii.lg,
            borderWidth: 1,
            borderColor: isFavorite ? theme.favorite : theme.border,
            backgroundColor: isFavorite
              ? colorScheme === "dark"
                ? "rgba(240,70,122,0.16)"
                : "rgba(224,36,94,0.10)"
              : theme.surface,
            paddingHorizontal: Spacing.md,
          }}
        >
          <MaterialIcons name={isFavorite ? "favorite" : "favorite-border"} size={24} color={isFavorite ? theme.favorite : theme.icon} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: theme.text }}>
              {isFavorite ? t("dealDetail.favorited") : t("dealDetail.favorite")}
            </Text>
            <Text style={{ fontSize: 12, color: theme.mutedText, marginTop: 2 }}>{t("consumerHome.favoriteAlertsHint")}</Text>
          </View>
        </Pressable>

        <View style={{ marginTop: Spacing.xl, gap: Spacing.md }}>
          <View
            style={{
              borderRadius: Radii.lg,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surface,
              padding: Spacing.lg,
              gap: Spacing.md,
              ...Shadows.soft,
            }}
          >
            <InfoRow
              icon="location-on"
              label={t("businessSetup.address")}
              value={displayAddress || t("businessProfile.notProvided")}
              theme={theme}
            />
            {distanceLabel ? (
              <InfoRow icon="near-me" value={distanceLabel} theme={theme} emphasize />
            ) : null}
            <PrimaryButton title={t("businessProfile.directions")} onPress={() => void openDirections()} disabled={!canOpenDirections} />
            {!canOpenDirections ? (
              <Text style={{ color: theme.mutedText, fontSize: 13, lineHeight: 19 }}>
                {t("businessProfile.mapsUnavailable")}
              </Text>
            ) : null}
          </View>

          <View
            style={{
              borderRadius: Radii.lg,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surface,
              padding: Spacing.lg,
              gap: Spacing.lg,
            }}
          >
            <InfoRow
              icon="schedule"
              label={t("businessProfile.hours")}
              value={biz.hours_text?.trim() ? biz.hours_text : t("businessProfile.notProvided")}
              theme={theme}
            />
            <View style={{ height: 1, backgroundColor: theme.border }} />
            <InfoRow
              icon="call"
              label={t("businessProfile.phone")}
              value={biz.phone?.trim() ? biz.phone : t("businessProfile.notProvided")}
              theme={theme}
              onPress={biz.phone?.trim() ? dialPhone : undefined}
              emphasize={!!biz.phone?.trim()}
            />
          </View>
        </View>

        <View style={{ marginTop: Spacing.xxl, gap: Spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.md }}>
            <Text style={{ flex: 1, fontSize: 20, lineHeight: 26, fontWeight: "800", color: theme.text }}>
              {deals.length > 0
                ? t("consumerWallet.activeDeals", { count: deals.length })
                : t("businessProfile.liveDeal")}
            </Text>
            {deals.length > 0 ? <DealStatusPill status="live" /> : null}
          </View>
          {deals.length > 0 ? (
            <View style={{ gap: Spacing.lg }}>
              {deals.map((deal) => {
                const uri = resolveDealPosterDisplayUri(deal.poster_url, deal.poster_storage_path);
                const localizedDisplay = buildLocalizedDealDisplay({
                  deal: {
                    ...deal,
                    customer_deal_localization: customerDealLocalizationsByDealId.get(deal.id) ?? null,
                    businesses: {
                      name: biz.name,
                      location: biz.location,
                      address: biz.address,
                    },
                  },
                  locale: resolvedDealDisplayLocale.locale,
                  localeResolutionSource: resolvedDealDisplayLocale.source,
                  useLocalizedOfferRenderer: customerLocaleResolutionEnabled && localizedOfferRendererEnabled,
                  fallbackLanguage: i18n.language,
                });
                const dealTitle = localizedDisplay.title || t("dealDetail.dealFallback");
                const dealDescription = localizedDisplay.description;
                const isDemoDeal = deal.is_demo === true || biz.is_demo === true;
                return (
                  <Pressable
                    key={deal.id}
                    onPress={() => router.push(`/deal/${deal.id}` as Href)}
                    accessibilityRole="button"
                    accessibilityLabel={dealTitle}
                    style={{
                      borderRadius: Radii.lg,
                      overflow: "hidden",
                      backgroundColor: theme.surface,
                      ...Shadows.soft,
                    }}
                  >
                    {uri ? (
                      <Image source={{ uri }} style={{ width: "100%", aspectRatio: 16 / 9 }} contentFit="cover" />
                    ) : (
                      <View
                        style={{
                          height: 140,
                          backgroundColor: "rgba(255,159,28,0.10)",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Image
                          source={require("../../assets/images/twofer-mark-512.png")}
                          style={{ width: 58, height: 58, opacity: 0.3 }}
                          contentFit="contain"
                        />
                      </View>
                    )}
                    <View style={{ padding: Spacing.lg, gap: Spacing.sm }}>
                      {isDemoDeal ? <DemoOfferNotice compact /> : null}
                      <Text style={{ fontSize: 19, lineHeight: 25, fontWeight: "800", color: theme.text }}>
                        {dealTitle}
                      </Text>
                      {dealDescription ? (
                        <Text style={{ color: theme.mutedText, fontSize: 14, lineHeight: 21 }} numberOfLines={3}>
                          {dealDescription}
                        </Text>
                      ) : null}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: Spacing.xs }}>
                        <MaterialIcons name="schedule" size={17} color={theme.accentText} />
                        <Text style={{ flex: 1, color: theme.accentText, fontSize: 13, lineHeight: 18, fontWeight: "800" }}>
                          {formatValiditySummary(deal, {
                            lang: i18n.language,
                            endsVerb: t("commonUi.dealEndsVerb"),
                            t,
                          })}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View
              style={{
                borderRadius: Radii.lg,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.surface,
                padding: Spacing.xxl,
                alignItems: "center",
                gap: Spacing.sm,
              }}
            >
              <MaterialIcons name="confirmation-number" size={34} color={theme.icon} />
              <Text style={{ fontSize: 17, lineHeight: 23, fontWeight: "800", color: theme.text, textAlign: "center" }}>
                {t("dealStatus.noLiveDeal")}
              </Text>
              <Text style={{ color: theme.mutedText, fontSize: 14, lineHeight: 21, textAlign: "center" }}>
                {t("businessProfile.noLiveDeal")}
              </Text>
            </View>
          )}
        </View>

        {deals.length > 0 ? (
          <View
            style={{
              marginTop: Spacing.xl,
              borderRadius: Radii.lg,
              borderWidth: 1,
              borderColor: colorScheme === "dark" ? "rgba(255,159,28,0.30)" : "rgba(255,159,28,0.22)",
              backgroundColor: colorScheme === "dark" ? "rgba(255,159,28,0.10)" : "rgba(255,159,28,0.08)",
              padding: Spacing.lg,
              gap: Spacing.sm,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm }}>
              <MaterialIcons name="qr-code-2" size={22} color={theme.accentText} />
              <Text style={{ flex: 1, color: theme.text, fontSize: 16, lineHeight: 22, fontWeight: "800" }}>
                {t("consumerWallet.useDealTitle")}
              </Text>
            </View>
            <Text style={{ color: theme.mutedText, fontSize: 14, lineHeight: 21 }}>
              {t("consumerWallet.useDealBody")}
            </Text>
            <Text style={{ color: theme.accentText, fontSize: 13, lineHeight: 18, fontWeight: "800" }}>
              {t("consumerWallet.scanQrAtCounter")}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

type InfoRowProps = {
  icon: ComponentProps<typeof MaterialIcons>["name"];
  label?: string;
  value: string;
  theme: typeof Colors.light;
  onPress?: () => void;
  emphasize?: boolean;
};

function InfoRow({ icon, label, value, theme, onPress, emphasize }: InfoRowProps) {
  const content = (
    <View style={{ flexDirection: "row", gap: Spacing.md, alignItems: "flex-start" }}>
      <MaterialIcons name={icon} size={21} color={emphasize ? theme.accentText : theme.icon} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        {label ? (
          <Text style={{ color: theme.mutedText, fontSize: 12, lineHeight: 17, fontWeight: "800", textTransform: "uppercase" }}>
            {label}
          </Text>
        ) : null}
        <Text
          style={{
            marginTop: label ? 2 : 0,
            color: emphasize ? theme.accentText : theme.text,
            fontSize: 15,
            lineHeight: 22,
            fontWeight: emphasize ? "800" : "600",
          }}
        >
          {value}
        </Text>
      </View>
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {content}
    </Pressable>
  );
}
