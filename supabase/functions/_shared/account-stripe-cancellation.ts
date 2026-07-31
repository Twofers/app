type DbResult<T> = PromiseLike<{ data: T | null; error: unknown }>;

type DbClient = {
  from: (table: string) => any;
};

export type StripeSubscriptionClient = {
  subscriptions: {
    retrieve: (id: string) => Promise<{ id?: string; status?: string; deleted?: boolean }>;
    cancel: (
      id: string,
      params?: { invoice_now?: boolean; prorate?: boolean },
    ) => Promise<{ id?: string; status?: string }>;
  };
};

export type AccountStripeCancellationResult = {
  subscriptionIds: string[];
  canceledIds: string[];
  alreadyEndedIds: string[];
};

function cleanStripeSubscriptionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id.startsWith("sub_") ? id : null;
}

export function uniqueStripeSubscriptionIds(values: unknown[]): string[] {
  return [...new Set(values.map(cleanStripeSubscriptionId).filter((id): id is string => Boolean(id)))];
}

function isAlreadyMissingStripeResource(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; statusCode?: unknown; raw?: { code?: unknown } };
  return value.code === "resource_missing" ||
    value.raw?.code === "resource_missing" ||
    value.statusCode === 404;
}

/**
 * Cancels every provider-backed subscription attached to the supplied
 * businesses before account archival/deletion continues. The operation is
 * idempotent: already-canceled or missing Stripe records are treated as ended.
 */
export async function cancelStripeForBusinesses(args: {
  supabase: DbClient;
  stripe: StripeSubscriptionClient | null;
  businessIds: string[];
  source: "account_self_delete" | "admin_account_archive" | "admin_account_delete";
}): Promise<AccountStripeCancellationResult> {
  if (!args.businessIds.length) {
    return { subscriptionIds: [], canceledIds: [], alreadyEndedIds: [] };
  }

  const [businessSubscriptions, locationEntitlements] = await Promise.all([
    args.supabase
      .from("business_subscriptions")
      .select("business_id,stripe_subscription_id")
      .in("business_id", args.businessIds) as DbResult<Array<Record<string, unknown>>>,
    args.supabase
      .from("location_entitlements")
      .select("business_location_id,provider_subscription_id,business_locations!inner(business_id)")
      .in("business_locations.business_id", args.businessIds) as DbResult<Array<Record<string, unknown>>>,
  ]);

  if (businessSubscriptions.error) throw businessSubscriptions.error;
  if (locationEntitlements.error) throw locationEntitlements.error;

  const subscriptionIds = uniqueStripeSubscriptionIds([
    ...(businessSubscriptions.data ?? []).map((row) => row.stripe_subscription_id),
    ...(locationEntitlements.data ?? []).map((row) => row.provider_subscription_id),
  ]);

  if (subscriptionIds.length && !args.stripe) {
    throw Object.assign(new Error("Stripe is required to cancel this account's active billing."), {
      code: "stripe_not_configured",
    });
  }

  const canceledIds: string[] = [];
  const alreadyEndedIds: string[] = [];
  for (const subscriptionId of subscriptionIds) {
    try {
      const subscription = await args.stripe!.subscriptions.retrieve(subscriptionId);
      if (subscription.deleted === true || subscription.status === "canceled") {
        alreadyEndedIds.push(subscriptionId);
        continue;
      }
      await args.stripe!.subscriptions.cancel(subscriptionId, {
        invoice_now: false,
        prorate: false,
      });
      canceledIds.push(subscriptionId);
    } catch (error) {
      if (isAlreadyMissingStripeResource(error)) {
        alreadyEndedIds.push(subscriptionId);
        continue;
      }
      throw error;
    }
  }

  const now = new Date().toISOString();
  const subscriptionUpdate = await args.supabase
    .from("business_subscriptions")
    .update({
      billing_status: "canceled",
      app_access_status: "canceled",
      cancel_at_period_end: false,
      canceled_at: now,
      ended_at: now,
      access_locked_at: now,
      access_locked_reason: args.source,
      updated_at: now,
    })
    .in("business_id", args.businessIds);
  if (subscriptionUpdate.error) throw subscriptionUpdate.error;

  const { data: locations, error: locationsError } = await args.supabase
    .from("business_locations")
    .select("id,business_id")
    .in("business_id", args.businessIds);
  if (locationsError) throw locationsError;
  const locationIds = (locations ?? []).map((row: { id?: unknown }) => row.id).filter((id: unknown): id is string =>
    typeof id === "string"
  );
  if (locationIds.length) {
    const entitlementUpdate = await args.supabase
      .from("location_entitlements")
      .update({
        status: "canceled_suspended",
        cancel_at_period_end: false,
        suspended_at: now,
        suspension_reason: args.source,
        updated_at: now,
      })
      .in("business_location_id", locationIds);
    if (entitlementUpdate.error) throw entitlementUpdate.error;
  }

  for (const businessId of args.businessIds) {
    const { error } = await args.supabase.from("billing_events").insert({
      business_id: businessId,
      event_source: args.source === "account_self_delete" ? "system" : "admin",
      event_type: "account_subscription_canceled",
      status_after: "canceled",
      app_access_after: "canceled",
      processing_status: "processed",
      processed_at: now,
      raw_event: {
        source: args.source,
        subscription_ids: subscriptionIds,
      },
    });
    if (error) throw error;
  }

  return { subscriptionIds, canceledIds, alreadyEndedIds };
}
