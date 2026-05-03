import type { SupabaseClient } from "@supabase/supabase-js";

// Soft gate to keep random visitors from signing up as a business during the
// pilot. The same string is checked client-side here AND server-side inside the
// validate_business_invite RPC (see migration 20260706120000_business_invite_gate.sql).
// Compared case-insensitively with whitespace trimmed so a customer pasting
// "Penguin " or "PENGUIN" still works. Rotate this string when the code leaks.
const BUSINESS_INVITE_CODE = "penguin";

export const BUSINESS_INVITE_PENDING_META_KEY = "business_invite_pending";

export function isValidBusinessInviteCode(input: string): boolean {
  return input.trim().toLowerCase() === BUSINESS_INVITE_CODE;
}

// Calls the server RPC that records the user as invite-validated. The RPC also
// re-validates the code, so a forged client check can't bypass the gate.
export async function submitBusinessInvite(
  supabase: SupabaseClient,
  code: string,
): Promise<{ ok: true } | { ok: false; reason: "invalid" | "unauthenticated" | "network" }> {
  const { error } = await supabase.rpc("validate_business_invite", { invite_code: code });
  if (!error) return { ok: true };
  const msg = (error.message ?? "").toLowerCase();
  if (msg.includes("invalid invite code")) return { ok: false, reason: "invalid" };
  if (msg.includes("not authenticated")) return { ok: false, reason: "unauthenticated" };
  return { ok: false, reason: "network" };
}

export async function isUserInviteValidated(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("business_invite_validations")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return data != null;
}
