import { Redirect, useLocalSearchParams, type Href } from "expo-router";

import { isMobilePaidBillingEnabled } from "@/lib/billing/access";

export default function LegacyBillingRoute() {
  const params = useLocalSearchParams<{ checkout?: string; reason?: string }>();

  if (!isMobilePaidBillingEnabled()) {
    return <Redirect href="/(tabs)/account" />;
  }

  return (
    <Redirect
      href={{
        pathname: "/(tabs)/account/billing",
        params,
      } as unknown as Href}
    />
  );
}
