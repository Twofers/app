import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

export type BusinessLocationRow = {
  id: string;
  business_id: string;
  name: string;
  address: string;
  phone: string | null;
};

export type SubscriptionTier = "pro" | "premium";

/** Pro = 1 location; Premium = up to 3 (billing v4). */
export function maxLocationsForTier(tier: SubscriptionTier): number {
  return tier === "premium" ? 3 : 1;
}

export function useBusinessLocations(businessId: string | null, subscriptionTier: SubscriptionTier) {
  const [locations, setLocations] = useState<BusinessLocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Prevents concurrent auto-creation of the default location. */
  const autoCreateInFlightRef = useRef(false);

  const maxLocations = useMemo(() => maxLocationsForTier(subscriptionTier), [subscriptionTier]);

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLocations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Billing v4: locations are keyed off `business_profiles(id)` (not `businesses(id)`),
      // so we first resolve the corresponding business_profiles row id.
      const { data: bizOwner, error: bizOwnerErr } = await supabase
        .from("businesses")
        .select("owner_id")
        .eq("id", businessId)
        .maybeSingle();
      if (bizOwnerErr || !bizOwner?.owner_id) throw new Error(bizOwnerErr?.message ?? "Missing business owner");

      const ownerUid = String(bizOwner.owner_id);

      let businessProfileId: string | null = null;
      const { data: bpUserRow, error: bpUserErr } = await supabase
        .from("business_profiles")
        .select("id")
        .eq("user_id", ownerUid)
        .maybeSingle();
      if (!bpUserErr && bpUserRow?.id) businessProfileId = String(bpUserRow.id);

      // Backward-compatible fallback for schemas that key by owner_id.
      if (!businessProfileId) {
        const { data: bpOwnerRow, error: bpOwnerErr } = await supabase
          .from("business_profiles")
          .select("id")
          .eq("owner_id", ownerUid)
          .maybeSingle();
        if (!bpOwnerErr && bpOwnerRow?.id) businessProfileId = String(bpOwnerRow.id);
      }

      if (!businessProfileId) throw new Error("Missing business profile for locations");

      const { data: rows, error: qErr } = await supabase
        .from("business_locations")
        .select("id,business_id,name,address,phone")
        .eq("business_id", businessProfileId)
        .order("created_at", { ascending: true });
      if (qErr) throw new Error(qErr.message);
      let list = (rows ?? []) as BusinessLocationRow[];

      if (list.length === 0 && !autoCreateInFlightRef.current) {
        autoCreateInFlightRef.current = true;
        const { data: biz, error: bErr } = await supabase
          .from("businesses")
          .select("name,address,location,phone,latitude,longitude")
          .eq("id", businessId)
          .single();
        if (bErr) throw new Error(bErr.message);
        const addr =
          [biz?.address, biz?.location].map((s) => (typeof s === "string" ? s.trim() : "")).find(Boolean) ||
          "See business profile";
        const label =
          typeof biz?.name === "string" && biz.name.trim() ? `${biz.name.trim()} — main` : "Primary location";
        const { data: ins, error: iErr } = await supabase
          .from("business_locations")
          .insert({
            business_id: businessProfileId,
            name: label,
            address: addr,
            phone: typeof biz?.phone === "string" && biz.phone.trim() ? biz.phone.trim() : null,
            lat: typeof biz?.latitude === "number" ? biz.latitude : null,
            lng: typeof biz?.longitude === "number" ? biz.longitude : null,
          })
          .select("id,business_id,name,address,phone")
          .single();
        autoCreateInFlightRef.current = false;
        if (iErr) throw new Error(iErr.message);
        if (ins) list = [ins as BusinessLocationRow];
      }

      setLocations(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load locations");
      setLocations([]);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleLocations = useMemo(() => locations.slice(0, maxLocations), [locations, maxLocations]);

  return {
    locations,
    visibleLocations,
    maxLocations,
    loading,
    error,
    refresh,
  };
}
