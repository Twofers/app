import { Image, Pressable, Text, View, useColorScheme as useNativeColorScheme } from "react-native";

import { Colors, Controls, Radii, Spacing } from "@/constants/theme";

export function MobileOnlyWebFallback() {
  const colorScheme = useNativeColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const canGoHome = typeof window !== "undefined" && window.location.pathname !== "/";

  return (
    <View
      style={{
        flex: 1,
        minHeight: "100vh" as unknown as number,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.background,
        padding: Spacing.xl,
      }}
    >
      <View
        style={{
          width: "100%",
          maxWidth: 440,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: Radii.lg,
          backgroundColor: theme.surface,
          padding: Spacing.xxl,
          alignItems: "center",
          gap: Spacing.md,
        }}
      >
        <Image
          source={require("../assets/images/twofer-mark-512.png")}
          style={{ width: 72, height: 72 }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <Text style={{ color: theme.text, fontSize: 28, lineHeight: 34, fontWeight: "900", textAlign: "center" }}>
          Twofer
        </Text>
        <Text style={{ color: theme.text, fontSize: 18, lineHeight: 26, fontWeight: "800", textAlign: "center" }}>
          Twofer is currently available in the mobile app.
        </Text>
        <Text style={{ color: theme.mutedText, fontSize: 15, lineHeight: 22, textAlign: "center" }}>
          App Store and Google Play links are coming soon.
        </Text>
        {canGoHome ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go home"
            onPress={() => {
              window.location.assign("/");
            }}
            style={{
              marginTop: Spacing.sm,
              minHeight: Controls.buttonHeight,
              borderRadius: Radii.md,
              backgroundColor: theme.primary,
              paddingHorizontal: 28,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: theme.primaryText, fontSize: 16, fontWeight: "800" }}>Go home</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
