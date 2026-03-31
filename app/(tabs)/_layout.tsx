import { Tabs, useGlobalSearchParams, useRouter, useSegments, type Href } from "expo-router";
import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTabMode } from "@/lib/tab-mode";
import { getBusinessProfileAccessForCurrentUser } from "@/lib/business-profile-access";
import { registerPushTokenIfNeeded } from "@/lib/push-token";
import { syncConsumerPrefsToServer } from "@/lib/sync-consumer-prefs";

function TabAuthGate({ children }: { children: ReactNode }) {
  const { session, isInitialLoading } = useAuthSession();
  const params = useGlobalSearchParams<{ e2e?: string; skipSetup?: string }>();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const forceE2E =
    Platform.OS === "web" &&
    ((params.e2e === "1") ||
      (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("e2e") === "1"));
  const forceBypass = forceE2E || String(params.skipSetup ?? "") === "1";

  useEffect(() => {
    if (forceBypass) return;
    const user = session?.user;
    if (user) {
      void registerPushTokenIfNeeded(user.id);
      void syncConsumerPrefsToServer(user.id);
    }
  }, [forceBypass, session?.user]);

  if (forceBypass) {
    return <>{children}</>;
  }

  if (isInitialLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }
  // Root AuthStackGate is the single authority for unauth redirects.
  // Keep tabs surface inert while root gate resolves navigation.
  if (!session?.user) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }
  return <>{children}</>;
}


export default function TabLayout() {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
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
          tabBarActiveTintColor: theme.primary,
          tabBarInactiveTintColor: theme.tabIconDefault,
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
          tabBarItemStyle: { paddingVertical: 2 },
          tabBarStyle: { backgroundColor: theme.background },
          tabBarHideOnKeyboard: true,
          sceneStyle: { backgroundColor: theme.background },
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
          name="billing"
          options={{
            title: t("tabs.billing"),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="heart.fill" color={color} />,
            ...hideWhen(mode === "customer"),
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
        <Tabs.Screen name="auth" options={{ href: null }} />
      </Tabs>
    </TabAuthGate>
  );
}

function TabModeRedirect() {
  const { session } = useAuthSession();
  const { mode, ready } = useTabMode();
  const segments = useSegments() as string[];
  const router = useRouter();
  const params = useGlobalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const [checkingProfile, setCheckingProfile] = useState(false);
  const [businessProfileComplete, setBusinessProfileComplete] = useState<boolean | null>(null);
  const profileCheckedUserRef = useRef<string | null>(null);
  const lastRedirectRef = useRef<string | null>(null);
  const forceE2E =
    String(params.e2e ?? "") === "1" ||
    (Platform.OS === "web" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("e2e") === "1");
  const forceBypass = forceE2E || String(params.skipSetup ?? "") === "1";

  const tab = useMemo(() => {
    const tabsIdx = segments.indexOf("(tabs)");
    if (tabsIdx === -1) return "index";
    return String(segments[tabsIdx + 1] ?? "index");
  }, [segments]);

  const currentPath = useMemo(() => {
    return tab === "index" ? "/(tabs)" : `/(tabs)/${tab}`;
  }, [tab]);

  useEffect(() => {
    if (!ready || mode !== "business" || forceBypass) {
      setCheckingProfile(false);
      setBusinessProfileComplete(null);
      profileCheckedUserRef.current = null;
      return;
    }
    const userId = session?.user?.id;
    if (!userId) return;
    const needsBusinessCheck =
      tab === "create" || tab === "redeem" || tab === "dashboard" || tab === "billing" || tab === "account";
    if (!needsBusinessCheck) return;
    if (profileCheckedUserRef.current === userId && businessProfileComplete !== null) return;

    let cancelled = false;
    setCheckingProfile(true);
    void (async () => {
      const access = await getBusinessProfileAccessForCurrentUser();
      if (cancelled) return;
      profileCheckedUserRef.current = userId;
      setBusinessProfileComplete(access.isComplete);
      setCheckingProfile(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, mode, forceBypass, session?.user?.id, tab, businessProfileComplete]);

  useEffect(() => {
    if (!ready) return;
    const redirectTo = (target: string) => {
      if (target === currentPath || lastRedirectRef.current === target) return;
      lastRedirectRef.current = target;
      router.replace(target as Href);
    };
    if (mode === "business") {
      if (tab === "index" || tab === "map" || tab === "wallet" || tab === "settings") {
        redirectTo("/(tabs)/create");
        return;
      }
      if (tab === "create" || tab === "redeem" || tab === "dashboard" || tab === "billing" || tab === "account") {
        if (forceBypass || checkingProfile || businessProfileComplete === null) return;
        if (!businessProfileComplete) {
          redirectTo("/business-setup");
        }
      }
    } else {
      if (tab === "account") {
        redirectTo("/(tabs)/settings");
        return;
      }
      if (tab === "create" || tab === "redeem" || tab === "dashboard" || tab === "billing") {
        redirectTo("/(tabs)");
      }
    }
  }, [ready, mode, tab, currentPath, router, forceBypass, checkingProfile, businessProfileComplete]);

  if (checkingProfile) {
    return (
      <View style={{ ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return null;
}
