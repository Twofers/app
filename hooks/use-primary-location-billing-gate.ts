import { useMemo } from "react";

import { useBusinessLocations, type SubscriptionTier } from "@/hooks/use-business-locations";
import { useLocationBillingSummary } from "@/hooks/use-location-billing-summary";
import {
  PAID_BILLING_ENABLED,
  PILOT_DISABLE_BILLING_GATE,
  canCreateDealWithLocationBilling,
} from "@/lib/billing/access";

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
  const enforcementEnabled = PAID_BILLING_ENABLED && !PILOT_DISABLE_BILLING_GATE;
  const gatedBusinessId = enforcementEnabled ? businessId : null;
  const {
    visibleLocations,
    loading: locationsLoading,
    error: locationsError,
  } = useBusinessLocations(gatedBusinessId, subscriptionTier);
  const primaryLocationId = visibleLocations[0]?.id ?? null;
  const {
    summary,
    loading: summaryLoading,
    error: summaryError,
    refresh,
  } = useLocationBillingSummary(enforcementEnabled ? primaryLocationId : null);

  const blocked = useMemo(
    () =>
      !canCreateDealWithLocationBilling({
        isLoggedIn,
        status: summary.status,
        purchaseSurface: summary.purchaseSurface,
        trialEndsAt: summary.trialEndsAt,
        currentPeriodEndsAt: summary.currentPeriodEndsAt,
        bypass,
      }),
    [bypass, isLoggedIn, summary.currentPeriodEndsAt, summary.purchaseSurface, summary.status, summary.trialEndsAt],
  );

  return {
    blocked,
    loading: enforcementEnabled && (locationsLoading || summaryLoading),
    primaryLocationId,
    summary,
    locationsError,
    summaryError,
    refresh,
  };
}
