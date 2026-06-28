import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Image } from "expo-image";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Reanimated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { Spacing } from "@/lib/screen-layout";
import { Colors, PrimaryTint, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { formatAppDateTime } from "@/lib/i18n/format-datetime";
import { useMinuteTick } from "@/hooks/use-minute-tick";
import { formatConsumerCountdown } from "@/lib/consumer-countdown";
import { DealStatusPill, type ConsumerDealStatusKey } from "@/components/deal-status-pill";
import { PrimaryButton } from "@/components/ui/primary-button";
import { springPressIn, springPressOut, triggerLightHaptic } from "@/lib/press-feedback";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";
import { DemoOfferNotice } from "@/components/demo-offer-notice";

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
  isDemoOffer?: boolean;
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
  isDemoOffer = false,
}: DealCardPosterProps) {
  const { t, i18n } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const minuteTick = useMinuteTick();

  const favoriteScale = useSharedValue(1);
  const favoriteAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: favoriteScale.value }] }));

  const countdown =
    showLiveCountdown && dealStatus === "live"
      ? formatConsumerCountdown(endTime, minuteTick, t)
      : null;

  const statusColors = {
    success:
      colorScheme === "dark"
        ? { background: "rgba(255,159,28,0.18)", text: theme.accentText }
        : { background: PrimaryTint.surfaceStrong, text: "#B45309" },
    error:
      colorScheme === "dark"
        ? { background: "rgba(248,113,113,0.16)", text: theme.danger }
        : { background: "#FEF2F2", text: "#B91C1C" },
    info:
      colorScheme === "dark"
        ? { background: "rgba(255,159,28,0.14)", text: theme.accentText }
        : { background: "#fff3e0", text: "#B45309" },
  }[statusTone];

  return (
    <View
      style={{
        borderRadius: Radii.lg,
        backgroundColor: theme.surface,
        overflow: "hidden",
        marginBottom: Spacing.xxl,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <HapticScalePressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        {posterUrl ? (
          <Image
            source={{ uri: posterUrl }}
            style={{ aspectRatio: 1, width: "100%" }}
            contentFit="cover"
            transition={300}
            placeholder={{ blurhash: "LKG8wh~qIU%M_3xut7RjD%ofWBt7" }}
            cachePolicy="memory-disk"
          />
        ) : (
          <View
            style={{
              aspectRatio: 1,
              width: "100%",
              backgroundColor: theme.surfaceMuted,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{ color: theme.mutedText, fontSize: 15, fontWeight: "600", textAlign: "center", paddingHorizontal: Spacing.md }}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              maxFontSizeMultiplier={1.15}
            >
              {t("dealDetail.noImage")}
            </Text>
          </View>
        )}

        <View style={{ padding: Spacing.xxl }}>
          {/* Status + countdown badge row */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.md }}>
            <DealStatusPill status={dealStatus} />
            {countdown && (
              <View
                style={{
                  backgroundColor: theme.primary,
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                  maxWidth: "100%",
                }}
              >
                <Text
                  style={{ fontSize: 13, fontWeight: "700", color: theme.primaryText }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                  maxFontSizeMultiplier={1.15}
                >
                  {countdown}
                </Text>
              </View>
            )}
          </View>

          {businessName && (
            <View style={{ marginBottom: Spacing.xs }}>
              <Text
                style={{ fontSize: 13, fontWeight: "700", color: theme.mutedText, textTransform: "uppercase", letterSpacing: 0.5 }}
                numberOfLines={2}
                maxFontSizeMultiplier={1.15}
              >
                {businessName}
              </Text>
              {distanceLabel && (
                <Text style={{ fontSize: 12, marginTop: 2, color: theme.mutedText }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                  {distanceLabel}
                </Text>
              )}
            </View>
          )}

          {isDemoOffer ? (
            <View style={{ marginBottom: Spacing.md }}>
              <DemoOfferNotice compact />
            </View>
          ) : null}

          <Text style={{ fontSize: 22, fontWeight: "700", lineHeight: 28, color: theme.text }} numberOfLines={3} maxFontSizeMultiplier={1.15}>
            {title}
          </Text>

          {price != null && (
            <Text
              style={{ marginTop: Spacing.sm, fontSize: 20, fontWeight: "700", color: theme.accentText }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              maxFontSizeMultiplier={1.15}
            >
              ${price.toFixed(2)}
            </Text>
          )}

          {description && (
            <Text style={{ marginTop: Spacing.sm, color: theme.text, opacity: 0.75, fontSize: 15.5, lineHeight: 23 }} maxFontSizeMultiplier={1.15}>
              {description.length > 160 ? `${description.slice(0, 160)}…` : description}
            </Text>
          )}

          <Text style={{ marginTop: Spacing.md, color: theme.text, opacity: 0.6, fontSize: 14 }} numberOfLines={2} maxFontSizeMultiplier={1.15}>
            {t("dealsBrowse.dealEnds", { time: formatAppDateTime(endTime, i18n.language) })}
          </Text>

          {remainingClaims != null && (
            <Text style={{ marginTop: Spacing.xs, color: theme.text, opacity: 0.6, fontSize: 14 }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
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
          borderTopColor: theme.border,
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
              borderRadius: Radii.lg,
              backgroundColor: pressed ? theme.surfaceMuted : "transparent",
            })}
          >
            <MaterialIcons
              name={isFavorite ? "favorite" : "favorite-border"}
              size={24}
              color={isFavorite ? theme.favorite : theme.icon}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{ fontSize: 16, fontWeight: "600", color: theme.text }}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                maxFontSizeMultiplier={1.15}
              >
                {isFavorite ? t("dealsBrowse.cardSaved") : t("dealsBrowse.cardSaveFavorite")}
              </Text>
            </View>
          </Pressable>
        </Reanimated.View>

        {/* Big orange Claim button — DoorDash style */}
        <PrimaryButton
          title={
            isDemoOffer
              ? t("demoOffer.label", { defaultValue: "Demo offer" })
              : claiming
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
          disabled={isDemoOffer || claiming || dealStatus !== "live"}
          style={{
            backgroundColor:
              dealStatus === "live"
                ? theme.primary
                : colorScheme === "dark"
                  ? theme.surfaceMuted
                  : "rgba(255, 159, 28, 0.22)",
          }}
        />

        {statusMessage && (
          <View style={{ backgroundColor: statusColors.background, borderRadius: 24, padding: Spacing.md }}>
            <Text style={{ color: statusColors.text, fontWeight: "600" }} maxFontSizeMultiplier={1.15}>
              {statusMessage}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
