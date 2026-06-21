export const INCLUDED_IMAGE_REVISIONS = 2;

type SupabaseErrorLike = { message?: string; code?: string } | null;

type SupabaseRpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: SupabaseErrorLike }>;
  from: (table: string) => any;
};

export type ChargeableImageRevisionReservation = {
  businessLocationId: string;
  idempotencyKey: string;
  reservationId: string;
  revisionNumber: number;
};

export type ReserveChargeableImageRevisionResult =
  | { ok: true; reservation: ChargeableImageRevisionReservation | null }
  | { ok: false; status: number; errorCode: string; errorMessage: string };

function errorMessage(error: SupabaseErrorLike, fallback: string): string {
  return typeof error?.message === "string" && error.message.trim()
    ? error.message.trim()
    : fallback;
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isImageAffectingRevisionTarget(value: unknown): boolean {
  return value === "image" || value === "both";
}

export function shouldChargeImageRevision(params: {
  isRevision: boolean;
  revisionTarget: unknown;
  revisionNumber: number;
  includedImageRevisions?: number;
}): boolean {
  const included = params.includedImageRevisions ?? INCLUDED_IMAGE_REVISIONS;
  return (
    params.isRevision &&
    isImageAffectingRevisionTarget(params.revisionTarget) &&
    Number.isFinite(params.revisionNumber) &&
    params.revisionNumber > included
  );
}

export async function getDealCreditEnforcementEnabled(client: SupabaseRpcClient): Promise<boolean> {
  const { data, error } = await client.rpc("get_deal_credit_enforcement_enabled");
  if (error) return false;
  return data === true;
}

async function resolvePrimaryBusinessLocationId(
  client: SupabaseRpcClient,
  businessId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("business_locations")
    .select("id")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data || typeof data !== "object") return null;
  return safeString((data as { id?: unknown }).id);
}

export async function reserveChargeableImageRevisionCredit(
  client: SupabaseRpcClient,
  params: {
    businessId: string;
    isRevision: boolean;
    revisionTarget: unknown;
    revisionNumber: number;
    requestGroupId: string;
  },
): Promise<ReserveChargeableImageRevisionResult> {
  const exceedsIncludedAllowance =
    params.isRevision &&
    Number.isFinite(params.revisionNumber) &&
    params.revisionNumber > INCLUDED_IMAGE_REVISIONS;
  if (!exceedsIncludedAllowance) {
    return { ok: true, reservation: null };
  }
  if (!isImageAffectingRevisionTarget(params.revisionTarget)) {
    return {
      ok: false,
      status: 429,
      errorCode: "REVISION_LIMIT",
      errorMessage: "You've revised this ad enough times. Start fresh with a new offer.",
    };
  }

  const enforcementEnabled = await getDealCreditEnforcementEnabled(client);
  if (!enforcementEnabled) {
    return {
      ok: false,
      status: 429,
      errorCode: "REVISION_LIMIT",
      errorMessage: "You've revised this ad enough times. Start fresh with a new offer.",
    };
  }

  const businessLocationId = await resolvePrimaryBusinessLocationId(client, params.businessId);
  if (!businessLocationId) {
    return {
      ok: false,
      status: 409,
      errorCode: "DEAL_CREDIT_REQUIRED",
      errorMessage: "Deal credits are not ready for this location.",
    };
  }

  const idempotencyKey = [
    "extra_image_revision",
    params.businessId,
    params.requestGroupId,
    String(params.revisionNumber),
  ].join(":");
  const { data, error } = await client.rpc("reserve_location_deal_credit", {
    p_business_location_id: businessLocationId,
    p_purpose: "extra_image_revision",
    p_idempotency_key: idempotencyKey,
    p_amount: 1,
    p_deal_id: null,
    p_offer_version_id: null,
    p_recurring_occurrence_id: null,
  });

  const reservationId = safeString(data);
  if (error || !reservationId) {
    return {
      ok: false,
      status: 409,
      errorCode: "DEAL_CREDIT_REQUIRED",
      errorMessage: errorMessage(error, "No deal credits are available for this image revision."),
    };
  }

  return {
    ok: true,
    reservation: {
      businessLocationId,
      idempotencyKey,
      reservationId,
      revisionNumber: params.revisionNumber,
    },
  };
}

export async function commitChargeableImageRevisionCredit(
  client: SupabaseRpcClient,
  reservation: ChargeableImageRevisionReservation,
): Promise<void> {
  const { error } = await client.rpc("commit_location_deal_credit", {
    p_reservation_id: reservation.reservationId,
    p_deal_id: null,
  });
  if (error) throw new Error(errorMessage(error, "Unable to commit deal credit reservation."));
}

export async function releaseChargeableImageRevisionCredit(
  client: SupabaseRpcClient,
  reservation: ChargeableImageRevisionReservation,
  reason: string,
): Promise<void> {
  await client.rpc("release_location_deal_credit", {
    p_reservation_id: reservation.reservationId,
    p_reason: reason,
  });
}
