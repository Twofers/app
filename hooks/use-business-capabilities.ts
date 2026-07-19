import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseBusinessCapabilities,
  type CanonicalBusinessCapabilities,
} from "@/lib/business-capabilities";
import { supabase } from "@/lib/supabase";

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
    setState({
      businessId,
      capabilities: null,
      error: null,
      loading: true,
    });
    const { data, error: rpcError } = await supabase.rpc("get_business_capabilities", {
      p_business_id: businessId,
    });
    if (requestId !== requestSequence.current) return;
    if (rpcError) {
      setState({
        businessId,
        capabilities: null,
        error: rpcError.message,
        loading: false,
      });
      return;
    }
    const parsed = parseBusinessCapabilities(data);
    if (!parsed) {
      setState({
        businessId,
        capabilities: null,
        error: "Invalid business capability response.",
        loading: false,
      });
      return;
    }
    setState({
      businessId,
      capabilities: parsed,
      error: null,
      loading: false,
    });
  }, [businessId, bypass]);

  useEffect(() => {
    void refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

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
