import { useCallback, useMemo } from "react";

import { useBusinessLocations, type SubscriptionTier } from "@/hooks/use-business-locations";
import { useBusinessCapabilities } from "@/hooks/use-business-capabilities";
import { useLocationBillingSummary } from "@/hooks/use-location-billing-summary";
import {
  getMerchantAccessForBillingSummary,
  getMerchantAccessFromCapabilities,
} from "@/lib/merchant-access";

type BillingGateParams = {
  businessId: string | null;
  businessStatus?: string | null;
  subscriptionTier: SubscriptionTier;
  isLoggedIn: boolean;
  bypass?: boolean;
};

export function usePrimaryLocationBillingGate({
  businessId,
  businessStatus = null,
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
  const {
    capabilities,
    loading: capabilitiesLoading,
    error: capabilitiesError,
    refresh: refreshCapabilities,
  } = useBusinessCapabilities(businessId, bypass);

  const access = useMemo(
    () => {
      const fallback = getMerchantAccessForBillingSummary({
        isLoggedIn,
        businessId,
        businessStatus,
        summary,
        bypass,
      });
      if (bypass || !capabilities) return fallback;
      return getMerchantAccessFromCapabilities({
        capabilities,
        status: summary.status,
      });
    },
    [businessId, businessStatus, bypass, capabilities, isLoggedIn, summary],
  );

  const safeAccess = useMemo(
    () =>
      capabilitiesError && !bypass
        ? {
            ...access,
            canAccessMerchantTools: false,
            canUseSetupTools: false,
            canUseMenuTools: false,
            canExtractInitialMenu: false,
            canCreateTextDraft: false,
            canGenerateAi: false,
            canPublishOffer: false,
            canReceiveNewClaims: false,
            canRedeemExistingClaims: false,
            canManageBilling: false,
            reason: "capability_unavailable",
          }
        : access,
    [access, bypass, capabilitiesError],
  );

  const blocked = useMemo(
    () => !safeAccess.canAccessMerchantTools,
    [safeAccess.canAccessMerchantTools],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), refreshCapabilities()]);
  }, [refresh, refreshCapabilities]);

  return {
    blocked,
    access: safeAccess,
    loading:
      !bypass &&
      Boolean(businessId) &&
      (locationsLoading || summaryLoading || capabilitiesLoading),
    primaryLocationId,
    summary,
    locationsError,
    summaryError,
    capabilitiesError,
    refresh: refreshAll,
  };
}
