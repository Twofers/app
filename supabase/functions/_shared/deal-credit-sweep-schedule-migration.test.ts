import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260726124000_deal_credit_reservation_sweep_schedule.sql"),
  "utf8",
);

describe("deal credit reservation sweep schedule migration", () => {
  it("schedules an idempotent pg_cron job for expired credit reservations", () => {
    expect(migration).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions/i);
    expect(migration).toMatch(/cron\.unschedule\('deal-credit-reservation-sweep'\)/i);
    expect(migration).toMatch(/cron\.schedule\(\s*'deal-credit-reservation-sweep'/i);
    expect(migration).toMatch(/'\*\/5 \* \* \* \*'/i);
  });

  it("calls only the server-owned expired reservation sweep helper", () => {
    expect(migration).toMatch(/public\.release_expired_deal_credit_reservations\(500\)/i);
    expect(migration).not.toMatch(/reserve_location_deal_credit/i);
    expect(migration).not.toMatch(/commit_location_deal_credit/i);
    expect(migration).not.toMatch(/consume_location_deal_credit/i);
  });
});
