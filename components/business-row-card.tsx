import { Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useTranslation } from "react-i18next";
import { Spacing } from "@/lib/screen-layout";
import { Colors, PrimaryTint, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";

type BusinessRowCardProps = {
  name: string;
  address?: string | null;
  hasLiveDeal: boolean;
  isFavorite: boolean;
  distanceLabel?: string | null;
  onPress: () => void;
  onToggleFavorite: () => void;
};

export function BusinessRowCard({
  name,
  address,
  hasLiveDeal,
  isFavorite,
  distanceLabel,
  onPress,
  onToggleFavorite,
}: BusinessRowCardProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const initial = name.trim().charAt(0).toUpperCase() || "T";

  return (
    <HapticScalePressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: Radii.lg,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: pressed ? theme.primary : theme.border,
        padding: Spacing.md,
        marginBottom: Spacing.md,
      })}
    >
      <View style={{ flexDirection: "row", gap: Spacing.md, alignItems: "stretch" }}>
        <View
          style={{
            width: 58,
            minHeight: 76,
            borderRadius: Radii.lg,
            backgroundColor: colorScheme === "dark" ? "rgba(255,159,28,0.18)" : "rgba(255,159,28,0.12)",
            borderWidth: 1,
            borderColor: colorScheme === "dark" ? "rgba(255,159,28,0.32)" : "rgba(255,159,28,0.24)",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
          }}
        >
          <MaterialIcons name="storefront" size={22} color={theme.primary} />
          <Text style={{ fontSize: 18, fontWeight: "900", color: theme.accentText }} numberOfLines={1}>
            {initial}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: "800", fontSize: 17, lineHeight: 22, color: theme.text }} numberOfLines={2}>
            {name}
          </Text>
          {address ? (
            <Text style={{ marginTop: Spacing.xs, color: theme.mutedText, fontSize: 14, lineHeight: 19 }} numberOfLines={2}>
              {address}
            </Text>
          ) : null}
          {distanceLabel ? (
            <Text style={{ marginTop: Spacing.xs, fontSize: 13, color: theme.accentText, fontWeight: "700" }} numberOfLines={1}>
              {distanceLabel}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginTop: Spacing.sm }}>
            {hasLiveDeal ? (
              <View
                style={{
                  alignSelf: "flex-start",
                  paddingHorizontal: Spacing.md,
                  paddingVertical: 4,
                  borderRadius: Radii.pill,
                  backgroundColor: PrimaryTint.surfaceStrong,
                  borderWidth: 1,
                  borderColor: PrimaryTint.border,
                  maxWidth: "100%",
                }}
              >
                <Text
                  style={{ fontSize: 12, fontWeight: "800", color: theme.accentText }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.76}
                  maxFontSizeMultiplier={1.15}
                >
                  {t("dealStatus.liveDeal")}
                </Text>
              </View>
            ) : (
              <View
                style={{
                  alignSelf: "flex-start",
                  paddingHorizontal: Spacing.md,
                  paddingVertical: 4,
                  borderRadius: Radii.pill,
                  backgroundColor: theme.surfaceMuted,
                  borderWidth: 1,
                  borderColor: theme.border,
                  maxWidth: "100%",
                }}
              >
                <Text
                  style={{ fontSize: 12, fontWeight: "700", color: theme.mutedText }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.76}
                  maxFontSizeMultiplier={1.15}
                >
                  {t("dealStatus.noLiveDeal")}
                </Text>
              </View>
            )}
          </View>
        </View>
        <HapticScalePressable
          onPress={onToggleFavorite}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityState={{ selected: isFavorite }}
          accessibilityLabel={isFavorite ? t("dealDetail.favorited") : t("dealDetail.favorite")}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isFavorite
              ? colorScheme === "dark"
                ? "rgba(240,70,122,0.18)"
                : "rgba(224,36,94,0.12)"
              : pressed
                ? theme.surfaceMuted
                : theme.surface,
            borderWidth: 1,
            borderColor: isFavorite ? theme.favorite : theme.border,
          })}
        >
          <MaterialIcons name={isFavorite ? "favorite" : "favorite-border"} size={26} color={isFavorite ? theme.favorite : theme.icon} />
        </HapticScalePressable>
      </View>
    </HapticScalePressable>
  );
}
