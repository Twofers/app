import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { cleanString, normalizePhone, type NormalizedBusinessOnboarding } from "./business-onboarding-sync.ts";

type DbClient = SupabaseClient<any, any, any, any, any>;

type StripeCustomer = {
  id: string;
  livemode?: boolean;
};

type StripeLike = {
  customers: {
    create: (params: Record<string, unknown>) => Promise<StripeCustomer>;
    update: (id: string, params: Record<string, unknown>) => Promise<StripeCustomer>;
  };
};

export type BusinessBillingProfileInput = {
  businessId: string;
  ownerUserId?: string | null;
  billingName: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  billingAddressLine1: string | null;
  billingAddressLine2?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingPostalCode?: string | null;
  billingCountry?: string | null;
  billingContactName?: string | null;
  onboardingSource: string;
  launchAreaSlug?: string | null;
  referralSource?: string | null;
  preferredPlan?: string | null;
  sourceRecordId?: string | null;
};

export type EnsureStripeCustomerResult = {
  stripeCustomerId: string | null;
  scheduled: boolean;
  reason: "created" | "updated" | "existing" | "queued";
};

function compactObject(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== "") out[key] = value;
  }
  return out;
}

function addressFromLine(raw: string | null): {
  line1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
} {
  const value = cleanString(raw, 240);
  if (!value) return { line1: null, city: null, state: null, postalCode: null };
  const zip = value.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? null;
  const state = value.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/)?.[1] ?? null;
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  return {
    line1: parts[0] ?? value,
    city: parts.length >= 2 ? parts[1] : null,
    state,
    postalCode: zip,
  };
}

export function billingProfileFromOnboarding(args: {
  businessId: string;
  ownerUserId?: string | null;
  normalized: NormalizedBusinessOnboarding;
  source: string;
  sourceRecordId?: string | null;
}): BusinessBillingProfileInput {
  const address = addressFromLine(args.normalized.address);
  return {
    businessId: args.businessId,
    ownerUserId: args.ownerUserId ?? null,
    billingName: args.normalized.businessName,
    billingEmail: args.normalized.email,
    billingPhone: normalizePhone(args.normalized.phone),
    billingAddressLine1: address.line1,
    billingCity: address.city,
    billingState: address.state,
    billingPostalCode: address.postalCode,
    billingCountry: "US",
    billingContactName: args.normalized.contactName,
    onboardingSource: args.source,
    launchAreaSlug: args.normalized.launchArea,
    preferredPlan: "twofer_pro_monthly",
    sourceRecordId: args.sourceRecordId ?? null,
  };
}

