import { getPrimaryBusinessLocationId } from "./billing-suspension.ts";

export const BUSINESS_LOCATION_VERIFICATION_REQUIRED_ERROR_CODE = "BUSINESS_LOCATION_VERIFICATION_REQUIRED";

type RpcResult<T> = PromiseLike<{ data: T | null; error: { message?: string; code?: string } | null }>;

type SupabaseLike = {
  rpc: (fn: string, params?: Record<string, unknown>) => RpcResult<unknown>;
};

export type UnverifiedBusinessLocation = {
  businessLocationId: string;
};

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isMissingVerificationGateError(error: { message?: string; code?: string } | null | undefined): boolean {
  const detail = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return (
    detail.includes("42883") ||
    detail.includes("42p01") ||
    detail.includes("pgrst202") ||
    detail.includes("could not find the function") ||
    detail.includes("is_business_location_publish_verified")
  );
}

export function businessVerificationRequiredResponseBody(action: string): {
  error: string;
  error_code: typeof BUSINESS_LOCATION_VERIFICATION_REQUIRED_ERROR_CODE;
} {
  return {
    error: `This business location must be verified before you can ${action}.`,
    error_code: BUSINESS_LOCATION_VERIFICATION_REQUIRED_ERROR_CODE,
  };
}

export async function isBusinessLocationPublishVerified(
  client: SupabaseLike,
  businessLocationId: string | null | undefined,
): Promise<boolean> {
  const locationId = safeString(businessLocationId);
  if (!locationId) return true;

  const { data, error } = await client.rpc("is_business_location_publish_verified", {
    p_business_location_id: locationId,
  }) as Awaited<RpcResult<unknown>>;

  if (error) {
    if (isMissingVerificationGateError(error)) return true;
    throw new Error(error.message ?? "Unable to check business verification.");
  }

  return data === true;
}

export async function getUnverifiedLocationFromDealRows(
  client: SupabaseLike,
  businessId: string,
  dealRows: Array<Record<string, unknown>>,
): Promise<UnverifiedBusinessLocation | null> {
  const locationIds = [
    ...new Set(
      dealRows
        .map((row) => safeString(row.location_id))
        .filter((locationId): locationId is string => Boolean(locationId)),
    ),
  ];

  if (locationIds.length === 0) {
    const primaryLocationId = await getPrimaryBusinessLocationId(client as any, businessId);
    if (!primaryLocationId) return null;
    locationIds.push(primaryLocationId);
  }

  for (const locationId of locationIds) {
    const verified = await isBusinessLocationPublishVerified(client, locationId);
    if (!verified) return { businessLocationId: locationId };
  }

  return null;
}
