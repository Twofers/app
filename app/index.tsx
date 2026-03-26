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
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setHasSession(!!data.session?.user);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session?.user);
      setReady(true);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#ffffff" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (forceE2E) {
    return <Redirect href="/(tabs)/account?e2e=1" />;
  }

  if (!hasSession) {
    return <Redirect href="/auth-landing" />;
  }

  return <Redirect href="/(tabs)" />;
}
