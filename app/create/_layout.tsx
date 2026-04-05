import { Redirect, type Href, useLocalSearchParams } from "expo-router";
import { Stack } from "expo-router";
import React, { useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useBusiness } from "@/hooks/use-business";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { canCreateDeal, isBillingBypassEnabled } from "@/lib/billing/access";

export default function CreateLayout() {
  const params = useLocalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const bypass = isBillingBypassEnabled(params.skipSetup, params.e2e);
  const { t } = useTranslation();

  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  const { isLoggedIn, subscriptionStatus, trialEndsAt, loading } = useBusiness();

  const blocked = useMemo(
    () =>
      !canCreateDeal({
        isLoggedIn,
        subscriptionStatus,
        trialEndsAt,
        bypass,
      }),
    [bypass, isLoggedIn, subscriptionStatus, trialEndsAt],
  );

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (blocked) {
    return (
      <Redirect
        href={{ pathname: "/(tabs)/billing", params: { reason: "reactivate" } } as unknown as Href}
      />
    );
  }

  return (
    <Stack>
      <Stack.Screen name="quick" options={{ headerShown: false }} />
      <Stack.Screen name="ai" options={{ title: t('createAi.titleScreen') }} />
      <Stack.Screen name="ai-compose" options={{ title: t('aiCompose.title') }} />
      <Stack.Screen name="reuse" options={{ title: t('reuseHub.title') }} />
      <Stack.Screen name="menu-scan" options={{ title: t('menuScan.title') }} />
      <Stack.Screen name="menu-manager" options={{ title: t('menuManager.title') }} />
      <Stack.Screen name="menu-offer" options={{ title: t('menuOffer.title') }} />
      <Stack.Screen name="ad-refine" options={{ title: t('adRefine.title') }} />
    </Stack>
  );
}
