const QUICK_APPROVAL_TTL_MINUTES = 30;
const QUICK_APPROVAL_ROLES = new Set(["owner", "admin", "moderator", "developer"]);

type QuickApprovalMintInput = {
  applicationId: string;
  applicationStatus: string;
  accessTier: string;
  verificationStatus: string;
  riskScore: number;
  adminEmail: string;
  ownerEmail: string;
  address: string | null;
  phone: string | null;
};

function siteBaseUrl(): string {
  return (Deno.env.get("SITE_URL") ?? "https://www.twoferapp.com").replace(/\/$/, "");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function quickApprovalTokenHash(rawToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function eligibleForQuickApproval(input: QuickApprovalMintInput): boolean {
  return input.applicationStatus === "pending_review" &&
    input.accessTier === "pending_verification" &&
    input.verificationStatus === "verified_low_risk" &&
    Number.isFinite(input.riskScore) &&
    input.riskScore >= 70;
}

export type DuplicateCheckInput = {
  applicationId: string;
  ownerEmail: string;
  address: string | null;
  phone: string | null;
};

// Exported so the confirm path can re-run the same screen on the freshly claimed
// row (a duplicate can appear between token mint and confirmation).
export async function hasPossibleDuplicate(supabaseAdmin: any, input: DuplicateCheckInput): Promise<boolean> {
  const openOrGrantedStatuses = [
    "pending_review",
    "pending_verification",
    "review_required",
    "trial_limited",
    "trial_active",
    "approved_not_billed",
    "active",
  ];
  const applicationChecks: Array<[string, string | null]> = [
    ["email", input.ownerEmail],
    ["address", input.address],
    ["phone", input.phone],
  ];
  for (const [column, value] of applicationChecks) {
    if (!value) continue;
    const { count, error } = await supabaseAdmin
      .from("business_applications")
      .select("id", { count: "exact", head: true })
      .neq("id", input.applicationId)
      .eq(column, value)
      .in("status", openOrGrantedStatuses);
    if (error) throw error;
    if ((count ?? 0) > 0) return true;
  }

  const businessChecks: Array<[string, string | null]> = [
    ["business_email", input.ownerEmail],
    ["address", input.address],
    ["phone", input.phone],
  ];
  for (const [column, value] of businessChecks) {
    if (!value) continue;
    const { count, error } = await supabaseAdmin
      .from("businesses")
      .select("id", { count: "exact", head: true })
      .eq(column, value);
    if (error) throw error;
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

/**
 * Mint a short-lived approval link for the configured alert inbox only when
 * that inbox maps to an active admin who can decide applications. Best-effort:
 * a failure returns null so the normal review email still sends.
 */
export async function mintFullTrialQuickApproval(
  supabaseAdmin: any,
  input: QuickApprovalMintInput,
): Promise<string | null> {
  if (!eligibleForQuickApproval(input)) return null;

  try {
    if (await hasPossibleDuplicate(supabaseAdmin, input)) {
      console.error("[admin-quick-approval] possible duplicate requires normal admin review; omitting quick action.");
      return null;
    }
    const { data: adminUser, error: adminError } = await supabaseAdmin
      .from("admin_users")
      .select("id,email,role,is_active")
      .ilike("email", input.adminEmail)
      .maybeSingle();
    if (adminError) throw adminError;
    if (!adminUser?.is_active || !QUICK_APPROVAL_ROLES.has(String(adminUser.role))) {
      console.error("[admin-quick-approval] configured alert inbox is not an active decision-capable admin; omitting quick action.");
      return null;
    }

    const rawToken = randomToken();
    const tokenHash = await quickApprovalTokenHash(rawToken);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + QUICK_APPROVAL_TTL_MINUTES * 60 * 1000);
    const { data: updatedApplication, error: updateError } = await supabaseAdmin
      .from("business_applications")
      .update({
        quick_approval_token_hash: tokenHash,
        quick_approval_token_expires_at: expiresAt.toISOString(),
        quick_approval_token_issued_at: issuedAt.toISOString(),
        quick_approval_token_issued_to: adminUser.id,
        quick_approval_processing_started_at: null,
        quick_approval_processing_request_id: null,
        quick_approval_token_used_at: null,
        quick_approval_token_used_by: null,
      })
      .eq("id", input.applicationId)
      .eq("status", "pending_review")
      .eq("access_tier", "pending_verification")
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updatedApplication) {
      throw new Error("Application changed before a quick-approval link could be prepared.");
    }

    // Keep the bearer token in the fragment: browsers do not send fragments in
    // HTTP requests or Referer headers. The confirmation page removes it from
    // the address bar before calling the Edge Function.
    return `${siteBaseUrl()}/quick-approve-trial/#token=${encodeURIComponent(rawToken)}`;
  } catch (error) {
    console.error(
      "[admin-quick-approval] could not mint quick action:",
      error instanceof Error ? error.message : "unknown_error",
    );
    return null;
  }
}
