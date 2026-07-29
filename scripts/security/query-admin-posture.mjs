import { createClient } from "@supabase/supabase-js";

const envFiles = process.argv.slice(2);
for (const envFile of envFiles.length ? envFiles : [".env.test"]) {
  process.loadEnvFile(envFile);
}

const supabaseUrl =
  process.env.SUPABASE_URL ??
  process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SECRET_KEY_Production;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(`Missing Supabase URL/service-role key in: ${envFiles.join(", ") || ".env.test"}.`);
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await client
  .from("admin_users")
  .select("role,is_active,require_mfa");

if (error) throw error;

const rows = data ?? [];
if (rows.length === 0) {
  throw new Error("Admin posture check failed: no admin rows exist.");
}
if (rows.some((row) => row.require_mfa !== true)) {
  throw new Error("Admin posture check failed: at least one admin row does not require MFA.");
}
if (!rows.some((row) => row.role === "owner" && row.is_active === true)) {
  throw new Error("Admin posture check failed: no active owner exists.");
}

console.log("Admin posture check passed.");
