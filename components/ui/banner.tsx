import { Pressable, Text, View } from "react-native";
import { Gray, PrimaryTint, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import i18n from "@/lib/i18n/config";

type BannerProps = {
  message: string;
  tone?: "error" | "success" | "info" | "warning";
  onRetry?: () => void;
};

// No greens/blues in chrome: success + warning render in brand orange,
// info in neutral gray, error in the destructive red family.
export function Banner({ message, tone = "info", onRetry }: BannerProps) {
  const isDark = useColorScheme() === "dark";
  const stylesByTone = isDark
    ? {
        error: { backgroundColor: "#3b1111", borderColor: "#7f1d1d", textColor: "#fca5a5" },
        success: { backgroundColor: "#3b2a0d", borderColor: PrimaryTint.border, textColor: "#FFB454" },
        info: { backgroundColor: "#202427", borderColor: "#2a2f33", textColor: "#b4bcc5" },
        warning: { backgroundColor: "#3b2a0d", borderColor: "#854d0e", textColor: "#fcd34d" },
      }[tone]
    : {
        error: { backgroundColor: "#FEF2F2", borderColor: "#FECACA", textColor: "#B91C1C" },
        success: { backgroundColor: PrimaryTint.surface, borderColor: PrimaryTint.border, textColor: "#B45309" },
        info: { backgroundColor: Gray[100], borderColor: Gray[200], textColor: Gray[700] },
        warning: { backgroundColor: "#FFF3E0", borderColor: "#ffd7a3", textColor: "#B45309" },
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
      <Text style={{ color: stylesByTone.textColor, fontWeight: "600", lineHeight: 20 }} maxFontSizeMultiplier={1.2}>
        {message}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={{ marginTop: 6 }}
        >
          <Text
            style={{ color: stylesByTone.textColor, fontWeight: "700", textDecorationLine: "underline", fontSize: 13 }}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            maxFontSizeMultiplier={1.15}
          >
            {i18n.t("commonUi.tapToRetry")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
