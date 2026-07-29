import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("anonymous-write flood protection", () => {
  it("atomically rate-limits pre-auth analytics by HMAC actor and global ceiling", () => {
    const source = read("supabase/functions/ingest-analytics-event/index.ts");
    const helper = read("supabase/functions/_shared/anonymous-request-hash.ts");
    const migration = read("supabase/migrations/20260824125000_anonymous_analytics_rate_limit.sql");
    expect(source).toMatch(/consume_anonymous_endpoint_attempt/);
    expect(source).toMatch(/p_actor_limit: 60/);
    expect(source).toMatch(/p_global_limit: 5000/);
    expect(helper).toMatch(/ANON_ABUSE_IP_HASH_SECRET/);
    expect(helper).toMatch(/HMAC/);
    expect(helper).toMatch(/anonymousAbuseKeyHash/);
    expect(migration).toMatch(/pg_advisory_xact_lock/);
    expect(migration).toMatch(/REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/i);
  });

  it("keeps QR scan writes behind the existing per-IP and campaign ceilings", () => {
    const migration = read("supabase/migrations/20260815132000_fix_qr_campaign_scan_event_recording.sql");
    expect(migration).toMatch(/v_recent_campaign_scans >= 2000/);
    expect(migration).toMatch(/v_recent_ip_scans >= 30/);
    expect(migration).toMatch(/FOR UPDATE/);
  });

  it("stores only HMAC-pseudonymized identifiers for public intake rate limits", () => {
    const application = read("supabase/functions/submit-business-application/index.ts");
    const signup = read("supabase/functions/submit-launch-signup/index.ts");
    const migration = read("supabase/migrations/20260824130000_atomic_submission_rate_limit.sql");
    expect(application).toMatch(/anonymousAbuseKeyHash\("business-application-email"/);
    expect(application).toMatch(/anonymousAbuseKeyHash\("business-application-ip"/);
    expect(signup).toMatch(/anonymousAbuseKeyHash\("launch-signup-ip"/);
    expect(migration).toMatch(/\^\[a-f0-9\]\{64\}\$/);
    expect(migration).toMatch(/business_application_alert/);
    expect(migration).toMatch(/p_max_global/);
  });

  it("places customer deletion behind per-user and global daily ceilings", () => {
    const source = read("supabase/functions/delete-user-account/index.ts");
    const migration = read("supabase/migrations/20260824124000_account_deletion_rate_limit.sql");
    expect(source).toMatch(/p_max_attempts: 3/);
    expect(source).toMatch(/p_global_max: 50/);
    expect(migration).toMatch(/account-deletion-global/);
    expect(migration).toMatch(/v_global_count >= p_global_max/);
  });
});
