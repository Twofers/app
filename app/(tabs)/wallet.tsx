import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { supabase } from "../../lib/supabase";
import { claimDeal } from "../../lib/functions";
import { Banner } from "../../components/ui/banner";
import { EmptyState } from "../../components/ui/empty-state";
import { QrModal } from "../../components/qr-modal";
import { useBusiness } from "../../hooks/use-business";

type ClaimRow = {
  id: string;
  token: string;
  expires_at: string;
  redeemed_at: string | null;
  created_at: string;
  deal_id: string;
  deals: {
    id: string;
    title: string | null;
    poster_url: string | null;
    end_time: string;
    businesses: { name: string | null } | null;
  } | null;
};

export default function WalletScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { top, horizontal, listBottom } = useScreenInsets("tab");
  const { isLoggedIn, sessionEmail, userId } = useBusiness();
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpires, setQrExpires] = useState<string | null>(null);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  const [claimingRefreshId, setClaimingRefreshId] = useState<string | null>(null);

  const loadClaims = useCallback(async () => {
    if (!userId) {
      setClaims([]);
      setLoading(false);
      return;
    }
    setBanner(null);
    const { data, error } = await supabase
      .from("deal_claims")
      .select(
        "id,token,expires_at,redeemed_at,created_at,deal_id,deals(id,title,poster_url,end_time,businesses(name))",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) {
      setBanner(error.message);
      setClaims([]);
      setLoading(false);
      return;
    }
    setClaims((data ?? []) as unknown as ClaimRow[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    void loadClaims();
  }, [loadClaims]);

  useFocusEffect(
    useCallback(() => {
      void loadClaims();
    }, [loadClaims]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await loadClaims();
    setRefreshing(false);
  }

  function openQrForClaim(row: ClaimRow) {
    setQrToken(row.token);
    setQrExpires(row.expires_at);
    setActiveDealId(row.deal_id);
    setQrVisible(true);
  }

  async function refreshQr() {
    if (!activeDealId) {
      setBanner(t("wallet.errNoDealForQr"));
      return;
    }
    if (refreshingQr) return;
    setRefreshingQr(true);
    setBanner(null);
    try {
      const out = await claimDeal(activeDealId);
      setQrToken(out.token);
      setQrExpires(out.expires_at);
      await loadClaims();
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : t("wallet.errRefreshQr");
      setBanner(msg);
    } finally {
      setRefreshingQr(false);
    }
  }

  async function refreshClaimFromRow(row: ClaimRow) {
    if (claimingRefreshId) return;
    setClaimingRefreshId(row.id);
    setBanner(null);
    try {
      const out = await claimDeal(row.deal_id);
      setQrToken(out.token);
      setQrExpires(out.expires_at);
      setActiveDealId(row.deal_id);
      setQrVisible(true);
      await loadClaims();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("wallet.errRefreshQr");
      setBanner(msg);
    } finally {
      setClaimingRefreshId(null);
    }
  }

  function dealTitle(row: ClaimRow) {
    return row.deals?.title?.trim() || t("wallet.untitledDeal");
  }

  function businessName(row: ClaimRow) {
    return row.deals?.businesses?.name?.trim() || t("wallet.localBusiness");
  }

  const qrExpired = (expiresAt: string) => new Date(expiresAt).getTime() <= Date.now();

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("wallet.title")}</Text>
      <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, opacity: 0.72, fontSize: 15 }}>
        {isLoggedIn && sessionEmail ? sessionEmail : t("wallet.subtitleGuest")}
      </Text>

      {banner ? <Banner message={banner} tone="error" /> : null}

      {!isLoggedIn ? (
        <EmptyState title={t("wallet.emptyLoginTitle")} message={t("wallet.emptyLoginMessage")} />
      ) : loading ? (
        <View style={{ paddingVertical: Spacing.xxl, alignItems: "center" }}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={claims}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ paddingBottom: listBottom, flexGrow: 1 }}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => {
            const redeemed = !!item.redeemed_at;
            const tokenDead = qrExpired(item.expires_at);

            return (
              <View
                style={{
                  borderRadius: 18,
                  backgroundColor: "#fff",
                  padding: Spacing.md,
                  shadowColor: "#000",
                  shadowOpacity: 0.07,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 2,
                }}
              >
                <Pressable
                  onPress={() => {
                    if (item.deals?.id) router.push(`/deal/${item.deals.id}`);
                  }}
                  disabled={!item.deals?.id}
                  style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                >
                  <View style={{ flexDirection: "row", gap: Spacing.md }}>
                    {item.deals?.poster_url ? (
                      <Image
                        source={{ uri: item.deals.poster_url }}
                        style={{ width: 72, height: 72, borderRadius: 12, backgroundColor: "#eee" }}
                        contentFit="cover"
                      />
                    ) : (
                      <View
                        style={{
                          width: 72,
                          height: 72,
                          borderRadius: 12,
                          backgroundColor: "#ececec",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text style={{ fontSize: 11, opacity: 0.5 }}>—</Text>
                      </View>
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontWeight: "700", fontSize: 16 }} numberOfLines={2}>
                        {dealTitle(item)}
                      </Text>
                      <Text style={{ opacity: 0.65, marginTop: Spacing.xs, fontSize: 14 }} numberOfLines={1}>
                        {businessName(item)}
                      </Text>
                      <Text style={{ opacity: 0.55, marginTop: Spacing.sm, fontSize: 12 }}>
                        {t("wallet.claimedAt")} {new Date(item.created_at).toLocaleString()}
                      </Text>
                    </View>
                  </View>
                </Pressable>
                {redeemed ? (
                  <View
                    style={{
                      alignSelf: "flex-start",
                      marginTop: Spacing.md,
                      paddingHorizontal: Spacing.sm,
                      paddingVertical: 4,
                      borderRadius: 8,
                      backgroundColor: "#e8f5e9",
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#1b5e20" }}>
                      {t("wallet.redeemed")}
                    </Text>
                  </View>
                ) : tokenDead ? (
                  <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
                    <Text style={{ fontSize: 13, opacity: 0.65 }}>{t("wallet.qrExpired")}</Text>
                    <Pressable
                      onPress={() => void refreshClaimFromRow(item)}
                      disabled={claimingRefreshId === item.id}
                      style={{
                        paddingVertical: Spacing.sm,
                        borderRadius: 12,
                        backgroundColor: "#111",
                        opacity: claimingRefreshId === item.id ? 0.65 : 1,
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "700", textAlign: "center" }}>
                        {claimingRefreshId === item.id ? t("wallet.refreshing") : t("wallet.getNewQr")}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => openQrForClaim(item)}
                    style={{
                      marginTop: Spacing.md,
                      paddingVertical: Spacing.sm,
                      borderRadius: 12,
                      backgroundColor: "#111",
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700", textAlign: "center" }}>
                      {t("wallet.showQr")}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <EmptyState title={t("wallet.emptyTitle")} message={t("wallet.emptyMessage")} />
          }
        />
      )}

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
