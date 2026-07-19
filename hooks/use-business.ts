import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { supabase } from "../lib/supabase";
import { fetchOwnerBusiness } from "../lib/owner-business";
import type { BusinessContextPayload } from "../lib/ad-variants";

type BusinessInfo = {
  id: string;
  subscription_tier: "pro" | "premium";
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
  current_profile_version: number | null;
  /** Lifecycle status (get_my_business RPC path only) — drives the name lock UI. */
  status: string | null;
};

export type SubscriptionStatus = "trial" | "active" | "past_due" | "canceled";

export type StripeIds = {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
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
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>("trial");
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [currentPeriodEndsAt, setCurrentPeriodEndsAt] = useState<string | null>(null);
  const [stripeIds, setStripeIds] = useState<StripeIds>({ stripeCustomerId: null, stripeSubscriptionId: null });
  /** True when the businesses lookup failed (e.g. multiple rows) — fail-safe: treat as cannot self-delete in-app. */
  const [businessOwnershipAmbiguous, setBusinessOwnershipAmbiguous] = useState(false);
  const [loading, setLoading] = useState(true);
  const hasEverFetchedRef = useRef(false);

  const businessContextForAi = useMemo(() => businessRowToAiContext(business), [business]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const uid = session?.user?.id;
    if (!uid) {
      setIsLoggedIn(false);
      setUserId(null);
      setSessionEmail(null);
      setBusiness(null);
      // Only reset billing state to defaults if we've never fetched real data.
      // This prevents the stale-default window that triggers premature billing redirects.
      if (!hasEverFetchedRef.current) {
        setSubscriptionStatus("trial");
        setTrialEndsAt(null);
        setCurrentPeriodEndsAt(null);
        setStripeIds({ stripeCustomerId: null, stripeSubscriptionId: null });
      }
      setBusinessOwnershipAmbiguous(false);
      // Keep loading=true until auth fully resolves to prevent billing gates
      // from firing with stale defaults during the auth handshake.
      if (!authLoading) setLoading(false);
      return;
    }

    setIsLoggedIn(true);
    setUserId(uid);
    setSessionEmail(session?.user?.email ?? null);

    // PII columns (contact_name, business_email, tone) and owner_id filters are
    // only readable via the get_my_business() SECURITY DEFINER RPC once the
    // column-grant migration lands; the helper falls back to a direct select
    // while the RPC doesn't exist yet.
    const { row: data, error: bizError } = await fetchOwnerBusiness(supabase, uid);

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
            subscription_tier: "pro", // location-level billing is the source of truth for current entitlements
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
            current_profile_version: data.current_profile_version ?? null,
            status: data.status ?? null,
          }
        : null,
    );

    // Billing state now comes from location-level entitlement RPCs. Some production
    // schemas do not have legacy billing columns on business_profiles, so this
    // shared business hook must not select those optional columns.
    setSubscriptionStatus("trial");
    setTrialEndsAt(null);
    setCurrentPeriodEndsAt(null);
    setStripeIds({ stripeCustomerId: null, stripeSubscriptionId: null });

    hasEverFetchedRef.current = true;
    setLoading(false);
  }, [session, authLoading]);

  useEffect(() => {
    if (authLoading) return;
    let stale = false;
    void refresh().finally(() => {
      if (stale && __DEV__) console.warn("[useBusiness] refresh completed after unmount/stale");
    });
    return () => { stale = true; };
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
    subscriptionTier: business?.subscription_tier ?? "pro",
    subscriptionStatus,
    trialEndsAt,
    currentPeriodEndsAt,
    stripeCustomerId: stripeIds.stripeCustomerId,
    stripeSubscriptionId: stripeIds.stripeSubscriptionId,
    loading,
    refresh,
  };
}
