import { ActivityIndicator, Platform, View } from "react-native";
import { Redirect, useGlobalSearchParams } from "expo-router";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

export default function Index() {
  const params = useGlobalSearchParams<{ e2e?: string }>();
  const forceE2E =
    Platform.OS === "web" &&
    ((params.e2e === "1") ||
      (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("e2e") === "1"));
  const { session, isInitialLoading } = useAuthSession();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  if (forceE2E) {
    return <Redirect href="/(tabs)/account?e2e=1" />;
  }

  if (isInitialLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (session?.user) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/auth-landing" />;
}
