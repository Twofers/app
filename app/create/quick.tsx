/**
 * Deprecated: Quick Deal now uses the unified AI builder.
 * Keep this route as a compatibility redirect for old links and stale navigation.
 */
import { useEffect } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function redirectedParams(params: Record<string, string | string[]>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const first = firstParam(value);
    if (first != null) next[key] = first;
  }
  next.fromCreateHub = "1";
  return next;
}

export default function QuickDealRedirect() {
  const router = useRouter();
  const params = useLocalSearchParams();

  useEffect(() => {
    router.replace({
      pathname: "/create/ai",
      params: redirectedParams(params),
    } as Href);
  }, [params, router]);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ opacity: 0.5 }}>Redirecting...</Text>
    </View>
  );
}
