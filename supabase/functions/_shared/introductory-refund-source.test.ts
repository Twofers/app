import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "stripe-request-introductory-refund", "index.ts"),
  "utf8",
);
const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260726131000_introductory_refund_requests.sql"),
  "utf8",
);
const config = readFileSync(join(process.cwd(), "supabase", "config.toml"), "utf8");

describe("stripe-request-introductory-refund source", () => {
  it("gates refund requests by auth, owner location, and purchase surface", () => {
    expect(source).toMatch(/auth\.getUser/);
    expect(source).toMatch(/isRedeemerUser/);
    expect(source).toMatch(/config\.purchaseSurface !== "in_app_link"/);
    expect(source).toMatch(/user_owns_business_location/);
  });

  it("enforces first-paid refund policy before Stripe side effects", () => {
    expect(source).toMatch(/decideIntroductoryRefund/);
    expect(source).toMatch(/first_paid_invoice_id/);
    expect(source).toMatch(/introductory_refund_used_at/);
    expect(source).toMatch(/refund_max_paid_credits_used/);
    expect(source).toMatch(/REFUND_REQUIRES_SUPPORT/);
  });

  it("creates a Stripe refund, cancels the subscription, and suspends the location", () => {
    expect(source).toMatch(/stripe\.refunds\.create/);
    expect(source).toMatch(/stripe\.subscriptions\.cancel/);
    expect(source).toMatch(/status: "refunded_suspended"/);
    expect(source).toMatch(/introductory_refund_used_at/);
    expect(source).not.toMatch(/provider_refund_id.*return/);
  });
});

describe("introductory refund request migration", () => {
  it("adds a server-owned refund request audit table", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.billing_refund_requests/i);
    expect(migration).toMatch(/UNIQUE \(business_location_id, first_paid_invoice_id\)/i);
    expect(migration).toMatch(/provider_refund_id text NULL UNIQUE/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.billing_refund_requests FROM anon, authenticated/i);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE public\.billing_refund_requests TO service_role/i);
  });
});

describe("introductory refund function config", () => {
  it("registers the owner-callable refund function", () => {
    expect(config).toMatch(/\[functions\.stripe-request-introductory-refund\][\s\S]*?verify_jwt = false/);
  });
});
