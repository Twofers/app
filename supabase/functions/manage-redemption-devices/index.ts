import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { getServiceRoleKey } from "../_shared/service-role-key.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanUuid(value: unknown): string {
  return typeof value === "string" && UUID_RE.test(value.trim()) ? value.trim() : "";
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, corsHeaders);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = getServiceRoleKey();
    const supabaseUser = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return json({ error: "Unauthorized. Please log in as the business owner." }, 401, corsHeaders);
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    let body: { action?: unknown; business_id?: unknown; device_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON in request body" }, 400, corsHeaders);
    }

    const action = typeof body.action === "string" ? body.action : "list";
    const businessId = cleanUuid(body.business_id);
    if (!businessId) {
      return json({ error: "Missing business_id" }, 400, corsHeaders);
    }

    const { data: business, error: businessError } = await supabaseAdmin
      .from("businesses")
      .select("id")
      .eq("id", businessId)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (businessError || !business) {
      return json({ error: "You do not own this business." }, 403, corsHeaders);
    }

    if (action === "list") {
      const { data, error } = await supabaseAdmin
        .from("redemption_devices")
        .select("id,business_id,device_label,active,activated_at,deactivated_at,last_seen_at,created_at,updated_at")
        .eq("business_id", businessId)
        .is("removed_at", null)
        .order("updated_at", { ascending: false });
      if (error) {
        console.error("[manage-redemption-devices] list failed", error);
        return json({ error: "Could not load redemption devices." }, 500, corsHeaders);
      }
      return json({ ok: true, devices: data ?? [] }, 200, corsHeaders);
    }

    const deviceId = cleanUuid(body.device_id);
    if (!deviceId) {
      return json({ error: "Missing device_id" }, 400, corsHeaders);
    }

    const { data: device, error: deviceError } = await supabaseAdmin
      .from("redemption_devices")
      .select("id,staff_user_id")
      .eq("id", deviceId)
      .eq("business_id", businessId)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (deviceError || !device) {
      return json({ error: "Device not found." }, 404, corsHeaders);
    }

    const nowIso = new Date().toISOString();
    if (action === "deactivate") {
      const { error } = await supabaseAdmin
        .from("redemption_devices")
        .update({
          active: false,
          deactivated_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", deviceId);
      if (error) {
        console.error("[manage-redemption-devices] deactivate failed", error);
        return json({ error: "Could not deactivate device." }, 500, corsHeaders);
      }
      return json({ ok: true }, 200, corsHeaders);
    }

    if (action === "remove") {
      const staffUserId = typeof device.staff_user_id === "string" ? device.staff_user_id : null;
      if (staffUserId) {
        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(staffUserId);
        if (deleteError) {
          console.error("[manage-redemption-devices] delete staff user failed", deleteError);
          return json({ error: "Could not remove the restricted staff user." }, 500, corsHeaders);
        }
      }
      const { error } = await supabaseAdmin
        .from("redemption_devices")
        .update({
          active: false,
          staff_user_id: null,
          deactivated_at: nowIso,
          removed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", deviceId);
      if (error) {
        console.error("[manage-redemption-devices] remove failed", error);
        return json({ error: "Could not remove device." }, 500, corsHeaders);
      }
      return json({ ok: true }, 200, corsHeaders);
    }

    return json({ error: "Unsupported action." }, 400, corsHeaders);
  } catch (err) {
    console.error("[manage-redemption-devices] unexpected error", err);
    return json({ error: "Server error" }, 500, corsHeaders);
  }
});
