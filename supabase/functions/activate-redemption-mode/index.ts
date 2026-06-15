import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hashExitToken, hashPin, normalizePin, randomBase64Url, sha256Base64Url } from "../_shared/redemption-crypto.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!anonKey) {
      return json({ error: "Server is missing Supabase anon key." }, 500, corsHeaders);
    }

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

    let body: {
      business_id?: unknown;
      install_id?: unknown;
      device_label?: unknown;
      pin?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON in request body" }, 400, corsHeaders);
    }

    const businessId = cleanText(body.business_id, 80);
    const installId = cleanText(body.install_id, 128);
    const deviceLabel = cleanText(body.device_label, 80) || "Counter device";
    const pin = normalizePin(body.pin);

    if (!UUID_RE.test(businessId)) {
      return json({ error: "Missing or invalid business_id" }, 400, corsHeaders);
    }
    if (installId.length < 8 || installId.length > 128) {
      return json({ error: "Missing or invalid device identifier" }, 400, corsHeaders);
    }
    if (!pin) {
      return json({ error: "Exit PIN must be 4 to 6 digits." }, 400, corsHeaders);
    }

    const { data: business, error: businessError } = await supabaseAdmin
      .from("businesses")
      .select("id,name,owner_id")
      .eq("id", businessId)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (businessError || !business) {
      return json({ error: "You do not own this business." }, 403, corsHeaders);
    }

    let scannerLocationId: string | null = null;
    try {
      const { data: locationRow } = await supabaseAdmin
        .from("business_locations")
        .select("id")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      scannerLocationId = locationRow?.id ?? null;
    } catch {
      scannerLocationId = null;
    }

    const [pinHash, exitToken] = await Promise.all([hashPin(pin), Promise.resolve(randomBase64Url(32))]);
    const exitTokenHash = await hashExitToken(exitToken);
    const nowIso = new Date().toISOString();

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("redemption_devices")
      .select("id,staff_user_id")
      .eq("business_id", businessId)
      .eq("install_id", installId)
      .maybeSingle();

    if (existingError) {
      console.error("[activate-redemption-mode] device lookup failed", existingError);
      return json({ error: "Could not activate Redemption Mode." }, 500, corsHeaders);
    }

    let deviceId = existing?.id as string | undefined;
    let staffUserId = existing?.staff_user_id as string | null | undefined;

    if (deviceId) {
      const deviceUpdate = {
          owner_id: user.id,
          device_label: deviceLabel,
          location_id: scannerLocationId,
          pin_hash: pinHash,
          exit_token_hash: exitTokenHash,
          active: false,
          pin_failed_attempts: 0,
          pin_locked_until: null,
          deactivated_at: null,
          removed_at: null,
          updated_at: nowIso,
        };
      let updateDeviceResult = await supabaseAdmin
        .from("redemption_devices")
        .update(deviceUpdate)
        .eq("id", deviceId);
      if (
        updateDeviceResult.error &&
        (updateDeviceResult.error.code === "PGRST204" || updateDeviceResult.error.code === "42703")
      ) {
        const { location_id: _locationId, ...legacyUpdate } = deviceUpdate;
        updateDeviceResult = await supabaseAdmin
          .from("redemption_devices")
          .update(legacyUpdate)
          .eq("id", deviceId);
      }
      const updateDeviceError = updateDeviceResult.error;
      if (updateDeviceError) {
        console.error("[activate-redemption-mode] device update failed", updateDeviceError);
        return json({ error: "Could not activate Redemption Mode." }, 500, corsHeaders);
      }
    } else {
      const deviceInsert = {
          business_id: businessId,
          owner_id: user.id,
          install_id: installId,
          device_label: deviceLabel,
          location_id: scannerLocationId,
          pin_hash: pinHash,
          exit_token_hash: exitTokenHash,
          active: false,
          created_at: nowIso,
          updated_at: nowIso,
        };
      let insertResult = await supabaseAdmin
        .from("redemption_devices")
        .insert(deviceInsert)
        .select("id")
        .single();
      if (
        insertResult.error &&
        (insertResult.error.code === "PGRST204" || insertResult.error.code === "42703")
      ) {
        const { location_id: _locationId, ...legacyInsert } = deviceInsert;
        insertResult = await supabaseAdmin
          .from("redemption_devices")
          .insert(legacyInsert)
          .select("id")
          .single();
      }
      const { data: inserted, error: insertError } = insertResult;

      if (insertError || !inserted?.id) {
        console.error("[activate-redemption-mode] device insert failed", insertError);
        return json({ error: "Could not activate Redemption Mode." }, 500, corsHeaders);
      }
      deviceId = inserted.id as string;
      staffUserId = null;
    }

    const staffPassword = randomBase64Url(36);
    const appMetadata = {
      app_role: "redeemer",
      business_id: businessId,
      location_id: scannerLocationId,
      redemption_device_id: deviceId,
      owner_id: user.id,
    };
    const userMetadata = {
      device_label: deviceLabel,
      business_name: business.name ?? null,
    };

    let staffEmail: string | undefined;
    if (staffUserId) {
      const { data: updatedUser, error: updateUserError } = await supabaseAdmin.auth.admin.updateUserById(staffUserId, {
        password: staffPassword,
        app_metadata: appMetadata,
        user_metadata: userMetadata,
      });
      if (updateUserError || !updatedUser?.user?.email) {
        console.warn("[activate-redemption-mode] existing staff user missing; creating a replacement", updateUserError);
        staffUserId = null;
      } else {
        staffEmail = updatedUser.user.email ?? undefined;
      }
    }

    if (!staffUserId) {
      const emailHash = (await sha256Base64Url(`${businessId}:${installId}:${deviceId}:${randomBase64Url(8)}`))
        .replace(/_/g, "")
        .replace(/-/g, "")
        .slice(0, 32);
      staffEmail = `redeemer.${emailHash}@staff.twofer.local`;
      const { data: createdUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
        email: staffEmail,
        password: staffPassword,
        email_confirm: true,
        app_metadata: appMetadata,
        user_metadata: userMetadata,
      });
      if (createUserError || !createdUser?.user?.id) {
        console.error("[activate-redemption-mode] staff user create failed", createUserError);
        return json({ error: "Could not create the restricted staff session." }, 500, corsHeaders);
      }
      staffUserId = createdUser.user.id;
    }

    const { error: activateError } = await supabaseAdmin
      .from("redemption_devices")
      .update({
        staff_user_id: staffUserId,
        active: true,
        activated_at: nowIso,
        deactivated_at: null,
        removed_at: null,
        last_seen_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", deviceId);

    if (activateError) {
      console.error("[activate-redemption-mode] final device activation failed", activateError);
      return json({ error: "Could not activate Redemption Mode." }, 500, corsHeaders);
    }

    const staffClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: staffSession, error: signInError } = await staffClient.auth.signInWithPassword({
      email: staffEmail!,
      password: staffPassword,
    });

    if (signInError || !staffSession.session) {
      console.error("[activate-redemption-mode] staff sign-in failed", signInError);
      await supabaseAdmin
        .from("redemption_devices")
        .update({ active: false, deactivated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", deviceId);
      return json({ error: "Could not start the restricted staff session." }, 500, corsHeaders);
    }

    return json(
      {
        ok: true,
        session: staffSession.session,
        device: {
          id: deviceId,
          business_id: businessId,
          device_label: deviceLabel,
          active: true,
          activated_at: nowIso,
        },
        exit_token: exitToken,
      },
      200,
      corsHeaders,
    );
  } catch (err) {
    console.error("[activate-redemption-mode] unexpected error", err);
    return json({ error: "Server error" }, 500, corsHeaders);
  }
});
