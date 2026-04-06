/**
 * Deprecated: Quick Deal is now handled by the unified Create screen (ai.tsx).
 * This file redirects to /create/ai preserving all prefill params.
 */
import { useEffect } from "react";
import { View, Text } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";

export default function QuickDealRedirect() {
  const router = useRouter();
  const params = useLocalSearchParams();

  useEffect(() => {
    // Forward all params to the unified create screen
    router.replace({
      pathname: "/create/ai",
      params: params as Record<string, string>,
    } as Href);
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ opacity: 0.5 }}>Redirecting...</Text>
    </View>
  );
}
