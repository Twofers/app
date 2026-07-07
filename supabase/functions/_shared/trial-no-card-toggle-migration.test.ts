import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260804123000_trial_no_card_toggle_and_exemption_codes.sql",
  ),
  "utf8",
);

describe("trial_no_card_toggle_and_exemption_codes migration", () => {
  it("adds the global switch defaulting to no-card, and a configurable trial length", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS require_card_for_trial boolean NOT NULL DEFAULT false/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS no_card_trial_days integer NOT NULL DEFAULT 30/);
  });

  it("locks the exemption codes table behind service_role", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.trial_no_card_exemption_codes/);
    expect(migration).toMatch(/REVOKE ALL ON public\.trial_no_card_exemption_codes FROM anon, authenticated/);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON public\.trial_no_card_exemption_codes TO service_role/);
  });

  it("consumes a code atomically and fails closed on invalid/expired/revoked/exhausted codes", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.consume_trial_no_card_exemption_code/);
    expect(migration).toMatch(/AND revoked_at IS NULL/);
    expect(migration).toMatch(/AND \(expires_at IS NULL OR expires_at > p_now\)/);
    expect(migration).toMatch(/AND use_count < max_uses/);
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.consume_trial_no_card_exemption_code\(text, timestamptz\) TO service_role/,
    );
  });
});
