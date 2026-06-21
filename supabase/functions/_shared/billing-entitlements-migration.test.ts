import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260726120000_location_billing_entitlements.sql"),
  "utf8",
);

describe("location billing entitlement migration", () => {
  it("adds server-owned runtime purchase config with disabled as the safe default", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.app_runtime_config/i);
    expect(migration).toMatch(/purchase_surface text NOT NULL DEFAULT 'disabled'/i);
    expect(migration).toMatch(/CHECK \(purchase_surface IN \('disabled', 'in_app_link', 'web_only'\)\)/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.app_runtime_config FROM anon, authenticated/i);
  });

  it("creates provider-neutral location entitlement and credit ledger tables", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.billing_accounts/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.location_entitlements/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.deal_credit_periods/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.deal_credit_reservations/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.deal_credit_ledger/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.billing_provider_events/i);
  });

  it("starts trials only through the server RPC and grants configured credits", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.start_location_trial/i);
    expect(migration).toMatch(/TRIAL_ALREADY_USED/i);
    expect(migration).toMatch(/COALESCE\(v_config\.trial_deal_credit_allowance, 30\)/i);
    expect(migration).toMatch(/'trial_grant:' \|\| p_business_location_id::text/i);
  });

  it("exposes only the safe billing summary RPC to authenticated owners", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.get_location_billing_summary/i);
    expect(migration).toMatch(/provider_customer_id/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.billing_provider_events FROM anon, authenticated/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_location_billing_summary\(uuid\) TO authenticated, service_role/i);
  });
});
