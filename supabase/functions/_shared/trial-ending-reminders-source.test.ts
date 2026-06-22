import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const functionSource = readFileSync(
  join(process.cwd(), "supabase", "functions", "send-trial-ending-reminders", "index.ts"),
  "utf8",
);
const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260726130000_trial_ending_reminder_events.sql"),
  "utf8",
);
const config = readFileSync(join(process.cwd(), "supabase", "config.toml"), "utf8");

describe("send-trial-ending-reminders function source", () => {
  it("uses cron-secret authorization and supports dry runs", () => {
    expect(functionSource).toMatch(/x-cron-secret/i);
    expect(functionSource).toMatch(/CRON_SECRET/);
    expect(functionSource).toMatch(/verify_billing_reminder_secret/);
    expect(functionSource).toMatch(/dry_run/);
  });

  it("targets only active card-required trials near the 24-hour window", () => {
    expect(functionSource).toMatch(/from\("location_entitlements"\)/);
    expect(functionSource).toMatch(/eq\("status", "trial_active"\)/);
    expect(functionSource).toMatch(/TRIAL_ENDING_PUSH_MIN_LEAD_HOURS/);
    expect(functionSource).toMatch(/TRIAL_ENDING_PUSH_MAX_LEAD_HOURS/);
    expect(functionSource).not.toMatch(/admin_trial_active/);
  });

  it("records idempotency before sending owner billing pushes", () => {
    expect(functionSource).toMatch(/billing_trial_reminder_events/);
    expect(functionSource).toMatch(/TRIAL_ENDING_PUSH_KIND/);
    expect(functionSource).toMatch(/sendExpoPushMessages/);
    expect(functionSource).toMatch(/path: "\/\(tabs\)\/billing"/);
  });
});

describe("trial ending reminder migration", () => {
  it("adds a server-owned idempotency table for reminder delivery", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.billing_trial_reminder_events/i);
    expect(migration).toMatch(/UNIQUE \(business_location_id, reminder_kind, trial_ends_at\)/i);
    expect(migration).toMatch(/reminder_kind IN \('trial_ends_24h_push'\)/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.billing_trial_reminder_events FROM anon, authenticated/i);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE public\.billing_trial_reminder_events TO service_role/i);
  });

  it("adds a service-only billing reminder cron secret verifier", () => {
    expect(migration).toMatch(/billing_reminder_cron_secret/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.verify_billing_reminder_secret/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.verify_billing_reminder_secret\(text\) TO service_role/i);
    expect(migration).not.toMatch(/TO authenticated/i);
  });
});

describe("trial ending reminder function config", () => {
  it("registers the cron-triggered function without JWT verification", () => {
    expect(config).toMatch(/\[functions\.send-trial-ending-reminders\][\s\S]*?verify_jwt = false/);
  });
});
