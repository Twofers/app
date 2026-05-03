import { Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useTranslation } from "react-i18next";
import { Spacing } from "@/lib/screen-layout";
import { Colors } from "@/constants/theme";
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

  return (
    <HapticScalePressable
      onPress={onPress}
      style={{
        borderRadius: 18,
        backgroundColor: theme.surface,
        padding: Spacing.md,
        marginBottom: Spacing.md,
        boxShadow: "0px 3px 10px rgba(0,0,0,0.07)",
        elevation: 2,
      }}
    >
      <View style={{ flexDirection: "row", gap: Spacing.md, alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: "700", fontSize: 17 }} numberOfLines={2}>
            {name}
          </Text>
          {address ? (
            <Text style={{ marginTop: Spacing.xs, opacity: 0.65, fontSize: 14 }} numberOfLines={2}>
              {address}
            </Text>
          ) : null}
          {distanceLabel ? (
            <Text style={{ marginTop: Spacing.xs, fontSize: 12, opacity: 0.5 }}>{distanceLabel}</Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginTop: Spacing.sm }}>
            {hasLiveDeal ? (
              <View
                style={{
                  alignSelf: "flex-start",
                  paddingHorizontal: Spacing.sm,
                  paddingVertical: 4,
                  borderRadius: 8,
                  backgroundColor: "#dcfce7",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#166534" }}>
                  {t("dealStatus.liveDeal")}
                </Text>
              </View>
            ) : (
              <View
                style={{
                  alignSelf: "flex-start",
                  paddingHorizontal: Spacing.sm,
                  paddingVertical: 4,
                  borderRadius: 8,
                  backgroundColor: "#f4f4f5",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: "#52525b" }}>
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
            padding: 6,
            borderRadius: 22,
            backgroundColor: isFavorite ? "rgba(224,36,94,0.12)" : pressed ? "#f4f4f5" : "transparent",
          })}
        >
          <MaterialIcons name={isFavorite ? "favorite" : "favorite-border"} size={26} color={isFavorite ? "#e0245e" : "#666"} />
        </HapticScalePressable>
      </View>
    </HapticScalePressable>
  );
}
