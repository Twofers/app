import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { CURRENT_BUSINESS_TERMS_VERSION } from "../_shared/business-onboarding-sync.ts";

type DbClient = SupabaseClient<any, any, any, any, any>;

type Payload = {
  business_id?: unknown;
};

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// Owner or an active owner/manager member may accept the business terms on
// behalf of the business. Mirrors update-business-profile-section's
// assertCanEdit so the two "who can act for this business" checks stay in sync.
async function assertCanAccept(
  supabase: DbClient,
  businessId: string,
  userId: string,
  email: string,
): Promise<boolean> {
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id,owner_id")
    .eq("id", businessId)
    .maybeSingle();
  if (businessError) throw businessError;
  const businessRow = business as { owner_id?: string } | null;
  if (!businessRow) return false;
  if (businessRow.owner_id === userId) return true;

  const { data: member, error: memberError } = await supabase
    .from("business_members")
    .select("id,role,status")
    .eq("business_id", businessId)
    .or(`user_id.eq.${userId},invited_email.eq.${email}`)
    .maybeSingle();
  if (memberError) throw memberError;
  const memberRow = member as { status?: string; role?: string } | null;
  return memberRow?.status === "active" && ["owner", "manager"].includes(String(memberRow.role));
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, { error: "Business terms acceptance is not configured." }, 500);
    }

    const body = (await req.json().catch(() => ({}))) as Payload;
    const businessId = body.business_id;
    if (!isUuid(businessId)) {
      return json(req, { error: "Invalid business_id." }, 400);
    }

    const supabaseUser = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();
    if (userError || !user) return json(req, { error: "Unauthorized." }, 401);
    if (isRedeemerUser(user)) return forbiddenForRedeemerResponse(corsHeaders);
    const email = user.email?.trim().toLowerCase() ?? "";

    if (!(await assertCanAccept(supabaseAdmin, businessId, user.id, email))) {
      return json(req, { error: "Forbidden." }, 403);
    }

    // Explicit owner action only: this is the one place a terms_acceptances
    // row gets written outside of a pre-checked website signup. No other
    // caller (admin trial creation, claim-link, admin decisions) may insert here.
    const { error: insertError } = await supabaseAdmin.from("terms_acceptances").upsert(
      {
        business_id: businessId,
        user_id: user.id,
        document_type: "business_terms",
        document_version: CURRENT_BUSINESS_TERMS_VERSION,
        source: "app_owner_explicit",
      },
      { onConflict: "business_id,document_type,document_version,source" },
    );
    if (insertError) throw insertError;

    await supabaseAdmin.from("business_profile_revision_log").insert({
      business_id: businessId,
      actor_user_id: user.id,
      actor_type: "authenticated_business_owner",
      source: "app_owner_explicit",
      section_key: "terms_acceptance",
      after_value: { document_type: "business_terms", document_version: CURRENT_BUSINESS_TERMS_VERSION },
      reason: "owner_accepted_business_terms",
    });

    const { data: publishData, error: publishError } = await supabaseUser.rpc("can_business_publish", {
      p_business_id: businessId,
    });
    if (publishError) throw publishError;

    return json(req, {
      ok: true,
      publish: publishData ?? null,
    });
  } catch (error) {
    console.error("[accept-business-terms] error:", error);
    return json(req, { error: "Could not record terms acceptance." }, 500);
  }
});
