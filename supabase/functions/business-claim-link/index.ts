import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { isRedeemerUser } from "../_shared/redemption-role.ts";
import {
  cleanEmail,
  cleanString,
  createOnboardingRequest,
  normalizePhone,
  type NormalizedBusinessOnboarding,
} from "../_shared/business-onboarding-sync.ts";

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

async function readPayload(req: Request): Promise<Record<string, unknown>> {
  if (req.method === "GET") {
    const url = new URL(req.url);
    return { token: url.searchParams.get("token"), action: "preview" };
  }
  try {
    const payload = await req.json();
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function tokenFromPayload(req: Request, payload: Record<string, unknown>): string {
  const fromPayload = typeof payload.token === "string" ? payload.token.trim() : "";
  if (fromPayload) return fromPayload;
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("token")?.trim() ?? "";
  if (fromQuery) return fromQuery;
  const segments = url.pathname.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

function normalizeFromTarget(target: Record<string, unknown>, email: string, contactName: string, phone: string | null): NormalizedBusinessOnboarding {
  return {
    businessName: String(target.display_name ?? target.name ?? ""),
    contactName,
    email,
    phone,
    address: String(target.address_line1 ?? target.address ?? target.location ?? "") || null,
    businessType: String(target.category ?? "") || null,
    websiteOrInstagram: null,
    slowHours: null,
    offerInterests: "Interested in controlled local offers through Twofer.",
    launchArea: String(target.city ?? "") || null,
    termsAccepted: false,
    privacyAcknowledged: false,
  };
}

async function safeTarget(supabase: any, link: Record<string, unknown>) {
  if (link.prospect_id) {
    const { data, error } = await supabase
      .from("business_prospects")
      .select("id,display_name,category,city,state,postal_code,address_line1,status,review_status")
      .eq("id", link.prospect_id as string)
      .maybeSingle();
    if (error) throw error;
    return data ? { type: "prospect", row: data as Record<string, unknown> } : null;
  }
  const { data, error } = await supabase
    .from("businesses")
    .select("id,name,category,city,state,postal_code,address,location,status,access_level")
    .eq("id", link.business_id as string)
    .maybeSingle();
  if (error) throw error;
  return data ? { type: "business", row: data as Record<string, unknown> } : null;
}

function previewBody(target: { type: string; row: Record<string, unknown> }) {
  const row = target.row;
  return {
    type: target.type,
    id: row.id,
    business_name: row.display_name ?? row.name,
    city: row.city ?? null,
    state: row.state ?? null,
    category: row.category ?? null,
    public_label_state: target.type === "prospect" ? "Not on Twofer yet" : "On Twofer",
    statement: "This profile is not active on Twofer until you claim and complete setup.",
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, { error: "Business claim is not configured." }, 500);
    }

    const payload = await readPayload(req);
    const token = tokenFromPayload(req, payload);
    if (!token || token.length < 20) return json(req, { error: "Invalid claim link." }, 400);

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const tokenHash = await sha256Hex(token);
    const { data: link, error: linkError } = await supabaseAdmin
      .from("business_claim_links")
      .select("id,prospect_id,business_id,expires_at,max_uses,uses_count,accepted_by_user_id,accepted_at,revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link || link.revoked_at) return json(req, { error: "This claim link is not active." }, 404);
    if (new Date(String(link.expires_at)).getTime() <= Date.now()) {
      return json(req, { error: "This claim link has expired." }, 410);
    }
    if (Number(link.uses_count) >= Number(link.max_uses)) {
      return json(req, { error: "This claim link has already been used." }, 410);
    }

    const target = await safeTarget(supabaseAdmin, link as Record<string, unknown>);
    if (!target) return json(req, { error: "Claim target was not found." }, 404);
    const preview = previewBody(target);
    const action = cleanString(payload.action, 40) || "preview";
    if (req.method === "GET" || action === "preview") {
      return json(req, { ok: true, preview });
    }

    const ownerEmail = cleanEmail(payload.owner_email);
    const contactName = cleanString(payload.contact_name, 120);
    const phone = normalizePhone(cleanString(payload.phone, 40));
    if (!ownerEmail || !contactName) {
      return json(req, { error: "Owner or manager name and verified email are required." }, 400);
    }

    let acceptedByUserId: string | null = null;
    if (authHeader) {
      const supabaseUser = createClient(supabaseUrl, serviceRoleKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
      } = await supabaseUser.auth.getUser();
      if (user && !isRedeemerUser(user) && user.email?.toLowerCase() === ownerEmail) {
        acceptedByUserId = user.id;
      }
    }

    const normalized = normalizeFromTarget(target.row, ownerEmail, contactName, phone);
    const { data: application, error: applicationError } = await supabaseAdmin
      .from("business_applications")
      .insert({
        business_name: normalized.businessName,
        contact_name: normalized.contactName,
        email: normalized.email,
        phone: normalized.phone,
        address: normalized.address,
        business_type: normalized.businessType,
        offer_interests: normalized.offerInterests,
        launch_area: normalized.launchArea,
        terms_accepted: false,
        privacy_acknowledged: false,
        source: "prospect_claim_link",
        status: "pending_verification",
        access_tier: "pending_verification",
        verification_status: acceptedByUserId ? "in_progress" : "needs_review",
        risk_score: acceptedByUserId ? 60 : 40,
        risk_reasons: acceptedByUserId ? ["claim_link_authenticated_email_match"] : ["claim_link_owner_email_unverified"],
        business_id: target.type === "business" ? target.row.id : null,
      })
      .select("id")
      .single();
    if (applicationError) throw applicationError;

    const onboardingRequestId = await createOnboardingRequest(supabaseAdmin, normalized, {
      claim_link_id: link.id,
      target_type: target.type,
      target_id: target.row.id,
    }, {
      applicationId: application.id,
      status: "pending_verification",
      riskScore: acceptedByUserId ? 60 : 40,
      riskLevel: acceptedByUserId ? "medium" : "high",
    });

    await supabaseAdmin
      .from("business_applications")
      .update({ onboarding_request_id: onboardingRequestId })
      .eq("id", application.id);

    await supabaseAdmin
      .from("business_claim_links")
      .update({
        uses_count: Number(link.uses_count) + 1,
        accepted_by_user_id: acceptedByUserId,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", link.id);

    if (target.type === "prospect") {
      await supabaseAdmin.from("business_prospects").update({ status: "claimed" }).eq("id", target.row.id as string);
      await supabaseAdmin.from("prospect_to_business_links").insert({
        prospect_id: target.row.id,
        business_application_id: application.id,
        business_onboarding_request_id: onboardingRequestId,
        business_id: null,
        conversion_type: "claim_started",
      });
      await supabaseAdmin
        .from("sales_accounts")
        .update({ stage: "claimed", next_action: "Owner started claim; verify account setup" })
        .eq("prospect_id", target.row.id as string);
    }

    await supabaseAdmin.from("admin_audit_log").insert({
      action: "business_claim_link_started",
      target_type: target.type === "prospect" ? "business_prospect" : "business",
      target_id: target.row.id,
      business_id: target.type === "business" ? target.row.id : null,
      after_value: {
        claim_link_id: link.id,
        business_application_id: application.id,
        business_onboarding_request_id: onboardingRequestId,
        authenticated_email_match: Boolean(acceptedByUserId),
      },
      reason: "claim_link_started",
    });

    return json(req, {
      ok: true,
      preview,
      next_step: acceptedByUserId
        ? "Open the Twofer app with this email to finish business setup."
        : "Check your email and sign in with this business email to finish setup before the profile can become active.",
    });
  } catch (error) {
    console.error("[business-claim-link] error:", error);
    return json(req, { error: "Could not process this claim link." }, 500);
  }
});
