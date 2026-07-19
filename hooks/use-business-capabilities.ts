import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseBusinessCapabilities,
  type CanonicalBusinessCapabilities,
} from "@/lib/business-capabilities";
import { supabase } from "@/lib/supabase";

// One failed capabilities fetch fail-closes the whole merchant workspace, so
// transient network errors get retried before the error is surfaced, and a
// surfaced error keeps retrying in the background until a fetch succeeds.
const IN_FLIGHT_RETRY_DELAYS_MS = [1000, 2500];
const BACKGROUND_RETRY_INTERVAL_MS = 15000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function useBusinessCapabilities(businessId: string | null, bypass = false) {
  const requestSequence = useRef(0);
  const [state, setState] = useState<{
    businessId: string | null;
    capabilities: CanonicalBusinessCapabilities | null;
    loading: boolean;
    error: string | null;
  }>({
    businessId: null,
    capabilities: null,
    loading: false,
    error: null,
  });

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (!businessId || bypass) {
      setState({
        businessId,
        capabilities: null,
        error: null,
        loading: false,
      });
      return;
    }
    setState((prev) =>
      // Silent refetch while an error is surfaced: keep the blocked UI stable
      // instead of flickering back into a loading state on every retry.
      prev.businessId === businessId && prev.error && !prev.loading
        ? prev
        : {
            businessId,
            capabilities: null,
            error: null,
            loading: true,
          },
    );
    let lastError = "Business capability request failed.";
    for (let attempt = 0; attempt <= IN_FLIGHT_RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) {
        await sleep(IN_FLIGHT_RETRY_DELAYS_MS[attempt - 1]);
        if (requestId !== requestSequence.current) return;
      }
      const { data, error: rpcError } = await supabase.rpc("get_business_capabilities", {
        p_business_id: businessId,
      });
      if (requestId !== requestSequence.current) return;
      if (rpcError) {
        lastError = rpcError.message;
        continue;
      }
      const parsed = parseBusinessCapabilities(data);
      if (!parsed) {
        lastError = "Invalid business capability response.";
        continue;
      }
      setState({
        businessId,
        capabilities: parsed,
        error: null,
        loading: false,
      });
      return;
    }
    setState({
      businessId,
      capabilities: null,
      error: lastError,
      loading: false,
    });
  }, [businessId, bypass]);

  useEffect(() => {
    void refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  const hasSurfacedError = Boolean(
    !bypass && businessId && state.businessId === businessId && !state.loading && state.error,
  );
  useEffect(() => {
    if (!hasSurfacedError) return;
    const timer = setInterval(() => {
      void refresh();
    }, BACKGROUND_RETRY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasSurfacedError, refresh]);

  const stateMatchesBusiness = state.businessId === businessId;
  return {
    capabilities: !bypass && stateMatchesBusiness ? state.capabilities : null,
    loading:
      !bypass &&
      Boolean(businessId) &&
      (!stateMatchesBusiness || state.loading),
    error: !bypass && stateMatchesBusiness ? state.error : null,
    refresh,
  };
}
