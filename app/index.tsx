import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Text, View } from "react-native";
import { Redirect, useGlobalSearchParams } from "expo-router";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTabMode } from "@/lib/tab-mode";
import { isAuthBypassEnabled } from "@/lib/auth-bypass";

export default function Index() {
  const params = useGlobalSearchParams<{ e2e?: string }>();
  const browserE2EParam =
    Platform.OS === "web" && globalThis.window !== undefined
      ? new URLSearchParams(globalThis.window.location.search).get("e2e") ?? undefined
      : undefined;
  const forceE2E = isAuthBypassEnabled({
    e2e: browserE2EParam ?? String(params.e2e ?? ""),
    isDev: __DEV__,
  });
  const { session, isInitialLoading } = useAuthSession();
  const { mode, ready: tabModeReady } = useTabMode();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const [showSlowLoadHint, setShowSlowLoadHint] = useState(false);

  const authGateLoading = isInitialLoading || (Boolean(session?.user) && !tabModeReady);

  useEffect(() => {
    if (!__DEV__) return;
    if (!authGateLoading) {
      setShowSlowLoadHint(false);
      return;
    }
    const id = setTimeout(() => setShowSlowLoadHint(true), 8000);
    return () => clearTimeout(id);
  }, [authGateLoading]);

  if (forceE2E) {
    return <Redirect href="/(tabs)/account?e2e=1" />;
  }

  if (authGateLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.primary} />
        {__DEV__ && showSlowLoadHint ? (
          <Text
            style={{
              marginTop: 16,
              paddingHorizontal: 24,
              textAlign: "center",
              opacity: 0.55,
              fontSize: 13,
              color: theme.text,
            }}
          >
            Still loading auth / tab mode — if this persists, check Metro, dev client, or run npm run start:go (Expo Go).
          </Text>
        ) : null}
      </View>
    );
  }

  if (session?.user) {
    return <Redirect href={mode === "business" ? "/(tabs)/create" : "/(tabs)"} />;
  }

  return <Redirect href="/auth-landing" />;
}