export async function upsertBusinessBillingProfile(
  supabase: DbClient,
  input: BusinessBillingProfileInput,
): Promise<{ id: string | null; stripeCustomerId: string | null }> {
  const fieldSource = {
    billing_name: input.onboardingSource,
    billing_email: input.onboardingSource,
    billing_phone: input.onboardingSource,
    billing_address_line1: input.onboardingSource,
    billing_address_line2: input.onboardingSource,
    billing_city: input.onboardingSource,
    billing_state: input.onboardingSource,
    billing_postal_code: input.onboardingSource,
  };

  const { data, error } = await supabase
    .from("business_billing_profiles")
    .upsert(
      {
        business_id: input.businessId,
        billing_name: input.billingName,
        billing_email: input.billingEmail,
        billing_phone: input.billingPhone,
        billing_address_line1: input.billingAddressLine1,
        billing_address_line2: input.billingAddressLine2 ?? null,
        billing_city: input.billingCity ?? null,
        billing_state: input.billingState ?? null,
        billing_postal_code: input.billingPostalCode ?? null,
        billing_country: input.billingCountry ?? "US",
        billing_contact_user_id: input.ownerUserId ?? null,
        billing_contact_name: input.billingContactName,
        onboarding_source: input.onboardingSource,
        referral_source: input.referralSource ?? null,
        launch_area_slug: input.launchAreaSlug ?? null,
        preferred_plan: input.preferredPlan ?? "twofer_pro_monthly",
        public_profile_source_business_id: input.businessId,
        stripe_sync_status: "pending",
        billing_fields_source: fieldSource,
        metadata: compactObject({
          source_record_id: input.sourceRecordId,
          created_from: input.onboardingSource,
        }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id" },
    )
    .select("id,stripe_customer_id")
    .single();

  if (error) throw error;
  return {
    id: typeof data?.id === "string" ? data.id : null,
    stripeCustomerId: typeof data?.stripe_customer_id === "string" ? data.stripe_customer_id : null,
  };
}

export async function seedBusinessSubscription(
  supabase: DbClient,
  args: {
    businessId: string;
    stripeCustomerId?: string | null;
    source: string;
    trialDays?: number | null;
    accessStatus?: string | null;
  },
) {
  const now = new Date();
  const trialDays = typeof args.trialDays === "number" && args.trialDays > 0 ? args.trialDays : null;
  const trialEnd = trialDays ? new Date(now.getTime() + trialDays * 86400000).toISOString() : null;
  const accessStatus = args.accessStatus === "trial_limited"
    ? "trial_limited"
    : args.accessStatus === "full_trial" || args.accessStatus === "trialing"
      ? "trialing"
      : "pending";
  const billingStatus = accessStatus === "trial_limited" || accessStatus === "trialing" ? "trialing" : "none";

  const { error } = await supabase.from("business_subscriptions").upsert(
    {
      business_id: args.businessId,
      stripe_customer_id: args.stripeCustomerId ?? null,
      billing_status: billingStatus,
      app_access_status: accessStatus,
      trial_type: accessStatus === "trial_limited" ? "remote_limited" : accessStatus === "trialing" ? "remote_full" : null,
      trial_start: trialEnd ? now.toISOString() : null,
      trial_end: trialEnd,
      source: args.source,
      updated_at: now.toISOString(),
    },
    { onConflict: "business_id" },
  );
  if (error) throw error;
}

export async function enqueueStripeCustomerSync(
  supabase: DbClient,
  args: {
    businessId?: string | null;
    onboardingRequestId?: string | null;
    businessApplicationId?: string | null;
    reason: string;
    payload?: Record<string, unknown>;
  },
) {
  const { error } = await supabase.from("stripe_sync_jobs").insert({
    business_id: args.businessId ?? null,
    onboarding_request_id: args.onboardingRequestId ?? null,
    business_application_id: args.businessApplicationId ?? null,
    job_type: "ensure_customer",
    status: "pending",
    attempt_count: 0,
    next_attempt_at: new Date().toISOString(),
    reason: args.reason,
    payload: args.payload ?? {},
  });
  if (error) throw error;
}

export async function ensureStripeCustomerForBusiness(args: {
  supabase: DbClient;
  stripe: StripeLike | null;
  input: BusinessBillingProfileInput;
  source: string;
  trialDays?: number | null;
  accessStatus?: string | null;
  scheduleIfUnavailable?: boolean;
}): Promise<EnsureStripeCustomerResult> {
  const { supabase, stripe, input } = args;
  const billingProfile = await upsertBusinessBillingProfile(supabase, input);
  if (!stripe) {
    if (args.scheduleIfUnavailable !== false) {
      await enqueueStripeCustomerSync(supabase, {
        businessId: input.businessId,
        reason: "stripe_not_configured",
        payload: compactObject({
          source: args.source,
          billing_email: input.billingEmail,
          billing_name: input.billingName,
          source_record_id: input.sourceRecordId,
        }),
      });
    }
    await seedBusinessSubscription(supabase, {
      businessId: input.businessId,
      stripeCustomerId: billingProfile.stripeCustomerId,
      source: args.source,
      trialDays: args.trialDays,
      accessStatus: args.accessStatus,
    });
    return { stripeCustomerId: billingProfile.stripeCustomerId, scheduled: true, reason: "queued" };
  }

  const metadata = compactObject({
    business_id: input.businessId,
    owner_user_id: input.ownerUserId,
    onboarding_source: input.onboardingSource,
    source_record_id: input.sourceRecordId,
    preferred_plan: input.preferredPlan ?? "twofer_pro_monthly",
  });
  const customerPayload = {
    name: input.billingName ?? undefined,
    email: input.billingEmail ?? undefined,
    phone: input.billingPhone ?? undefined,
    address: compactObject({
      line1: input.billingAddressLine1,
      line2: input.billingAddressLine2,
      city: input.billingCity,
      state: input.billingState,
      postal_code: input.billingPostalCode,
      country: input.billingCountry ?? "US",
    }),
    metadata,
  };

  const existingCustomerId = billingProfile.stripeCustomerId;
  const customer = existingCustomerId
    ? await stripe.customers.update(existingCustomerId, customerPayload)
    : await stripe.customers.create(customerPayload);

  const { error } = await supabase
    .from("business_billing_profiles")
    .update({
      stripe_customer_id: customer.id,
      stripe_customer_livemode: customer.livemode === true,
      stripe_sync_status: "synced",
      stripe_sync_error: null,
      last_synced_to_stripe_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", input.businessId);
  if (error) throw error;

  await seedBusinessSubscription(supabase, {
    businessId: input.businessId,
    stripeCustomerId: customer.id,
    source: args.source,
    trialDays: args.trialDays,
    accessStatus: args.accessStatus,
  });

  await supabase.from("billing_events").insert({
    business_id: input.businessId,
    stripe_customer_id: customer.id,
    event_source: "system",
    event_type: existingCustomerId ? "stripe_customer_updated" : "stripe_customer_created",
    status_after: "customer_synced",
    app_access_after: args.accessStatus ?? "pending",
    processing_status: "processed",
    processed_at: new Date().toISOString(),
  });

  return {
    stripeCustomerId: customer.id,
    scheduled: false,
    reason: existingCustomerId ? "updated" : "created",
  };
}
