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
  .select("id,email,role,is_active,require_mfa")
  .order("role")
  .order("email");

if (error) throw error;

const rows = data ?? [];
console.log(JSON.stringify({
  checked_at: new Date().toISOString(),
  total: rows.length,
  require_mfa_false: rows.filter((row) => row.require_mfa !== true),
  privileged_roles: rows.filter((row) => row.role === "owner" || row.role === "admin"),
}, null, 2));
