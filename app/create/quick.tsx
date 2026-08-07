/**
 * Deprecated: Quick Deal now uses the unified AI builder.
 * Keep this route as a compatibility redirect for old links and stale navigation.
 */
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Colors } from "@/constants/theme";

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
  const theme = Colors[useColorScheme() === "dark" ? "dark" : "light"];
  // useLocalSearchParams returns a fresh object every render; depending on it re-ran
  // this redirect in a loop (visible "Redirecting..." stall + downstream re-render
  // churn). Fire once on mount — the params are available at first render.
  const redirected = useRef(false);
  useEffect(() => {
    if (redirected.current) return;
    redirected.current = true;
    router.replace({
      pathname: "/create/ai",
      params: redirectedParams(params),
    } as Href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ color: theme.mutedText }}>Redirecting...</Text>
    </View>
  );
}
