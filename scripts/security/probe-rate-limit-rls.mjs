// Read-only production probe for the private rate-limit ledgers and RPCs.
// It uses only the public anon credential and succeeds only when every object
// exists but rejects the anon role. It never prints response bodies or keys.

process.loadEnvFile(".env");

const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!baseUrl || !anonKey) {
  throw new Error("Missing public Supabase configuration in .env");
}

const headers = {
  apikey: anonKey,
  Authorization: `Bearer ${anonKey}`,
  "Content-Type": "application/json",
};

const checks = [
  {
    name: "table account_deletion_attempts",
    path: "/rest/v1/account_deletion_attempts?select=id&limit=1",
    method: "GET",
  },
  {
    name: "table anonymous_endpoint_attempts",
    path: "/rest/v1/anonymous_endpoint_attempts?select=id&limit=1",
    method: "GET",
  },
  {
    name: "table submission_rate_events",
    path: "/rest/v1/submission_rate_events?select=id&limit=1",
    method: "GET",
  },
  {
    name: "RPC consume_account_deletion_attempt",
    path: "/rest/v1/rpc/consume_account_deletion_attempt",
    method: "POST",
    body: {
      p_user_id: "00000000-0000-0000-0000-000000000000",
      p_max_attempts: 1,
      p_global_max: 1,
    },
  },
  {
    name: "RPC consume_anonymous_endpoint_attempt",
    path: "/rest/v1/rpc/consume_anonymous_endpoint_attempt",
    method: "POST",
    body: {
      p_surface: "probe",
      p_actor_hash: "0".repeat(64),
      p_actor_limit: 1,
      p_global_limit: 1,
      p_window_seconds: 60,
    },
  },
  {
    name: "RPC claim_submission_slot",
    path: "/rest/v1/rpc/claim_submission_slot",
    method: "POST",
    body: {
      p_bucket: "launch_signup",
      p_email_key: null,
      p_ip_key: "0".repeat(64),
      p_window_minutes: 1,
      p_max_email: 0,
      p_max_ip: 1,
      p_max_global: 1,
    },
  },
];

let failures = 0;
for (const check of checks) {
  const response = await fetch(`${baseUrl}${check.path}`, {
    method: check.method,
    headers,
    body: check.body ? JSON.stringify(check.body) : undefined,
  });
  const deniedAsExpected = response.status === 401 || response.status === 403;
  console.log(
    `${check.name}: ${response.status} ${
      deniedAsExpected ? "denied as expected" : "UNEXPECTED"
    }`,
  );
  if (!deniedAsExpected) failures += 1;
}

if (failures > 0) {
  throw new Error(`${failures} private rate-limit object probe(s) failed`);
}
