import { Redirect, type Href, useLocalSearchParams, useSegments } from "expo-router";
import { Stack } from "expo-router";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useBusiness } from "@/hooks/use-business";
import { usePrimaryLocationBillingGate } from "@/hooks/use-primary-location-billing-gate";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { isBillingBypassEnabled } from "@/lib/billing/access";

export default function CreateLayout() {
  const params = useLocalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const segments = useSegments();
  const bypass = isBillingBypassEnabled(params.skipSetup, params.e2e);
  const { t } = useTranslation();

  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  const { isLoggedIn, businessId, businessProfile, subscriptionTier, loading: businessLoading } = useBusiness();
  const { blocked, access, loading: billingLoading } = usePrimaryLocationBillingGate({
    businessId,
    businessStatus: businessProfile?.status ?? null,
    subscriptionTier,
    isLoggedIn,
    bypass,
  });

  const loading = businessLoading || billingLoading;

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  const leafRoute = String(segments[segments.length - 1] ?? "");
  const routeAllowedBeforeActivation =
    (leafRoute === "menu" && access.canUseMenuTools) ||
    (leafRoute === "menu-scan" && access.canExtractInitialMenu) ||
    (leafRoute === "menu-manager" && access.canUseMenuTools) ||
    (leafRoute === "menu-offer" && (access.canUseSetupTools || access.canCreateTextDraft));

  if (blocked && !routeAllowedBeforeActivation) {
    return <Redirect href={"/(tabs)/account" as Href} />;
  }

  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: "minimal",
        headerBackButtonMenuEnabled: false,
        headerBackTitle: "",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.primary,
        headerTitleStyle: { color: theme.text, fontWeight: "700" },
      }}
    >
      <Stack.Screen name="quick" options={{ title: t('createAi.titleScreen') }} />
      <Stack.Screen name="ai" options={{ title: t('createAi.titleScreen') }} />
      <Stack.Screen name="ai-compose" options={{ title: t('aiCompose.title') }} />
      <Stack.Screen name="reuse" options={{ title: t('reuseHub.title') }} />
      <Stack.Screen name="menu" options={{ title: t("createHub.menuTitle") }} />
      <Stack.Screen name="menu-scan" options={{ title: t('menuScan.title') }} />
      <Stack.Screen name="menu-manager" options={{ title: t('menuManager.title') }} />
      <Stack.Screen name="menu-offer" options={{ title: t('menuOffer.title') }} />
      <Stack.Screen name="ad-refine" options={{ title: t('adRefine.title') }} />
    </Stack>
  );
}
