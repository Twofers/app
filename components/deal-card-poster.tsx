import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useTranslation } from "react-i18next";
import { Spacing } from "@/lib/screen-layout";
import { formatAppDateTime } from "@/lib/i18n/format-datetime";
import { useMinuteTick } from "@/hooks/use-minute-tick";
import { formatConsumerCountdown } from "@/lib/consumer-countdown";
import { DealStatusPill, type ConsumerDealStatusKey } from "@/components/deal-status-pill";

type DealCardPosterProps = {
  title: string;
  description?: string | null;
  businessName?: string | null;
  /** Shown under business name when Near me + coordinates (localized in parent). */
  distanceLabel?: string | null;
  posterUrl?: string | null;
  price?: number | null;
  endTime: string;
  remainingClaims?: number | null;
  isFavorite: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
  onClaim: () => void;
  claiming?: boolean;
  statusMessage?: string | null;
  statusTone?: "success" | "error" | "info";
  /** Visual deal lifecycle on discovery cards. */
  dealStatus?: ConsumerDealStatusKey;
  /** When true, shows a live countdown to `endTime` (updates every minute). */
  showLiveCountdown?: boolean;
};

export function DealCardPoster({
  title,
  description,
  businessName,
  distanceLabel,
  posterUrl,
  price,
  endTime,
  remainingClaims,
  isFavorite,
  onPress,
  onToggleFavorite,
  onClaim,
  claiming,
  statusMessage,
  statusTone = "info",
  dealStatus = "live",
  showLiveCountdown = true,
}: DealCardPosterProps) {
  const { t, i18n } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();
  const minuteTick = useMinuteTick();
  /** Image-first feed (restored Twofer card proportions from pre-drift polish baseline). */
  const imageHeight = Math.round(Math.min(400, Math.max(248, windowHeight * 0.44)));

  const statusColors = {
    success: { background: "#e8f5e9", text: "#1b5e20" },
    error: { background: "#fde8e8", text: "#7a1f1f" },
    info: { background: "#eef2ff", text: "#1e3a8a" },
  }[statusTone];

  const countdown =
    showLiveCountdown && dealStatus === "live"
      ? formatConsumerCountdown(endTime, minuteTick, t)
      : null;

  return (
    <View
      style={{
        borderRadius: 20,
        backgroundColor: "#fff",
        overflow: "hidden",
        marginBottom: Spacing.lg,
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      <Pressable onPress={onPress} accessibilityRole="button">
        {posterUrl ? (
          <Image source={{ uri: posterUrl }} style={{ height: imageHeight, width: "100%" }} contentFit="cover" />
        ) : (
          <View
            style={{
              height: imageHeight,
              backgroundColor: "#ececec",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#666", fontSize: 15 }}>{t("dealDetail.noImage")}</Text>
          </View>
        )}
        <View style={{ padding: Spacing.lg }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.sm }}>
            <DealStatusPill status={dealStatus} />
            {countdown ? (
              <Text style={{ fontSize: 13, fontWeight: "700", opacity: 0.55 }} numberOfLines={1}>
                {t("consumerHome.countdownLabel", { time: countdown })}
              </Text>
            ) : null}
          </View>
          {businessName ? (
            <View style={{ marginBottom: Spacing.xs }}>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  opacity: 0.55,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                {businessName}
              </Text>
              {distanceLabel ? (
                <Text style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>{distanceLabel}</Text>
              ) : null}
            </View>
          ) : null}
          <Text style={{ fontSize: 20, fontWeight: "700", lineHeight: 26 }}>{title}</Text>
          {price != null ? (
            <Text style={{ marginTop: Spacing.sm, fontSize: 18, fontWeight: "700" }}>${price.toFixed(2)}</Text>
          ) : null}
          {description ? (
            <Text style={{ marginTop: Spacing.sm, opacity: 0.78, fontSize: 15, lineHeight: 22 }}>
              {description.length > 140 ? `${description.slice(0, 140)}…` : description}
            </Text>
          ) : null}
          <Text style={{ marginTop: Spacing.md, opacity: 0.65, fontSize: 14 }}>
            {t("dealsBrowse.dealEnds", { time: formatAppDateTime(endTime, i18n.language) })}
          </Text>
          {typeof remainingClaims === "number" ? (
            <Text style={{ marginTop: Spacing.xs, opacity: 0.65, fontSize: 14 }}>
              {t("dealsBrowse.cardClaimsLeft", { count: remainingClaims })}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <View
        style={{
          paddingHorizontal: Spacing.lg,
          paddingTop: Spacing.sm,
          paddingBottom: Spacing.lg,
          gap: Spacing.md,
          borderTopWidth: 1,
          borderTopColor: "#f0f0f0",
        }}
      >
        <Pressable
          onPress={onToggleFavorite}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityState={{ selected: isFavorite }}
          accessibilityLabel={isFavorite ? t("dealDetail.favorited") : t("dealDetail.favorite")}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: Spacing.sm,
            minHeight: 44,
            paddingVertical: Spacing.xs,
            paddingHorizontal: Spacing.xs,
            marginHorizontal: -Spacing.xs,
            borderRadius: 12,
            backgroundColor: isFavorite ? "rgba(224,36,94,0.08)" : pressed ? "#f4f4f5" : "transparent",
          })}
        >
          <MaterialIcons
            name={isFavorite ? "favorite" : "favorite-border"}
            size={22}
            color={isFavorite ? "#e0245e" : "#666"}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#444", fontSize: 16, fontWeight: "600" }}>
              {isFavorite ? t("dealsBrowse.cardSaved") : t("dealsBrowse.cardSaveFavorite")}
            </Text>
            <Text style={{ fontSize: 12, opacity: 0.55, marginTop: 2 }}>{t("consumerHome.favoriteAlertsHint")}</Text>
          </View>
        </Pressable>
        <Pressable
          onPress={onClaim}
          disabled={claiming || dealStatus === "claimed" || dealStatus === "redeemed" || dealStatus === "expired"}
          accessibilityRole="button"
          accessibilityLabel={claiming ? t("dealDetail.claiming") : t("dealDetail.claim")}
          style={{
            minHeight: 48,
            paddingVertical: Spacing.md + 2,
            borderRadius: 14,
            backgroundColor: "#111",
            opacity: claiming || dealStatus !== "live" ? 0.45 : 1,
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "white", fontWeight: "700", textAlign: "center", fontSize: 16 }}>
            {dealStatus === "claimed"
              ? t("dealStatus.claimed")
              : dealStatus === "redeemed"
                ? t("dealStatus.redeemed")
                : dealStatus === "expired"
                  ? t("dealStatus.expired")
                  : claiming
                    ? t("dealDetail.claiming")
                    : t("dealDetail.claim")}
          </Text>
        </Pressable>
        {statusMessage ? (
          <View
            style={{
              backgroundColor: statusColors.background,
              borderRadius: 12,
              paddingVertical: Spacing.sm,
              paddingHorizontal: Spacing.md,
            }}
          >
            <Text style={{ color: statusColors.text, fontSize: 14, fontWeight: "600", lineHeight: 20 }}>
              {statusMessage}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
