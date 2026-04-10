import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { supabase } from "../lib/supabase";
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
};

export type SubscriptionStatus = "trial" | "active" | "past_due" | "canceled";

export type StripeIds = {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

type BusinessProfileBilling = {
  subscription_status?: string | null;
  subscription_tier?: string | null;
  trial_ends_at?: string | null;
  current_period_ends_at?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
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
  /** Prevents concurrent billing-init writes from racing on trial_ends_at. */
  const billingInitInFlightRef = useRef(false);

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
            subscription_tier: "pro", // canonical tier lives on business_profiles now
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

    // Billing v4: subscription is canonical on `business_profiles`.
    // Backward-safe fallback: if the row/columns aren't ready yet, use `businesses.subscription_tier`.
    const billingSelect = "subscription_status,subscription_tier,trial_ends_at,current_period_ends_at,stripe_customer_id,stripe_subscription_id";
    let bpRow: BusinessProfileBilling | null = null;

    const { data: byUserRow, error: byUserErr } = await supabase
      .from("business_profiles")
      .select(billingSelect)
      .eq("user_id", uid)
      .maybeSingle();

    if (!byUserErr) {
      bpRow = byUserRow as BusinessProfileBilling | null;
    } else if (byUserErr.code === "PGRST116") {
      bpRow = null;
    } else {
      // Backward compatible fallback: some schemas key by owner_id.
      const { data: byOwnerRow, error: byOwnerErr } = await supabase
        .from("business_profiles")
        .select(billingSelect)
        .eq("owner_id", uid)
        .maybeSingle();
      if (!byOwnerErr) bpRow = byOwnerRow as BusinessProfileBilling | null;
    }

    const isActiveSubscription = bpRow?.subscription_status === "active";
    const needsBillingInit =
      !bpRow ||
      !bpRow.subscription_status ||
      !bpRow.subscription_tier ||
      (!isActiveSubscription && !bpRow.trial_ends_at) ||
      (!isActiveSubscription && !bpRow.current_period_ends_at);

    if (needsBillingInit && !billingInitInFlightRef.current) {
      billingInitInFlightRef.current = true;
      // Only compute a new trial end date when we truly need to write one for the
      // first time.  Previously this was calculated on every refresh, which silently
      // extended trials each time the hook ran.
      const newTrialEndsIso = !bpRow?.trial_ends_at
        ? new Date(Date.now() + 30 * 86400000).toISOString()
        : null;

      const repair: Record<string, unknown> = {};
      if (!bpRow?.subscription_status) repair.subscription_status = "trial";
      if (!bpRow?.subscription_tier) repair.subscription_tier = "pro";
      if (newTrialEndsIso) repair.trial_ends_at = newTrialEndsIso;
      if (!bpRow?.current_period_ends_at) {
        repair.current_period_ends_at = String(bpRow?.trial_ends_at ?? newTrialEndsIso);
      }

      try {
        if (bpRow) {
          // Only repair fields that are still NULL to avoid overwriting
          // values set concurrently by Stripe webhooks or other devices.
          await supabase
            .from("business_profiles")
            .update(repair)
            .or(`user_id.eq.${uid},owner_id.eq.${uid}`)
            .is("subscription_status", null);
          bpRow = { ...bpRow, ...repair };
        } else if (data) {
          const profileSeed = {
            user_id: uid,
            name: data.name ?? null,
            address: data.address ?? null,
            category: data.category ?? null,
            ...repair,
          };
          const seedByUser = await supabase
            .from("business_profiles")
            .upsert(profileSeed, { onConflict: "user_id" });
          if (seedByUser.error) {
            await supabase
              .from("business_profiles")
              .upsert({ ...profileSeed, owner_id: uid }, { onConflict: "owner_id" });
          }
          bpRow = {
            subscription_status: String(repair.subscription_status ?? "trial"),
            subscription_tier: String(repair.subscription_tier ?? "pro"),
            trial_ends_at: String(repair.trial_ends_at ?? newTrialEndsIso),
            current_period_ends_at: String(repair.current_period_ends_at ?? newTrialEndsIso),
            stripe_customer_id: null,
            stripe_subscription_id: null,
          };
        }
      } catch (err) {
        if (__DEV__) console.warn("[useBusiness] billing init error:", err);
      } finally {
        billingInitInFlightRef.current = false;
      }
    }

    const rawStatus = (bpRow?.subscription_status ?? null) || null;
    const normalizedStatus: SubscriptionStatus =
      rawStatus === "active" || rawStatus === "trial" || rawStatus === "past_due" || rawStatus === "canceled" ? rawStatus : "canceled";
    if (rawStatus && normalizedStatus !== rawStatus) {
      console.warn(`[useBusiness] unrecognized subscription_status "${rawStatus}", treating as "canceled"`);
    }

    // Keep the existing `subscriptionTier` contract for location limits.
    const rawTier = (bpRow?.subscription_tier ?? null) || null;
    const normalizedTier: "pro" | "premium" =
      rawTier === "premium" ? "premium" : "pro";
    if (rawTier && rawTier !== "pro" && rawTier !== "premium") {
      console.warn(`[useBusiness] unrecognized subscription_tier "${rawTier}", treating as "pro"`);
    }

    setSubscriptionStatus(normalizedStatus);
    setTrialEndsAt(bpRow?.trial_ends_at ? String(bpRow.trial_ends_at) : null);
    setCurrentPeriodEndsAt(bpRow?.current_period_ends_at ? String(bpRow.current_period_ends_at) : null);
    setStripeIds({
      stripeCustomerId: bpRow?.stripe_customer_id ? String(bpRow.stripe_customer_id) : null,
      stripeSubscriptionId: bpRow?.stripe_subscription_id ? String(bpRow.stripe_subscription_id) : null,
    });

    // Update the in-memory business subscription tier too, so downstream logic stays consistent.
    setBusiness((prev) => (prev ? { ...prev, subscription_tier: normalizedTier } : prev));

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
