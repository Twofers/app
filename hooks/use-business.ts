import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { supabase } from "../lib/supabase";
import type { BusinessContextPayload } from "../lib/ad-variants";

type BusinessInfo = {
  id: string;
  name: string;
  contact_name: string | null;
  business_email: string | null;
  address: string | null;
  category: string | null;
  tone: string | null;
  location: string | null;
  /** WGS84 — optional, for distance sorting on Deals */
  latitude: number | null;
  longitude: number | null;
  short_description: string | null;
  /** en | es | ko — AI + deal-quality on create; null = use app language */
  preferred_locale: string | null;
  phone: string | null;
  hours_text: string | null;
};

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Strip empties for Edge Function `business_context` (all optional). */
export function businessRowToAiContext(b: BusinessInfo | null): BusinessContextPayload {
  if (!b) return {};
  const out: BusinessContextPayload = {};
  const c = b.category?.trim();
  const t = b.tone?.trim();
  const addr = b.address?.trim();
  const l = b.location?.trim();
  const d = b.short_description?.trim();
  const contact = b.contact_name?.trim();
  const be = b.business_email?.trim();
  if (c) out.category = c;
  if (t) out.tone = t;
  if (addr) out.address = addr;
  if (l) out.location = l;
  if (d) out.description = d;
  if (contact) out.contactName = contact;
  if (be) out.businessEmail = be;
  return out;
}

export function useBusiness() {
  const { session, isInitialLoading: authLoading } = useAuthSession();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  /** True when the businesses lookup failed (e.g. multiple rows) — fail-safe: treat as cannot self-delete in-app. */
  const [businessOwnershipAmbiguous, setBusinessOwnershipAmbiguous] = useState(false);
  const [loading, setLoading] = useState(true);

  const businessContextForAi = useMemo(() => businessRowToAiContext(business), [business]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const uid = session?.user?.id;
    if (!uid) {
      setIsLoggedIn(false);
      setUserId(null);
      setSessionEmail(null);
      setBusiness(null);
      setBusinessOwnershipAmbiguous(false);
      setLoading(false);
      return;
    }

    setIsLoggedIn(true);
    setUserId(uid);
    setSessionEmail(session?.user?.email ?? null);

    const { data, error: bizError } = await supabase
      .from("businesses")
      .select(
        "id,name,contact_name,business_email,address,category,tone,location,latitude,longitude,short_description,preferred_locale,phone,hours_text",
      )
      .eq("owner_id", uid)
      .maybeSingle();

    if (bizError) {
      setBusiness(null);
      setBusinessOwnershipAmbiguous(true);
      setLoading(false);
      return;
    }

    setBusinessOwnershipAmbiguous(false);
    setBusiness(
      data
        ? {
            id: data.id,
            name: data.name,
            contact_name: data.contact_name ?? null,
            business_email: data.business_email ?? null,
            address: data.address ?? null,
            category: data.category ?? null,
            tone: data.tone ?? null,
            location: data.location ?? null,
            latitude: numOrNull(data.latitude),
            longitude: numOrNull(data.longitude),
            short_description: data.short_description ?? null,
            preferred_locale: data.preferred_locale ?? null,
            phone: data.phone ?? null,
            hours_text: data.hours_text ?? null,
          }
        : null,
    );
    setLoading(false);
  }, [session]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();
  }, [refresh, authLoading]);

  return {
    isLoggedIn,
    userId,
    sessionEmail,
    businessId: business?.id ?? null,
    /** When true, in-app self-delete must be blocked (fail-safe). */
    businessOwnershipAmbiguous,
    businessName: business?.name ?? null,
    /** Optional row fields for Account UI */
    businessProfile: business,
    /** Passed to `ai-generate-ad-variants` as `business_context` */
    businessContextForAi,
    /** For AI output + deal-quality messages on publish (null → app locale) */
    businessPreferredLocale: business?.preferred_locale ?? null,
    loading,
    refresh,
  };
}
