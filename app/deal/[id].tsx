import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { supabase } from "../../lib/supabase";
import { claimDeal } from "../../lib/functions";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { QrModal } from "../../components/qr-modal";
import { useBusiness } from "../../hooks/use-business";
import { formatValiditySummary } from "../../lib/deal-time";

type Deal = {
  id: string;
  title: string | null;
  description: string | null;
  end_time: string;
  start_time: string;
  poster_url: string | null;
  business_id: string;
  price: number | null;
  claim_cutoff_buffer_minutes: number;
  max_claims: number;
  businesses?: {
    name: string | null;
  } | null;
};

export default function DealDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [deal, setDeal] = useState<Deal | null>(null);
  const { isLoggedIn, userId } = useBusiness();
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpires, setQrExpires] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [claimsCount, setClaimsCount] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await loadDeal();
    })();
  }, [id]);

  async function loadDeal() {
    if (!id) return;
    const { data, error } = await supabase
      .from("deals")
      .select("id,title,description,end_time,start_time,poster_url,business_id,price,claim_cutoff_buffer_minutes,max_claims,businesses(name)")
      .eq("id", id)
      .single();
    if (error) {
      setBanner(error.message);
      return;
    }
    const dealData = data as Deal;
    setDeal(dealData);
    await loadClaimCount(dealData.id);
  }

  async function loadClaimCount(dealId: string) {
    const { count, error } = await supabase
      .from("deal_claims")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);
    if (!error && typeof count === "number") {
      setClaimsCount(count);
    }
  }

  useEffect(() => {
    (async () => {
      if (!userId || !deal?.business_id) return;
      const { data: fav } = await supabase
        .from("favorites")
        .select("business_id")
        .eq("user_id", userId)
        .eq("business_id", deal.business_id)
        .maybeSingle();
      setIsFavorite(!!fav);
    })();
  }, [userId, deal?.business_id]);

  async function doClaim() {
    try {
      if (!isLoggedIn) {
        setBanner("Log in to claim deals.");
        return;
      }
      if (!deal) return;
      if (isClaiming) return;
      setIsClaiming(true);
      const out = await claimDeal(deal.id);
      setQrToken(out.token);
      setQrExpires(out.expires_at);
      setQrVisible(true);
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message
          : typeof e === "string"
          ? e
          : JSON.stringify(e, null, 2);
      setBanner(msg);
    } finally {
      setIsClaiming(false);
    }
  }

  async function refreshQr() {
    if (!deal) return;
    if (refreshingQr) return;
    setRefreshingQr(true);
    try {
      const out = await claimDeal(deal.id);
      setQrToken(out.token);
      setQrExpires(out.expires_at);
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message
          : typeof e === "string"
          ? e
          : JSON.stringify(e, null, 2);
      setBanner(msg);
    } finally {
      setRefreshingQr(false);
    }
  }

  async function toggleFavorite() {
    if (!userId || !deal?.business_id) {
      setBanner("Log in to save favorites.");
      return;
    }
    const next = !isFavorite;
    setIsFavorite(next);
    if (next) {
      const { error } = await supabase
        .from("favorites")
        .insert({ user_id: userId, business_id: deal.business_id });
      if (error) {
        setIsFavorite(!next);
        setBanner(error.message);
      }
    } else {
      const { error } = await supabase
        .from("favorites")
        .delete()
        .eq("user_id", userId)
        .eq("business_id", deal.business_id);
      if (error) {
        setIsFavorite(!next);
        setBanner(error.message);
      }
    }
  }

  if (!deal) {
    return (
      <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
        <Text style={{ fontSize: 22, fontWeight: "700" }}>Deal</Text>
        <Text style={{ marginTop: 12, opacity: 0.8 }}>Loading...</Text>
      </View>
    );
  }

  const remaining = Math.max(0, deal.max_claims - claimsCount);

  return (
    <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
      {banner ? <Banner message={banner} tone="error" /> : null}
      <Pressable
        onPress={toggleFavorite}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}
      >
        <MaterialIcons
          name={isFavorite ? "favorite" : "favorite-border"}
          size={20}
          color={isFavorite ? "#e0245e" : "#666"}
        />
        <Text style={{ color: "#666" }}>{isFavorite ? "Favorited" : "Favorite"}</Text>
      </Pressable>
      {deal.poster_url ? (
        <Image
          source={{ uri: deal.poster_url }}
          style={{ height: 220, width: "100%", borderRadius: 14 }}
          contentFit="cover"
        />
      ) : (
        <View
          style={{
            height: 220,
            borderRadius: 14,
            backgroundColor: "#e5e5e5",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#666" }}>No image</Text>
        </View>
      )}

      <Text style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
        {deal.businesses?.name ?? "Local business"}
      </Text>
      <Text style={{ fontSize: 20, fontWeight: "700", marginTop: 4 }}>{deal.title ?? "Deal"}</Text>
      {deal.price != null ? (
        <Text style={{ marginTop: 6, fontWeight: "700" }}>${deal.price.toFixed(2)}</Text>
      ) : null}
      {deal.description ? (
        <Text style={{ marginTop: 8 }}>{deal.description}</Text>
      ) : null}
      <View
        style={{
          marginTop: 14,
          borderRadius: 12,
          backgroundColor: "#f8f8f8",
          padding: 12,
        }}
      >
        <Text style={{ fontWeight: "700", marginBottom: 6 }}>Fine print</Text>
        <Text style={{ opacity: 0.75 }}>
          Validity: {formatValiditySummary(deal)}
        </Text>
        <Text style={{ opacity: 0.75, marginTop: 4 }}>
          Cutoff buffer: {deal.claim_cutoff_buffer_minutes} minutes before end
        </Text>
        <Text style={{ opacity: 0.75, marginTop: 4 }}>
          Claims remaining: {remaining} / {deal.max_claims}
        </Text>
      </View>

      <View style={{ marginTop: 16, gap: 8 }}>
        <PrimaryButton title={isClaiming ? "Claiming..." : "Claim"} onPress={doClaim} disabled={isClaiming} />
        <SecondaryButton
          title={refreshingQr ? "Refreshing..." : "Refresh QR"}
          onPress={refreshQr}
          disabled={refreshingQr}
        />
      </View>

      <QrModal
        visible={qrVisible}
        token={qrToken}
        expiresAt={qrExpires}
        onHide={() => setQrVisible(false)}
        onRefresh={refreshQr}
        refreshing={refreshingQr}
      />
    </View>
  );
}
