import { Redirect, Slot, type Href, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import { ActivityIndicator, View } from "react-native";

import { useBusiness } from "@/hooks/use-business";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { canCreateDeal, isBillingBypassEnabled } from "@/lib/billing/access";

export default function CreateLayout() {
  const params = useLocalSearchParams<{ skipSetup?: string; e2e?: string }>();
  const bypass = isBillingBypassEnabled(params.skipSetup, params.e2e);

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

  return <Slot />;
}

