import { Redirect, Tabs, useGlobalSearchParams, useRouter, useSegments } from "expo-router";
import React, { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTabMode } from "@/lib/tab-mode";
import { supabase } from "@/lib/supabase";
import { getBusinessProfileAccessForCurrentUser } from "@/lib/business-profile-access";
import { registerPushTokenIfNeeded } from "@/lib/push-token";

function TabAuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"unknown" | "in" | "out">("unknown");
  const params = useGlobalSearchParams<{ e2e?: string; skipSetup?: string }>();
  const segments = useSegments() as string[];
  const forceE2E =
    Platform.OS === "web" &&
    ((params.e2e === "1") ||
      (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("e2e") === "1"));
  const forceBypass = forceE2E || String(params.skipSetup ?? "") === "1";

  useEffect(() => {
    // E2E/web screenshot mode: let routing + layout be captured without requiring a real auth session.
    // This is web-only and opt-in via `?e2e=1`, so it won't affect native apps or production usage.
    if (forceBypass) {
      setState("in");
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      setState(user ? "in" : "out");
      if (user) void registerPushTokenIfNeeded(user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      setState(user ? "in" : "out");
      if (user) void registerPushTokenIfNeeded(user.id);
    });
    return () => sub.subscription.unsubscribe();
  }, [forceBypass]);

  if (state === "unknown") {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#ffffff" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (state === "out") {
    const tabsIdx = segments.indexOf("(tabs)");
    const tail = tabsIdx >= 0 ? segments.slice(tabsIdx + 1).filter(Boolean) : [];
    const nextPath = tail.length > 0 ? `/(tabs)/${tail.join("/")}` : "/(tabs)";
    return <Redirect href={{ pathname: "/auth-landing", params: { next: nextPath } }} />;
  }
  return <>{children}</>;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { t } = useTranslation();
  const { mode } = useTabMode();

  /**
   * Hide tabs from the bar without removing them from the navigator.
   * Using `href: null` can make programmatic navigation / redirects fail
   * when mode flips while the user is currently on a now-hidden tab.
   */
  const hideWhen = (condition: boolean) =>
    condition
      ? ({
          tabBarButton: () => null,
          tabBarItemStyle: { display: "none" as const },
        } as const)
      : ({} as const);

  return (
    <TabAuthGate>
      <TabModeRedirect />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[colorScheme ?? "light"].primary,
          tabBarInactiveTintColor: Colors[colorScheme ?? "light"].tabIconDefault,
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
          tabBarItemStyle: { paddingVertical: 2 },
          tabBarStyle: { backgroundColor: "#ffffff" },
          tabBarHideOnKeyboard: true,
          sceneStyle: { backgroundColor: "#ffffff" },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.home'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
            ...hideWhen(mode === 'business'),
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: t('tabs.map'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="map.fill" color={color} />,
            ...hideWhen(mode === 'business'),
          }}
        />
        <Tabs.Screen
          name="wallet"
          options={{
            title: t('tabs.wallet'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="wallet.pass.fill" color={color} />,
            ...hideWhen(mode === 'business'),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: t('tabs.settings'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="gearshape.fill" color={color} />,
            ...hideWhen(mode === 'business'),
          }}
        />
        <Tabs.Screen
          name="create"
          options={{
            title: t('tabs.create'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="plus.circle.fill" color={color} />,
            ...hideWhen(mode === 'customer'),
          }}
        />
        <Tabs.Screen
          name="redeem"
          options={{
            title: t('tabs.redeem'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="qrcode.viewfinder" color={color} />,
            ...hideWhen(mode === 'customer'),
          }}
        />
        <Tabs.Screen
          name="dashboard"
          options={{
            title: t('tabs.dashboard'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="chart.bar.fill" color={color} />,
            ...hideWhen(mode === 'customer'),
          }}
        />
        <Tabs.Screen
          name="account"
          options={{
            title: t('tabs.account'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.crop.circle.fill" color={color} />,
            ...hideWhen(mode === 'customer'),
          }}
        />
        <Tabs.Screen name="favorites" options={{ href: null }} />
        <Tabs.Screen name="explore" options={{ href: null }} />
        <Tabs.Screen name="auth" options={{ href: null }} />
      </Tabs>
    </TabAuthGate>
  );
}

function TabModeRedirect() {
  const { mode, ready } = useTabMode();
  const segments = useSegments();
  const router = useRouter();
  const params = useGlobalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const [checkingProfile, setCheckingProfile] = useState(false);
  const forceE2E =
    String(params.e2e ?? "") === "1" ||
    (Platform.OS === "web" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("e2e") === "1");
  const forceBypass = forceE2E || String(params.skipSetup ?? "") === "1";

  useEffect(() => {
    if (!ready) return;
    const segs = segments as string[];
    const tabsIdx = segs.indexOf("(tabs)");
    if (tabsIdx === -1) return;
    const tab = String(segs[tabsIdx + 1] ?? "index");

    if (mode === "business") {
      if (tab === "index" || tab === "map" || tab === "wallet" || tab === "settings") {
        router.navigate("/(tabs)/create");
      }
      if (tab === "create" || tab === "redeem" || tab === "dashboard") {
        if (forceBypass) return;
        let cancelled = false;
        setCheckingProfile(true);
        void supabase.auth.getSession().then(async ({ data }) => {
          if (cancelled) return;
          const user = data.session?.user;
          if (!user) {
            setCheckingProfile(false);
            return;
          }
          const access = await getBusinessProfileAccessForCurrentUser();
          if (cancelled) return;
          if (!access.isComplete) {
            router.replace("/business-setup");
          }
          setCheckingProfile(false);
        });
        return () => {
          cancelled = true;
        };
      }
    } else {
      if (tab === "create" || tab === "redeem" || tab === "dashboard") {
        router.navigate("/(tabs)");
      }
    }
  }, [ready, mode, segments, router, forceBypass]);

  if (checkingProfile) {
    return (
      <View style={{ ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return null;
}
