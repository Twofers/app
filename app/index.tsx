import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { Redirect, useGlobalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";

export default function Index() {
  const params = useGlobalSearchParams<{ e2e?: string }>();
  const forceE2E =
    Platform.OS === "web" &&
    ((params.e2e === "1") ||
      (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("e2e") === "1"));
  const [destination, setDestination] = useState<"tabs" | "login" | null>(null);

  useEffect(() => {
    if (forceE2E) {
      setDestination("tabs");
      return;
    }
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setDestination(data.session?.user ? "tabs" : "login");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (destination === null) {
        setDestination(session?.user ? "tabs" : "login");
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [forceE2E]);

  if (destination === null) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#ffffff" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (forceE2E) {
    return <Redirect href="/(tabs)/account?e2e=1" />;
  }

  if (destination === "tabs") {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/auth-landing" />;
}
