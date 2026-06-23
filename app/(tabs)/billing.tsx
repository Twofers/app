import { Redirect, useLocalSearchParams, type Href } from "expo-router";

export default function LegacyBillingRoute() {
  const params = useLocalSearchParams<{ checkout?: string; reason?: string }>();

  return (
    <Redirect
      href={{
        pathname: "/(tabs)/account/billing",
        params,
      } as unknown as Href}
    />
  );
}
