/**
 * Deprecated: AI Compose is now handled by the unified Create screen (ai.tsx).
 * Voice input and quota display are built into the unified screen.
 * This file redirects to /create/ai preserving all params.
 */
import { useEffect, useRef } from "react";
import { View, Text } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";

export default function AiComposeRedirect() {
  const router = useRouter();
  const params = useLocalSearchParams();
  // useLocalSearchParams returns a fresh object every render, so depending on it
  // directly re-ran this redirect in a loop — the screen sat on "Redirecting..."
  // for seconds and the churn re-fired downstream hooks (useBusiness stale-refresh
  // spam). Fire the one-shot redirect exactly once; params are available at mount.
  const redirected = useRef(false);
  useEffect(() => {
    if (redirected.current) return;
    redirected.current = true;
    router.replace({
      pathname: "/create/ai",
      params: params as Record<string, string>,
    } as Href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ opacity: 0.5 }}>Redirecting...</Text>
    </View>
  );
}
