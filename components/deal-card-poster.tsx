import { Pressable, Text, useWindowDimensions, View, type PressableStateCallbackType } from "react-native";
import { Image } from "expo-image";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Reanimated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { Spacing } from "@/lib/screen-layout";
import { Colors } from "@/constants/theme";
import { formatAppDateTime } from "@/lib/i18n/format-datetime";
import { useMinuteTick } from "@/hooks/use-minute-tick";
import { formatConsumerCountdown } from "@/lib/consumer-countdown";
import { DealStatusPill, type ConsumerDealStatusKey } from "@/components/deal-status-pill";
import { PrimaryButton } from "@/components/ui/primary-button";
import { springPressIn, springPressOut, triggerLightHaptic } from "@/lib/press-feedback";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";

type DealCardPosterProps = {
  // ... your existing props (unchanged)
  title: string;
  description?: string | null;
  businessName?: string | null;
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
  dealStatus?: ConsumerDealStatusKey;
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

  // Hero image — DoorDash style
  const imageHeight = Math.round(Math.max(280, windowHeight * 0.48));
  const favoriteScale = useSharedValue(1);
  const favoriteAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: favoriteScale.value }] }));

  const countdown =
    showLiveCountdown && dealStatus === "live"
      ? formatConsumerCountdown(endTime, minuteTick, t)
      : null;

  const statusColors = {
    success: { background: "#e8f5e9", text: "#1b5e20" },
    error: { background: "#fde8e8", text: "#7a1f1f" },
    info: { background: "#fff3e0", text: "#e65100" }, // orange tint
  }[statusTone];

  return (
    <View
      style={{
        borderRadius: 24,
        backgroundColor: "#fff",
        overflow: "hidden",
        marginBottom: Spacing.xxl,
        boxShadow: "0px 12px 26px rgba(0,0,0,0.18)",
        elevation: 12,
      }}
    >
      <HapticScalePressable
        onPress={onPress}
        accessibilityRole="button"
      >
        {posterUrl ? (
          <Image
            source={{ uri: posterUrl }}
            style={{ height: imageHeight, width: "100%" }}
            contentFit="cover"
            transition={300}
          />
        ) : (
          <View
            style={{
              height: imageHeight,
              backgroundColor: "#f7f7f8",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#9ca3af", fontSize: 15, fontWeight: "600" }}>{t("dealDetail.noImage")}</Text>
          </View>
        )}

        <View style={{ padding: Spacing.xxl }}>
          {/* Status + countdown badge row */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.md }}>
            <DealStatusPill status={dealStatus} />
            {countdown && (
              <View
                style={{
                  backgroundColor: Colors.light.primary,
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>
                  {countdown}
                </Text>
              </View>
            )}
          </View>

          {businessName && (
            <View style={{ marginBottom: Spacing.xs }}>
              <Text style={{ fontSize: 13, fontWeight: "700", opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {businessName}
              </Text>
              {distanceLabel && <Text style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>{distanceLabel}</Text>}
            </View>
          )}

          <Text style={{ fontSize: 22, fontWeight: "700", lineHeight: 28 }}>{title}</Text>

          {price != null && (
            <Text style={{ marginTop: Spacing.sm, fontSize: 20, fontWeight: "700", color: Colors.light.primary }}>
              ${price.toFixed(2)}
            </Text>
          )}

          {description && (
            <Text style={{ marginTop: Spacing.sm, opacity: 0.75, fontSize: 15.5, lineHeight: 23 }}>
              {description.length > 160 ? `${description.slice(0, 160)}…` : description}
            </Text>
          )}

          <Text style={{ marginTop: Spacing.md, opacity: 0.6, fontSize: 14 }}>
            {t("dealsBrowse.dealEnds", { time: formatAppDateTime(endTime, i18n.language) })}
          </Text>

          {remainingClaims != null && (
            <Text style={{ marginTop: Spacing.xs, opacity: 0.6, fontSize: 14 }}>
              {t("dealsBrowse.cardClaimsLeft", { count: remainingClaims })}
            </Text>
          )}
        </View>
      </HapticScalePressable>

      {/* Bottom action bar */}
      <View
        style={{
          paddingHorizontal: Spacing.xxl,
          paddingVertical: Spacing.xxl,
          gap: Spacing.lg,
          borderTopWidth: 1,
          borderTopColor: "#f0f0f0",
        }}
      >
        {/* Favorite row */}
        <Reanimated.View style={favoriteAnimatedStyle}>
          <Pressable
            onPress={onToggleFavorite}
            onPressIn={() => {
              triggerLightHaptic();
              favoriteScale.value = springPressIn();
            }}
            onPressOut={() => {
              favoriteScale.value = springPressOut();
            }}
            style={({ pressed }: PressableStateCallbackType) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: Spacing.sm,
              padding: Spacing.md,
              borderRadius: 24,
              backgroundColor: pressed ? "#f8f8f8" : "transparent",
            })}
          >
            <MaterialIcons
              name={isFavorite ? "favorite" : "favorite-border"}
              size={24}
              color={isFavorite ? Colors.light.primary : "#6b7280"}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "600" }}>
                {isFavorite ? t("dealsBrowse.cardSaved") : t("dealsBrowse.cardSaveFavorite")}
              </Text>
            </View>
          </Pressable>
        </Reanimated.View>

        {/* Big orange Claim button — DoorDash style */}
        <PrimaryButton
          title={
            claiming
              ? t("dealDetail.claiming")
              : dealStatus === "claimed"
              ? t("dealStatus.claimed")
              : dealStatus === "redeemed"
              ? t("dealStatus.redeemed")
              : dealStatus === "expired"
              ? t("dealStatus.expired")
              : t("dealDetail.claim")
          }
          onPress={onClaim}
          disabled={claiming || dealStatus !== "live"}
          style={{
            backgroundColor: dealStatus === "live" ? Colors.light.primary : "rgba(255, 159, 28, 0.22)",
            boxShadow: dealStatus === "live" ? "0px 10px 18px rgba(0,0,0,0.18)" : "0px 3px 10px rgba(0,0,0,0.06)",
            elevation: dealStatus === "live" ? 10 : 2,
          }}
        />

        {statusMessage && (
          <View style={{ backgroundColor: statusColors.background, borderRadius: 24, padding: Spacing.md }}>
            <Text style={{ color: statusColors.text, fontWeight: "600" }}>{statusMessage}</Text>
          </View>
        )}
      </View>
    </View>
  );
}
