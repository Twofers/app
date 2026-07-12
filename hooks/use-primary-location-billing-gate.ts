import { useMemo } from "react";

import { useBusinessLocations, type SubscriptionTier } from "@/hooks/use-business-locations";
import { useLocationBillingSummary } from "@/hooks/use-location-billing-summary";
import { getMerchantAccessForBillingSummary } from "@/lib/merchant-access";

type BillingGateParams = {
  businessId: string | null;
  subscriptionTier: SubscriptionTier;
  isLoggedIn: boolean;
  bypass?: boolean;
};

export function usePrimaryLocationBillingGate({
  businessId,
  subscriptionTier,
  isLoggedIn,
  bypass = false,
}: BillingGateParams) {
  const {
    visibleLocations,
    loading: locationsLoading,
    error: locationsError,
  } = useBusinessLocations(bypass ? null : businessId, subscriptionTier);
  const primaryLocationId = visibleLocations[0]?.id ?? null;
  const {
    summary,
    loading: summaryLoading,
    error: summaryError,
    refresh,
  } = useLocationBillingSummary(bypass ? null : primaryLocationId);

  const access = useMemo(
    () =>
      getMerchantAccessForBillingSummary({
        isLoggedIn,
        businessId,
        summary,
        bypass,
      }),
    [businessId, bypass, isLoggedIn, summary],
  );

  const blocked = useMemo(
    () => !access.canAccessMerchantTools,
    [access.canAccessMerchantTools],
  );

  return {
    blocked,
    access,
    loading: !bypass && Boolean(businessId) && (locationsLoading || summaryLoading),
    primaryLocationId,
    summary,
    locationsError,
    summaryError,
    refresh,
  };
}
