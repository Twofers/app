import { Tabs, useGlobalSearchParams, useRouter, useSegments, type Href } from "expo-router";
import React, { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ActivityIndicator, BackHandler, Platform, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { useRedemptionMode } from "@/components/providers/redemption-mode-provider";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTabMode } from "@/lib/tab-mode";
import { getBusinessProfileAccessForCurrentUser } from "@/lib/business-profile-access";
import { registerPushTokenIfNeeded } from "@/lib/push-token";
import { getAlertsEnabled } from "@/lib/notifications";
import { syncConsumerPrefsToServer } from "@/lib/sync-consumer-prefs";
import { isAuthBypassEnabled } from "@/lib/auth-bypass";
import { PAID_BILLING_ENABLED } from "@/lib/billing/access";
import { useBusiness } from "@/hooks/use-business";
import { usePrimaryLocationBillingGate } from "@/hooks/use-primary-location-billing-gate";
import { useOwnerRedemptionSecurity } from "@/components/providers/owner-redemption-security-provider";
import { isRedeemerSession } from "@/lib/redemption-mode";
import {
  deriveTabFromSegments,
  resolveTabModeRedirectTarget,
  shouldCheckBusinessProfileForTab,
} from "@/lib/tab-mode-redirect";
import type { TabMode } from "@/lib/tab-mode";

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
const renderAccountTabIcon = createTabIconRenderer("person.crop.circle.fill");
const renderHapticTabBarButton = (props: ComponentProps<typeof HapticTab>) => <HapticTab {...props} />;

type BusinessTabState = ReturnType<typeof useBusiness>;

function useOwnerPinLockedForBusiness(mode: TabMode, businessId: string | null): boolean {
  const { isPinEnabled, isUnlocked } = useOwnerRedemptionSecurity();
  const ownerPinEnabled = businessId ? isPinEnabled(businessId) : null;
  return mode === "business" && Boolean(businessId && ownerPinEnabled === true && !isUnlocked(businessId));
}

function TabAuthGate({ children }: Readonly<{ children: ReactNode }>) {
  const { session, isInitialLoading } = useAuthSession();
  const { isLocked, loading: redemptionLoading } = useRedemptionMode();
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
      void (async () => {
        if (await getAlertsEnabled()) {
          await registerPushTokenIfNeeded(user.id);
        }
      })();
      void syncConsumerPrefsToServer(user.id);
    }
  }, [forceBypass, session?.user]);

  // Prevent Android back button from exiting the app while on a tab screen.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  if (forceBypass && session?.user) {
    return <>{children}</>;
  }

  if (isInitialLoading || redemptionLoading || isLocked || isRedeemerSession(session)) {
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
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { mode } = useTabMode();
  const business = useBusiness();
  const ownerPinLocked = useOwnerPinLockedForBusiness(mode, business.businessId);
  const androidTabBottomPadding = Math.max(insets.bottom, 8);

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
      <TabModeRedirect business={business} ownerPinLocked={ownerPinLocked} />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: theme.primary,
          tabBarInactiveTintColor: theme.tabIconDefault,
          headerShown: false,
          tabBarButton: renderHapticTabBarButton,
          tabBarAllowFontScaling: false,
          tabBarLabelStyle: { fontSize: 11, lineHeight: 13, fontWeight: "700" },
          tabBarItemStyle: {
            paddingTop: Platform.OS === "android" ? 4 : 2,
            paddingBottom: Platform.OS === "android" ? 4 : 2,
          },
          tabBarStyle: {
            backgroundColor: theme.background,
            ...(Platform.OS === "android"
              ? {
                  minHeight: 64 + androidTabBottomPadding,
                  paddingTop: 4,
                  paddingBottom: androidTabBottomPadding,
                }
              : {}),
          },
          tabBarHideOnKeyboard: true,
          sceneStyle: { backgroundColor: theme.background },
          freezeOnBlur: false,
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
            ...hideWhen(mode === 'customer' || ownerPinLocked),
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
            ...hideWhen(mode === 'customer' || ownerPinLocked),
          }}
        />
        <Tabs.Screen
          name="account"
          options={{
            title: t('tabs.account'),
            tabBarIcon: renderAccountTabIcon,
            ...hideWhen(mode === 'customer' || ownerPinLocked),
          }}
        />
        <Tabs.Screen name="account/billing" options={{ href: null }} />
        <Tabs.Screen name="account/billing/manage" options={{ href: null }} />
        {/* Legacy billing routes redirect into Account. Keep them hidden so
            old deep links never become tab-bar items. */}
        <Tabs.Screen name="billing" options={{ href: null }} />
        <Tabs.Screen name="billing/manage" options={{ href: null }} />
        <Tabs.Screen name="auth" options={{ href: null }} />
      </Tabs>
    </TabAuthGate>
  );
}

function TabModeRedirect({
  business,
  ownerPinLocked,
}: {
  business: BusinessTabState;
  ownerPinLocked: boolean;
}) {
  const { session } = useAuthSession();
  const { mode, ready } = useTabMode();
  const { isLoggedIn, businessId, subscriptionTier, loading: businessLoading } = business;
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
  const { blocked: billingBlocked, loading: locationBillingLoading } = usePrimaryLocationBillingGate({
    businessId,
    subscriptionTier,
    isLoggedIn,
    bypass: forceBypass,
  });
  const billingLoading = businessLoading || locationBillingLoading;
  const businessBillingBlocked =
    PAID_BILLING_ENABLED &&
    mode === "business" &&
    !billingLoading &&
    billingBlocked;

  const tab = useMemo(() => {
    return deriveTabFromSegments(segments.map(String));
  }, [segments]);

  const currentPath = useMemo(() => {
    const tabsIdx = segments.map(String).indexOf("(tabs)");
    if (tabsIdx === -1) return segments.join("/");
    const tabPath = segments
      .slice(tabsIdx + 1)
      .map(String)
      .filter(Boolean)
      .join("/");
    return !tabPath || tabPath === "index" ? "/(tabs)" : `/(tabs)/${tabPath}`;
  }, [segments]);

  useEffect(() => {
    if (!ready || mode !== "business" || forceBypass || ownerPinLocked) {
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
  }, [ready, mode, forceBypass, ownerPinLocked, session?.user?.id, tab, businessProfileComplete]);

  useEffect(() => {
    if (!ready || billingLoading) return;
    const redirectTo = (target: string) => {
      if (target === currentPath || lastRedirectRef.current === target) return;
      lastRedirectRef.current = target;
      router.replace(target as Href);
    };
    if (!PAID_BILLING_ENABLED && tab === "billing") {
      redirectTo(mode === "business" ? "/(tabs)/account" : "/(tabs)");
      return;
    }
    const target = resolveTabModeRedirectTarget({
      mode,
      tab,
      currentPath,
      forceBypass,
      checkingProfile,
      businessProfileComplete,
      businessBillingBlocked,
      ownerPinLocked,
    });
    if (target) {
      redirectTo(target);
    }
  }, [ready, mode, tab, currentPath, router, forceBypass, checkingProfile, businessProfileComplete, businessBillingBlocked, billingLoading, ownerPinLocked]);

  if (checkingProfile) {
    return (
      <View
        pointerEvents="box-none"
        importantForAccessibility="no"
        style={{ ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center" }}
      >
        <ActivityIndicator />
      </View>
    );
  }

  return null;
}
