import { Image, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

type EmptyStateProps = {
  title: string;
  message: string;
};

export function EmptyState({ title, message }: EmptyStateProps) {
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
            source={require("../../assets/images/splash-icon.png")}
            style={{ width: 34, height: 34, opacity: 0.95 }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </View>

        <Text style={{ fontSize: 17, fontWeight: "800", color: c.text, textAlign: "center" }}>{title}</Text>
        <Text style={{ fontSize: 14, opacity: 0.72, lineHeight: 22, color: c.text, textAlign: "center" }}>{message}</Text>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginTop: 2,
          }}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.primary }} />
          <Text style={{ fontSize: 13, color: c.primary, opacity: 0.95, lineHeight: 18, textAlign: "center" }}>
            {t("emptyState.encouragement")}
          </Text>
        </View>
      </View>
    </View>
  );
}
