// Public share-preview lookup for the /s/<code> web landing (audit F-009).
//
// The website convention keeps the Supabase anon key off the site and calls
// edge-function endpoints instead, so this thin wrapper exposes the already
// anon-safe lookup_deal_share RPC (20260715120000: SECURITY DEFINER, fixed
// public projection, per-row open-count throttle) to the share page. It
// returns ONLY the fields the web preview renders — never claim codes,
// tokens, or private business data.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getServiceRoleKey } from "../_shared/service-role-key.ts";

// Mirrors lib/deal-share-link.ts SHARE_CODE_RE and the RPC's own validation:
// 7 chars from the crockford-ish alphabet (no 0/O/I/L/1).
const SHARE_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{7}$/;

type ShareRow = {
  share_status?: string | null;
  deal_id?: string | null;
  deal_title?: string | null;
  deal_end_time?: string | null;
  business_name?: string | null;
  business_address?: string | null;
  business_logo_url?: string | null;
};

// Mirrors the businesses_public_read predicate (20260814120000): a business
// moved back into a pre-approval state must not keep leaking its identity
// through shares minted while it was live (audit F-002 residual).
const HIDDEN_BUSINESS_STATUSES = new Set(["draft", "pending_verification", "rejected"]);

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  const corsHeaders = getCorsHeaders(req);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed" }, 405);

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(req, { ok: true, share: { share_status: "invalid" } });
    }

    const raw = typeof body.code === "string" ? body.code : "";
    const code = raw.trim().toUpperCase();
    if (!SHARE_CODE_RE.test(code)) {
      return jsonResponse(req, { ok: true, share: { share_status: "invalid" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      getServiceRoleKey(),
    );
    const { data, error } = await supabase.rpc("lookup_deal_share", { lookup_code: code });
    if (error) {
      console.error("[deal-share-lookup] rpc failed:", error.message ?? error);
      return jsonResponse(req, { error: "Lookup failed." }, 500);
    }

    const row = (Array.isArray(data) ? data[0] : data) as ShareRow | null | undefined;
    let status = typeof row?.share_status === "string" ? row.share_status : "not_found";

    // lookup_deal_share has no business-lifecycle filter; enforce the public
    // predicate here so a later-hidden business's name/address/logo never
    // reaches the web preview.
    if (status === "valid" && row?.deal_id) {
      const { data: dealRow, error: dealErr } = await supabase
        .from("deals")
        .select("business_id, businesses!inner(status)")
        .eq("id", row.deal_id)
        .maybeSingle();
      const bizStatus = (dealRow as { businesses?: { status?: string | null } } | null)?.businesses?.status;
      if (dealErr || !bizStatus || HIDDEN_BUSINESS_STATUSES.has(bizStatus)) {
        status = "not_found";
      }
    }

    const isValid = status === "valid";
    // Web preview projection only; expired shares keep name-level context but
    // nothing more (the deal is over — no need to advertise its details).
    return jsonResponse(req, {
      ok: true,
      share: {
        share_status: status,
        deal_title: isValid ? row?.deal_title ?? null : null,
        deal_end_time: isValid ? row?.deal_end_time ?? null : null,
        business_name: isValid ? row?.business_name ?? null : null,
        business_address: isValid ? row?.business_address ?? null : null,
        business_logo_url: isValid ? row?.business_logo_url ?? null : null,
      },
    });
  } catch (err) {
    console.error("[deal-share-lookup] error:", err instanceof Error ? err.message : String(err));
    return jsonResponse(req, { error: "Lookup failed." }, 500);
  }
});
