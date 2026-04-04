import { Text, View } from "react-native";
import { Radii } from "@/constants/theme";

type BannerProps = {
  message: string;
  tone?: "error" | "success" | "info" | "warning";
};

export function Banner({ message, tone = "info" }: BannerProps) {
  const stylesByTone = {
    error: { backgroundColor: "#fde8e8", borderColor: "#f5b5b5", textColor: "#7a1f1f" },
    success: { backgroundColor: "#e8f5e9", borderColor: "#b7dfbf", textColor: "#1b5e20" },
    info: { backgroundColor: "#eef2ff", borderColor: "#c7d2fe", textColor: "#1e3a8a" },
    warning: { backgroundColor: "#fff3e0", borderColor: "#ffd7a3", textColor: "#c26100" },
  }[tone];

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        borderWidth: 1,
        borderColor: stylesByTone.borderColor,
        backgroundColor: stylesByTone.backgroundColor,
        padding: 12,
        borderRadius: Radii.md,
        marginTop: 12,
      }}
    >
      <Text style={{ color: stylesByTone.textColor, fontWeight: "600", lineHeight: 20 }}>{message}</Text>
    </View>
  );
}
