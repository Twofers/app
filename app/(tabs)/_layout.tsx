import { Tabs, useGlobalSearchParams, useRouter, useSegments, type Href } from "expo-router";
import React, { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
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
import { isAuthBypassEnabled } from "@/lib/auth-bypass";
import { canCreateDeal } from "@/lib/billing/access";
import { useBusiness } from "@/hooks/use-business";
import {
  deriveTabFromSegments,
  resolveTabModeRedirectTarget,
  shouldCheckBusinessProfileForTab,
} from "@/lib/tab-mode-redirect";

type TabIconName = ComponentProps<typeof IconSymbol>["name"];

function createTabIconRenderer(name: TabIconName) {
  const TabIconRenderer = ({ color }: { color: string }) => <IconSymbol size={28} name={name} color={color} />;
  TabIconRenderer.displayName = `TabIcon(${name})`;
  return TabIconRenderer;
}

const renderHomeTabIcon = createTabIconRenderer("house.fill");
const renderMapTabIcon = createTabIconRenderer("map.fill");
const renderWalletTabIcon = createTabIconRenderer("wallet.pass.fill");
const renderSettingsTabIcon = createTabIconRenderer("gearshape.fill");
const renderCreateTabIcon = createTabIconRenderer("plus.circle.fill");
const renderRedeemTabIcon = createTabIconRenderer("qrcode.viewfinder");
const renderDashboardTabIcon = createTabIconRenderer("chart.bar.fill");
const renderBillingTabIcon = createTabIconRenderer("heart.fill");
const renderAccountTabIcon = createTabIconRenderer("person.crop.circle.fill");

function TabAuthGate({ children }: Readonly<{ children: ReactNode }>) {
  const { session, isInitialLoading } = useAuthSession();
  const params = useGlobalSearchParams<{ e2e?: string; skipSetup?: string }>();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const browserE2EParam =
    Platform.OS === "web" && globalThis.window !== undefined
      ? new URLSearchParams(globalThis.window.location.search).get("e2e") ?? undefined
      : undefined;
  const forceBypass = isAuthBypassEnabled({
    skipSetup: String(params.skipSetup ?? ""),
    e2e: browserE2EParam ?? String(params.e2e ?? ""),
    isDev: __DEV__,
  });

  useEffect(() => {
    if (forceBypass) return;
    const user = session?.user;
    if (user) {
      void registerPushTokenIfNeeded(user.id);
      void syncConsumerPrefsToServer(user.id);
    }
  }, [forceBypass, session?.user]);

  if (forceBypass && session?.user) {
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
            tabBarIcon: renderHomeTabIcon,
            ...hideWhen(mode === 'business'),
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: t('tabs.map'),
            tabBarIcon: renderMapTabIcon,
            ...hideWhen(mode === 'business'),
          }}
        />
        <Tabs.Screen
          name="wallet"
          options={{
            title: t('tabs.wallet'),
            tabBarIcon: renderWalletTabIcon,
            ...hideWhen(mode === 'business'),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: t('tabs.settings'),
            tabBarIcon: renderSettingsTabIcon,
            ...hideWhen(mode === 'business'),
          }}
        />
        <Tabs.Screen
          name="create"
          options={{
            title: t('tabs.create'),
            tabBarIcon: renderCreateTabIcon,
            ...hideWhen(mode === 'customer'),
          }}
        />
        <Tabs.Screen
          name="redeem"
          options={{
            title: t('tabs.redeem'),
            tabBarIcon: renderRedeemTabIcon,
            ...hideWhen(mode === 'customer'),
          }}
        />
        <Tabs.Screen
          name="dashboard"
          options={{
            title: t('tabs.dashboard'),
            tabBarIcon: renderDashboardTabIcon,
            ...hideWhen(mode === 'customer'),
          }}
        />
        <Tabs.Screen
          name="billing"
          options={{
            title: t("tabs.billing"),
            tabBarIcon: renderBillingTabIcon,
            ...hideWhen(mode === "customer"),
          }}
        />
        <Tabs.Screen
          name="account"
          options={{
            title: t('tabs.account'),
            tabBarIcon: renderAccountTabIcon,
            ...hideWhen(mode === 'customer'),
          }}
        />
        {/* FIX: billing/manage is a sub-route pushed from billing.tsx.
            Without href:null, Expo Router auto-discovers it as a visible 5th
            tab showing the raw route name "billing/manage". */}
        <Tabs.Screen name="billing/manage" options={{ href: null }} />
        <Tabs.Screen name="auth" options={{ href: null }} />
      </Tabs>
    </TabAuthGate>
  );
}

function TabModeRedirect() {
  const { session } = useAuthSession();
  const { mode, ready } = useTabMode();
  const { isLoggedIn, subscriptionStatus, trialEndsAt, loading: billingLoading } = useBusiness();
  const segments = useSegments() as string[];
  const router = useRouter();
  const params = useGlobalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const [checkingProfile, setCheckingProfile] = useState(false);
  const [businessProfileComplete, setBusinessProfileComplete] = useState<boolean | null>(null);
  const profileCheckedUserRef = useRef<string | null>(null);
  const lastRedirectRef = useRef<string | null>(null);
  const browserE2EParam =
    Platform.OS === "web" && globalThis.window !== undefined
      ? new URLSearchParams(globalThis.window.location.search).get("e2e") ?? undefined
      : undefined;
  const forceBypass = isAuthBypassEnabled({
    skipSetup: String(params.skipSetup ?? ""),
    e2e: browserE2EParam ?? String(params.e2e ?? ""),
    isDev: __DEV__,
  });
  const businessBillingBlocked =
    mode === "business" &&
    !billingLoading &&
    !canCreateDeal({
      isLoggedIn,
      subscriptionStatus,
      trialEndsAt,
      bypass: forceBypass,
    });

  const tab = useMemo(() => {
    return deriveTabFromSegments(segments.map(String));
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
    const needsBusinessCheck = shouldCheckBusinessProfileForTab(tab);
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
    const target = resolveTabModeRedirectTarget({
      mode,
      tab,
      currentPath,
      forceBypass,
      checkingProfile,
      businessProfileComplete,
      businessBillingBlocked,
    });
    if (target) {
      redirectTo(target);
    }
  }, [ready, mode, tab, currentPath, router, forceBypass, checkingProfile, businessProfileComplete, businessBillingBlocked]);

  if (checkingProfile) {
    return (
      <View style={{ ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return null;
}
