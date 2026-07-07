import { Image, Pressable, Text, View } from "react-native";
import { Colors, Controls, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

type EmptyStateProps = {
  title: string;
  message: string;
  /** Optional primary action (e.g. "Browse shops"). Renders a button when both are set. */
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
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
            source={require("../../assets/images/twofer-mark-512.png")}
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
              borderRadius: Radii.md,
              minHeight: Controls.buttonHeight,
              justifyContent: "center",
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
      </View>
    </View>
  );
}
