import { Text, View } from "react-native";

type BannerProps = {
  message: string;
  tone?: "error" | "success" | "info";
};

export function Banner({ message, tone = "info" }: BannerProps) {
  const stylesByTone = {
    error: { backgroundColor: "#fde8e8", borderColor: "#f5b5b5", textColor: "#7a1f1f" },
    success: { backgroundColor: "#e8f5e9", borderColor: "#b7dfbf", textColor: "#1b5e20" },
    info: { backgroundColor: "#eef2ff", borderColor: "#c7d2fe", textColor: "#1e3a8a" },
  }[tone];

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: stylesByTone.borderColor,
        backgroundColor: stylesByTone.backgroundColor,
        padding: 10,
        borderRadius: 12,
        marginTop: 12,
      }}
    >
      <Text style={{ color: stylesByTone.textColor, fontWeight: "600" }}>{message}</Text>
    </View>
  );
}
