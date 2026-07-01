import { Redirect, type Href } from "expo-router";

import { isMobilePaidBillingEnabled } from "@/lib/billing/access";

export default function LegacyBillingManageRoute() {
  if (!isMobilePaidBillingEnabled()) {
    return <Redirect href="/(tabs)/account" />;
  }

  return <Redirect href={"/(tabs)/account/billing/manage" as Href} />;
}
