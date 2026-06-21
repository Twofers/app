import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createSafeDisabledBillingSummary,
  parseLocationBillingSummary,
  type LocationBillingSummary,
} from "@/lib/billing/entitlements";
import { supabase } from "@/lib/supabase";

type BillingSummaryState = {
  summary: LocationBillingSummary;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useLocationBillingSummary(businessLocationId: string | null): BillingSummaryState {
  const safeSummary = useMemo(
    () => createSafeDisabledBillingSummary(businessLocationId),
    [businessLocationId],
  );
  const [summary, setSummary] = useState<LocationBillingSummary>(safeSummary);
  const [loading, setLoading] = useState(Boolean(businessLocationId));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!businessLocationId) {
      setSummary(createSafeDisabledBillingSummary(null));
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("get_location_billing_summary", {
        p_business_location_id: businessLocationId,
      });
      if (rpcError) throw rpcError;
      setSummary(parseLocationBillingSummary(data, businessLocationId));
    } catch (err) {
      setSummary(createSafeDisabledBillingSummary(businessLocationId));
      setError(err instanceof Error ? err.message : "Unable to load billing status.");
    } finally {
      setLoading(false);
    }
  }, [businessLocationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { summary, loading, error, refresh };
}
