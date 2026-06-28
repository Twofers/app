import { Redirect, type Href } from "expo-router";

export default function LegacyBillingManageRoute() {
  return <Redirect href={"/(tabs)/account/billing/manage" as Href} />;
}
