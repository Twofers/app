import { supabase } from "@/lib/supabase";

/**
 * Business name change requests (client side of migration 20260816120000).
 *
 * The lock predicate itself lives in lib/business-name-lock.ts (pure module,
 * re-exported here for convenience). The owner files a proposed name into
 * `business_name_change_requests`; the verified name stays live until Dan
 * approves it in the admin dashboard.
 */

export { BUSINESS_NAME_LOCKED_ERROR, isBusinessNameLocked, NON_PUBLIC_BUSINESS_STATUSES } from "@/lib/business-name-lock";

export type NameChangeRequest = {
  id: string;
  business_id: string;
  proposed_value: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "canceled";
  created_at: string;
};

const REQUEST_COLUMNS = "id,business_id,proposed_value,reason,status,created_at";

/**
 * Loads the open (pending) name change request for a business, if any.
 * Best-effort read: returns null on any error so the profile screen still
 * renders (the request card just shows the "request a change" entry point).
 */
export async function fetchPendingNameChangeRequest(
  businessId: string,
): Promise<NameChangeRequest | null> {
  const { data, error } = await supabase
    .from("business_name_change_requests")
    .select(REQUEST_COLUMNS)
    .eq("business_id", businessId)
    .eq("status", "pending")
    .maybeSingle();
  if (error || !data) return null;
  return data as NameChangeRequest;
}

/**
 * Files a name change request. RLS restricts this to the business owner, and
 * a partial unique index allows only one pending request per business — a
 * duplicate insert surfaces as `{ ok: false, duplicate: true }`.
 */
export async function submitNameChangeRequest(args: {
  businessId: string;
  userId: string;
  currentName: string | null;
  proposedName: string;
  reason?: string | null;
}): Promise<{ ok: boolean; duplicate?: boolean; request?: NameChangeRequest }> {
  const proposed = args.proposedName.trim().replace(/\s+/g, " ").slice(0, 120);
  if (proposed.length < 2) return { ok: false };
  const reason = args.reason?.trim().slice(0, 500) || null;

  const { data, error } = await supabase
    .from("business_name_change_requests")
    .insert({
      business_id: args.businessId,
      requested_by: args.userId,
      current_value: args.currentName ?? null,
      proposed_value: proposed,
      reason,
    })
    .select(REQUEST_COLUMNS)
    .maybeSingle();

  if (error) {
    const duplicate = /duplicate key|23505/i.test(`${error.code ?? ""} ${error.message ?? ""}`);
    return { ok: false, duplicate };
  }
  return { ok: true, request: (data as NameChangeRequest | null) ?? undefined };
}

/** Cancels the owner's own still-pending request. */
export async function cancelNameChangeRequest(requestId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("business_name_change_requests")
    .update({ status: "canceled" })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  return !error && Boolean(data?.id);
}
