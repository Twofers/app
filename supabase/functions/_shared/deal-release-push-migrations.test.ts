import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const eventsMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260729120000_deal_release_push_events.sql"),
  "utf8",
);

const cronMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260729121000_deal_release_push_cron_schedule.sql"),
  "utf8",
);

describe("deal release push migrations", () => {
  it("creates a service-role-only idempotency table for one release push per deal", () => {
    expect(eventsMigration).toMatch(/CREATE TABLE IF NOT EXISTS public\.deal_push_events/i);
    expect(eventsMigration).toMatch(/UNIQUE \(deal_id, push_kind\)/i);
    expect(eventsMigration).toMatch(/ALTER TABLE public\.deal_push_events ENABLE ROW LEVEL SECURITY/i);
    expect(eventsMigration).toMatch(/REVOKE ALL ON TABLE public\.deal_push_events FROM anon, authenticated/i);
    expect(eventsMigration).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE public\.deal_push_events TO service_role/i);
  });

  it("backs future scheduled deals into pending events without retroactive live sends", () => {
    expect(eventsMigration).toMatch(/d\.start_time > now\(\)/i);
    expect(eventsMigration).toMatch(/'pending'/i);
    expect(eventsMigration).toMatch(/'suppressed_preexisting'/i);
  });

  it("schedules the due dispatcher through a Vault-backed cron secret", () => {
    expect(eventsMigration).toMatch(/verify_deal_release_push_secret/i);
    expect(cronMigration).toMatch(/cron\.schedule/i);
    expect(cronMigration).toMatch(/send-due-deal-release-pushes/i);
    expect(cronMigration).toMatch(/deal_release_push_cron_secret/i);
    expect(cronMigration).toMatch(/"dispatch_due":true/i);
  });
});
