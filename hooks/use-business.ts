import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { BusinessContextPayload } from "../lib/ad-variants";

type BusinessInfo = {
  id: string;
  name: string;
  category: string | null;
  tone: string | null;
  location: string | null;
  short_description: string | null;
  /** en | es | ko — AI + deal-quality on create; null = use app language */
  preferred_locale: string | null;
};

/** Strip empties for Edge Function `business_context` (all optional). */
export function businessRowToAiContext(b: BusinessInfo | null): BusinessContextPayload {
  if (!b) return {};
  const out: BusinessContextPayload = {};
  const c = b.category?.trim();
  const t = b.tone?.trim();
  const l = b.location?.trim();
  const d = b.short_description?.trim();
  if (c) out.category = c;
  if (t) out.tone = t;
  if (l) out.location = l;
  if (d) out.description = d;
  return out;
}

export function useBusiness() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const businessContextForAi = useMemo(() => businessRowToAiContext(business), [business]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      setIsLoggedIn(false);
      setUserId(null);
      setSessionEmail(null);
      setBusiness(null);
      setLoading(false);
      return;
    }

    setIsLoggedIn(true);
    setUserId(session.user.id);
    setSessionEmail(session.user.email ?? null);

    const { data } = await supabase
      .from("businesses")
      .select("id,name,category,tone,location,short_description,preferred_locale")
      .eq("owner_id", session.user.id)
      .maybeSingle();

    setBusiness(
      data
        ? {
            id: data.id,
            name: data.name,
            category: data.category ?? null,
            tone: data.tone ?? null,
            location: data.location ?? null,
            short_description: data.short_description ?? null,
            preferred_locale: data.preferred_locale ?? null,
          }
        : null,
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  return {
    isLoggedIn,
    userId,
    sessionEmail,
    businessId: business?.id ?? null,
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
