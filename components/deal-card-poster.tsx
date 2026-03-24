import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Spacing } from "@/lib/screen-layout";

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
}: DealCardPosterProps) {
  const { height: windowHeight } = useWindowDimensions();
  /** Immersive feed: image ~40–48% of viewport height, clamped for very small/large phones. */
  const imageHeight = Math.round(
    Math.min(400, Math.max(248, windowHeight * 0.44)),
  );

  const statusColors = {
    success: { background: "#e8f5e9", text: "#1b5e20" },
    error: { background: "#fde8e8", text: "#7a1f1f" },
    info: { background: "#eef2ff", text: "#1e3a8a" },
  }[statusTone];

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
          <Image
            source={{ uri: posterUrl }}
            style={{ height: imageHeight, width: "100%" }}
            contentFit="cover"
          />
        ) : (
          <View
            style={{
              height: imageHeight,
              backgroundColor: "#ececec",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#666", fontSize: 15 }}>No image</Text>
          </View>
        )}
        <View style={{ padding: Spacing.lg }}>
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
            <Text style={{ marginTop: Spacing.sm, fontSize: 18, fontWeight: "700" }}>
              ${price.toFixed(2)}
            </Text>
          ) : null}
          {description ? (
            <Text style={{ marginTop: Spacing.sm, opacity: 0.78, fontSize: 15, lineHeight: 22 }}>
              {description.length > 140 ? `${description.slice(0, 140)}…` : description}
            </Text>
          ) : null}
          <Text style={{ marginTop: Spacing.md, opacity: 0.65, fontSize: 14 }}>
            Ends {new Date(endTime).toLocaleString()}
          </Text>
          {typeof remainingClaims === "number" ? (
            <Text style={{ marginTop: Spacing.xs, opacity: 0.65, fontSize: 14 }}>
              {remainingClaims} claims left
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
          hitSlop={8}
          style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm }}
        >
          <MaterialIcons
            name={isFavorite ? "favorite" : "favorite-border"}
            size={22}
            color={isFavorite ? "#e0245e" : "#666"}
          />
          <Text style={{ color: "#444", fontSize: 16, fontWeight: "600" }}>
            {isFavorite ? "Saved" : "Save to favorites"}
          </Text>
        </Pressable>
        <Pressable
          onPress={onClaim}
          disabled={claiming}
          style={{
            paddingVertical: Spacing.md + 2,
            borderRadius: 14,
            backgroundColor: "#111",
            opacity: claiming ? 0.65 : 1,
          }}
        >
          <Text style={{ color: "white", fontWeight: "700", textAlign: "center", fontSize: 16 }}>
            {claiming ? "Claiming…" : "Claim deal"}
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
