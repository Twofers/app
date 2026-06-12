import { Image, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

type EmptyStateProps = {
  title: string;
  message: string;
  /** Optional primary action (e.g. "Browse shops"). Renders a button when both are set. */
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? "light";
  const c = Colors[colorScheme];

  return (
    <View style={{ width: "100%", alignItems: "center", paddingVertical: 32 }}>
      <View
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 24,
          paddingVertical: 28,
          paddingHorizontal: 24,
          borderWidth: 1,
          borderColor: colorScheme === "dark" ? "rgba(255,159,28,0.22)" : "rgba(255,159,28,0.18)",
          backgroundColor: c.background,
          alignItems: "center",
          gap: 10,
        }}
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: "rgba(255,159,28,0.14)",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 2,
          }}
        >
          <Image
            source={require("../../assets/images/penguin-auth-512.png")}
            style={{ width: 34, height: 34, opacity: 0.95 }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </View>

        <Text
          style={{ fontSize: 17, fontWeight: "800", color: c.text, textAlign: "center" }}
          numberOfLines={3}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
          maxFontSizeMultiplier={1.15}
        >
          {title}
        </Text>
        <Text style={{ fontSize: 14, opacity: 0.72, lineHeight: 22, color: c.text, textAlign: "center" }} maxFontSizeMultiplier={1.2}>
          {message}
        </Text>

        {actionLabel && onAction ? (
          <Pressable
            onPress={onAction}
            accessibilityRole="button"
            style={{
              marginTop: 10,
              maxWidth: "100%",
              backgroundColor: c.primary,
              borderRadius: 999,
              paddingVertical: 12,
              paddingHorizontal: 28,
              alignItems: "center",
            }}
          >
            <Text
              style={{ color: c.primaryText, fontWeight: "800", fontSize: 15, textAlign: "center" }}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              maxFontSizeMultiplier={1.15}
            >
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginTop: 2,
            maxWidth: "100%",
          }}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.primary }} />
          <Text
            style={{ flexShrink: 1, fontSize: 13, color: c.primary, opacity: 0.95, lineHeight: 18, textAlign: "center" }}
            numberOfLines={2}
            maxFontSizeMultiplier={1.15}
          >
            {t("emptyState.encouragement")}
          </Text>
        </View>
      </View>
    </View>
  );
}
