import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260726123000_deal_credit_consumption_helpers.sql"),
  "utf8",
);

describe("deal credit enforcement migration", () => {
  it("keeps credit enforcement disabled by default for the free pilot", () => {
    expect(migration).toMatch(/deal_credit_enforcement_enabled boolean NOT NULL DEFAULT false/i);
    expect(migration).toMatch(/get_deal_credit_enforcement_enabled/i);
  });

  it("adds server-owned reserve, commit, release, consume, and sweep helpers", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.reserve_location_deal_credit/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.commit_location_deal_credit/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.release_location_deal_credit/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.consume_location_deal_credit/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.release_expired_deal_credit_reservations/i);
    expect(migration).toMatch(/credits_reserved = credits_reserved \+ p_amount/i);
    expect(migration).toMatch(/credits_used = credits_used \+ v_reservation\.amount/i);
  });

  it("wires one-time deal inserts through server-side transactional credit consumption", () => {
    expect(migration).toMatch(/CREATE TRIGGER deals_set_deal_credit_location_before_insert/i);
    expect(migration).toMatch(/CREATE TRIGGER deals_charge_deal_credit_after_insert/i);
    expect(migration).toMatch(/IF COALESCE\(NEW\.is_recurring, false\) THEN/i);
    expect(migration).toMatch(/'new_deal:' \|\| v_location_id::text \|\| ':' \|\| NEW\.id::text/i);
    expect(migration).toMatch(/PERFORM public\.consume_location_deal_credit/i);
  });

  it("does not expose credit mutation helpers to normal app users", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.reserve_location_deal_credit/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.commit_location_deal_credit/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.release_location_deal_credit/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.reserve_location_deal_credit[\s\S]+TO service_role/i);
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.reserve_location_deal_credit[\s\S]+TO authenticated/i);
  });
});
