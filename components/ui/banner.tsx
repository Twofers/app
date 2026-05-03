import { Pressable, Text, View } from "react-native";
import { Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import i18n from "@/lib/i18n/config";

type BannerProps = {
  message: string;
  tone?: "error" | "success" | "info" | "warning";
  onRetry?: () => void;
};

export function Banner({ message, tone = "info", onRetry }: BannerProps) {
  const isDark = useColorScheme() === "dark";
  const stylesByTone = isDark
    ? {
        error: { backgroundColor: "#3b1111", borderColor: "#7f1d1d", textColor: "#fca5a5" },
        success: { backgroundColor: "#0d2818", borderColor: "#166534", textColor: "#86efac" },
        info: { backgroundColor: "#1a1f3d", borderColor: "#3b4fa8", textColor: "#a5b4fc" },
        warning: { backgroundColor: "#3b2a0d", borderColor: "#854d0e", textColor: "#fcd34d" },
      }[tone]
    : {
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
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={{ marginTop: 6 }}
        >
          <Text style={{ color: stylesByTone.textColor, fontWeight: "700", textDecorationLine: "underline", fontSize: 13 }}>
            {i18n.t("commonUi.tapToRetry")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
