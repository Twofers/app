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
const { data, error } = await client.storage.listBuckets();
if (error) throw error;

console.log(JSON.stringify({
  checked_at: new Date().toISOString(),
  buckets: (data ?? []).map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
    public: bucket.public,
    file_size_limit: bucket.file_size_limit,
    allowed_mime_types: bucket.allowed_mime_types,
  })),
}, null, 2));
