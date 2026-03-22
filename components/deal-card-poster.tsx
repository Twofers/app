import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

type DealCardPosterProps = {
  title: string;
  description?: string | null;
  businessName?: string | null;
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
        marginBottom: 12,
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      }}
    >
      <Pressable onPress={onPress}>
        {posterUrl ? (
          <Image source={{ uri: posterUrl }} style={{ height: 200, width: "100%" }} contentFit="cover" />
        ) : (
          <View style={{ height: 200, backgroundColor: "#e5e5e5", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#666" }}>No image</Text>
          </View>
        )}
        <View style={{ padding: 12 }}>
          {businessName ? (
            <Text style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>{businessName}</Text>
          ) : null}
          <Text style={{ fontSize: 18, fontWeight: "700" }}>{title}</Text>
          {price != null ? (
            <Text style={{ marginTop: 6, fontWeight: "600" }}>${price.toFixed(2)}</Text>
          ) : null}
          {description ? (
            <Text style={{ marginTop: 6, opacity: 0.75 }}>
              {description.length > 90 ? `${description.slice(0, 90)}...` : description}
            </Text>
          ) : null}
          <Text style={{ marginTop: 8, opacity: 0.7 }}>
            Ends at {new Date(endTime).toLocaleString()}
          </Text>
          {typeof remainingClaims === "number" ? (
            <Text style={{ marginTop: 4, opacity: 0.7 }}>
              Remaining claims: {remainingClaims}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
        <Pressable
          onPress={onToggleFavorite}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}
        >
          <MaterialIcons name={isFavorite ? "favorite" : "favorite-border"} size={20} color={isFavorite ? "#e0245e" : "#666"} />
          <Text style={{ color: "#666" }}>{isFavorite ? "Favorited" : "Favorite"}</Text>
        </Pressable>
        <Pressable
          onPress={onClaim}
          disabled={claiming}
          style={{
            paddingVertical: 12,
            borderRadius: 12,
            backgroundColor: "#111",
            opacity: claiming ? 0.7 : 1,
          }}
        >
          <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>
            {claiming ? "Claiming..." : "Claim"}
          </Text>
        </Pressable>
        {statusMessage ? (
          <View
            style={{
              marginTop: 8,
              backgroundColor: statusColors.background,
              borderRadius: 10,
              paddingVertical: 6,
              paddingHorizontal: 10,
            }}
          >
            <Text style={{ color: statusColors.text, fontSize: 12, fontWeight: "600" }}>
              {statusMessage}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
