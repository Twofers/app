export const LOCATION_BILLING_SUSPENDED_ERROR_CODE = "LOCATION_BILLING_SUSPENDED";

const SUSPENDED_STATUSES = new Set([
  "trial_expired_payment_failed_suspended",
  "trial_expired_suspended",
  "payment_failed_suspended",
  "canceled_suspended",
  "refunded_suspended",
  "admin_trial_expired_suspended",
]);

type QueryResult<T> = Promise<{ data: T | null; error: { message?: string; code?: string } | null }>;

type SupabaseLike = {
  from: (table: string) => any;
};

export type SuspendedLocation = {
  businessLocationId: string;
  status: string;
  suspensionReason: string | null;
};

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isMissingBillingTableError(error: { message?: string; code?: string } | null | undefined): boolean {
  const detail = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return (
    detail.includes("42p01") ||
    detail.includes("pgrst205") ||
    detail.includes("location_entitlements") ||
    detail.includes("could not find the table")
  );
}

export function isSuspendedBillingStatus(status: unknown, suspendedAt?: unknown): boolean {
  const normalized = safeString(status);
  if (suspendedAt != null && safeString(suspendedAt)) return true;
  return normalized ? SUSPENDED_STATUSES.has(normalized) : false;
}

export function suspendedLocationResponseBody(action: string): {
  error: string;
  error_code: typeof LOCATION_BILLING_SUSPENDED_ERROR_CODE;
} {
  return {
    error: `This location is suspended. Billing must be restored before you can ${action}.`,
    error_code: LOCATION_BILLING_SUSPENDED_ERROR_CODE,
  };
}

export async function getSuspendedLocation(
  client: SupabaseLike,
  businessLocationId: string | null | undefined,
): Promise<SuspendedLocation | null> {
  const locationId = safeString(businessLocationId);
  if (!locationId) return null;

  const { data, error } = await client
    .from("location_entitlements")
    .select("business_location_id,status,suspended_at,suspension_reason")
    .eq("business_location_id", locationId)
    .maybeSingle() as Awaited<QueryResult<Record<string, unknown>>>;

  if (error) {
    if (isMissingBillingTableError(error)) return null;
    return null;
  }
  if (!data || !isSuspendedBillingStatus(data.status, data.suspended_at)) return null;

  return {
    businessLocationId: locationId,
    status: safeString(data.status) ?? "unknown",
    suspensionReason: safeString(data.suspension_reason),
  };
}

export async function getPrimaryBusinessLocationId(
  client: SupabaseLike,
  businessId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("business_locations")
    .select("id")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle() as Awaited<QueryResult<Record<string, unknown>>>;

  if (error || !data) return null;
  return safeString(data.id);
}

export async function getSuspendedPrimaryBusinessLocation(
  client: SupabaseLike,
  businessId: string,
): Promise<SuspendedLocation | null> {
  const locationId = await getPrimaryBusinessLocationId(client, businessId);
  return getSuspendedLocation(client, locationId);
}

export async function getSuspendedLocationFromDealRows(
  client: SupabaseLike,
  businessId: string,
  dealRows: Array<Record<string, unknown>>,
): Promise<SuspendedLocation | null> {
  const locationIds = [
    ...new Set(
      dealRows
        .map((row) => safeString(row.location_id))
        .filter((locationId): locationId is string => Boolean(locationId)),
    ),
  ];

  for (const locationId of locationIds) {
    const suspended = await getSuspendedLocation(client, locationId);
    if (suspended) return suspended;
  }

  if (locationIds.length > 0) return null;
  return getSuspendedPrimaryBusinessLocation(client, businessId);
}
