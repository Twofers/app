import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Platform, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { supabase } from "@/lib/supabase";
import { formatValiditySummary, isDealActiveNow } from "@/lib/deal-time";
import { Banner } from "@/components/ui/banner";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { PrimaryButton } from "@/components/ui/primary-button";
import { useBusiness } from "@/hooks/use-business";
import { DealStatusPill } from "@/components/deal-status-pill";
import { resolveDealPosterDisplayUri } from "@/lib/deal-poster-url";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Colors } from "@/constants/theme";

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
};

type DealRow = {
  id: string;
  title: string | null;
  description: string | null;
  poster_url: string | null;
  poster_storage_path?: string | null;
  end_time: string;
  start_time: string;
  price: number | null;
  is_recurring: boolean;
  days_of_week: number[] | null;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
  timezone: string | null;
};

export default function BusinessProfileScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { id: idParam } = useLocalSearchParams<{ id: string | string[] }>();
  const id = typeof idParam === "string" ? idParam : idParam?.[0] ?? "";
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const { userId, isLoggedIn, loading: authLoading } = useBusiness();
  const [biz, setBiz] = useState<BizRow | null>(null);
  const [deal, setDeal] = useState<DealRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);

  const load = useCallback(async () => {
    if (!id?.trim()) {
      setBiz(null);
      setDeal(null);
      setBanner(t("businessProfile.notFound"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setBanner(null);
    const { data: b, error: eb } = await supabase
      .from("businesses")
      .select("id,name,address,location,latitude,longitude,phone,hours_text,short_description")
      .eq("id", id)
      .maybeSingle();
    if (eb || !b) {
      setBiz(null);
      setDeal(null);
      setBanner(eb?.message ?? t("businessProfile.notFound"));
      setLoading(false);
      return;
    }
    setBiz(b as BizRow);

    const { data: deals } = await supabase
      .from("deals")
      .select(
        "id,title,description,poster_url,poster_storage_path,end_time,start_time,price,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone",
      )
      .eq("business_id", id)
      .eq("is_active", true)
      .gte("end_time", new Date().toISOString())
      .order("end_time", { ascending: true })
      .limit(12);

    const raw = (deals ?? []) as DealRow[];
    const live = raw.find((d) => isDealActiveNow(d)) ?? null;
    setDeal(live);

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

  useEffect(() => {
    if (authLoading) return;
    if (!isLoggedIn) {
      // Preserve the business destination so the user lands here after sign-in.
      const bizHref = id ? `/business/${id}` : "/(tabs)";
      router.replace({ pathname: "/auth-landing", params: { next: bizHref } });
      return;
    }
    void load();
  }, [load, authLoading, isLoggedIn, router, id]);

  const canOpenDirections = useMemo(() => {
    if (!biz) return false;
    const lat = typeof biz.latitude === "number" ? biz.latitude : biz.latitude != null ? Number(biz.latitude) : NaN;
    const lng = typeof biz.longitude === "number" ? biz.longitude : biz.longitude != null ? Number(biz.longitude) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return true;
    return !!(biz.address?.trim() || biz.location?.trim());
  }, [biz]);

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

  function openDirections() {
    if (!biz) return;
    const lat = typeof biz.latitude === "number" ? biz.latitude : biz.latitude != null ? Number(biz.latitude) : NaN;
    const lng = typeof biz.longitude === "number" ? biz.longitude : biz.longitude != null ? Number(biz.longitude) : NaN;
    const label = encodeURIComponent(biz.name ?? "Business");
    let url: string;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      url =
        Platform.OS === "ios"
          ? `maps:0,0?q=${label}@${lat},${lng}`
          : `geo:0,0?q=${lat},${lng}(${label})`;
    } else {
      const area = (biz.address ?? biz.location)?.trim();
      if (!area) return;
      const q = encodeURIComponent(`${biz.name ?? ""} ${area}`.trim());
      url = Platform.select({
        ios: `maps:0,0?q=${q}`,
        android: `geo:0,0?q=${q}`,
        default: `https://www.google.com/maps/search/?api=1&query=${q}`,
      })!;
    }
    void Linking.openURL(url);
  }

  function dialPhone() {
    const p = biz?.phone?.replace(/[^\d+]/g, "");
    if (!p) return;
    void Linking.openURL(`tel:${p}`);
  }

  if (authLoading) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!isLoggedIn) {
    return null;
  }

  if (loading) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>{t("businessProfile.loading")}</Text>
      </View>
    );
  }

  if (!biz) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, gap: Spacing.lg }}>
        {banner ? <Banner message={banner} tone="error" /> : null}
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

  return (
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
      {banner ? <Banner message={banner} tone="error" /> : null}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: scrollBottom }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            height: 80,
            borderRadius: 16,
            marginBottom: Spacing.lg,
            backgroundColor: "rgba(255,159,28,0.10)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Image
            source={require("../../assets/images/splash-icon.png")}
            style={{ width: 56, height: 56, opacity: 0.45 }}
            contentFit="contain"
          />
        </View>
        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3, color: theme.text }}>{biz.name}</Text>

        <Pressable
          onPress={toggleFavorite}
          style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: Spacing.md, minHeight: 44 }}
        >
          <MaterialIcons name={isFavorite ? "favorite" : "favorite-border"} size={24} color={isFavorite ? "#e0245e" : theme.mutedText} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: "600", color: theme.text }}>
              {isFavorite ? t("dealDetail.favorited") : t("dealDetail.favorite")}
            </Text>
            <Text style={{ fontSize: 12, marginTop: 2, color: theme.mutedText }}>{t("consumerHome.favoriteAlertsHint")}</Text>
          </View>
        </Pressable>

        {biz.address || biz.location ? (
          <Text style={{ marginTop: Spacing.lg, fontSize: 16, lineHeight: 24, color: theme.text }}>
            {biz.address?.trim() || biz.location}
          </Text>
        ) : null}

        <View style={{ marginTop: Spacing.md }}>
          <PrimaryButton title={t("businessProfile.directions")} onPress={openDirections} disabled={!canOpenDirections} />
        </View>

        <View style={{ marginTop: Spacing.xl, gap: Spacing.sm }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: theme.text }}>{t("businessProfile.hours")}</Text>
          <Text style={{ lineHeight: 22, color: theme.mutedText }}>
            {biz.hours_text?.trim() ? biz.hours_text : t("businessProfile.notProvided")}
          </Text>
        </View>

        <View style={{ marginTop: Spacing.lg, gap: Spacing.sm }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: theme.text }}>{t("businessProfile.phone")}</Text>
          {biz.phone?.trim() ? (
            <Pressable onPress={dialPhone}>
              <Text style={{ fontSize: 16, color: theme.primary, fontWeight: "600" }}>{biz.phone}</Text>
            </Pressable>
          ) : (
            <Text style={{ color: theme.mutedText }}>{t("businessProfile.notProvided")}</Text>
          )}
        </View>

        {biz.short_description?.trim() ? (
          <View style={{ marginTop: Spacing.lg }}>
            <Text style={{ lineHeight: 22, color: theme.text }}>{biz.short_description}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: Spacing.xxl, paddingTop: Spacing.lg, borderTopWidth: 1, borderTopColor: theme.border }}>
          <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: Spacing.md, color: theme.text }}>{t("businessProfile.liveDeal")}</Text>
          {deal ? (
            <Pressable
              onPress={() => router.push(`/deal/${deal.id}` as Href)}
              style={{
                borderRadius: 18,
                overflow: "hidden",
                backgroundColor: theme.surface,
                boxShadow: "0px 2px 8px rgba(0,0,0,0.06)",
                elevation: 2,
              }}
            >
              {(() => {
                const uri = resolveDealPosterDisplayUri(deal.poster_url, deal.poster_storage_path);
                return uri ? (
                  <Image source={{ uri }} style={{ width: "100%", aspectRatio: 16 / 9 }} contentFit="cover" />
                ) : (
                  <View
                    style={{ height: 120, backgroundColor: "#ececec", alignItems: "center", justifyContent: "center" }}
                  >
                    <Text style={{ opacity: 0.5 }}>{t("dealDetail.noImage")}</Text>
                  </View>
                );
              })()}
              <View style={{ padding: Spacing.md, gap: Spacing.sm }}>
                <DealStatusPill status="live" />
                <Text style={{ fontSize: 18, fontWeight: "700" }}>{deal.title ?? t("dealDetail.dealFallback")}</Text>
                <Text style={{ opacity: 0.7, fontSize: 14 }} numberOfLines={3}>
                  {deal.description ?? ""}
                </Text>
                <Text style={{ opacity: 0.65, fontSize: 13 }}>
                  {formatValiditySummary(deal, {
                    lang: i18n.language,
                    endsVerb: t("commonUi.dealEndsVerb"),
                    t,
                  })}
                </Text>
              </View>
            </Pressable>
          ) : (
            <Text style={{ opacity: 0.72, lineHeight: 22 }}>{t("businessProfile.noLiveDeal")}</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
