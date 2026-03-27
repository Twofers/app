import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { Redirect, useGlobalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";

/** AsyncStorage key used by tab-mode.tsx */
const TAB_MODE_KEY = "twoforone_tab_mode_v2";

export default function Index() {
  const params = useGlobalSearchParams<{ e2e?: string }>();
  const forceE2E =
    Platform.OS === "web" &&
    ((params.e2e === "1") ||
      (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("e2e") === "1"));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (forceE2E) {
      setReady(true);
      return;
    }
    // On every cold start: sign out AND reset tab mode to "customer" so the
    // app always opens at the login screen and lands on the deals feed —
    // never inside the business setup flow.
    void Promise.all([
      supabase.auth.signOut(),
      AsyncStorage.setItem(TAB_MODE_KEY, "customer"),
    ]).finally(() => setReady(true));
  }, [forceE2E]);

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

  return <Redirect href="/auth-landing" />;
}
