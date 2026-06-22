import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "stripe-cancel-paid-subscription", "index.ts"),
  "utf8",
);
const config = readFileSync(join(process.cwd(), "supabase", "config.toml"), "utf8");

describe("stripe-cancel-paid-subscription source", () => {
  it("gates paid cancellation by auth, owner location, and purchase surface", () => {
    expect(source).toMatch(/auth\.getUser/);
    expect(source).toMatch(/isRedeemerUser/);
    expect(source).toMatch(/config\.purchaseSurface !== "in_app_link"/);
    expect(source).toMatch(/user_owns_business_location/);
  });

  it("only cancels active paid Stripe subscriptions for the matching location", () => {
    expect(source).toMatch(/status !== "pro_active" && status !== "paid_active"/);
    expect(source).toMatch(/entitlement\?\.first_paid_at/);
    expect(source).toMatch(/subscription\?\.status !== "active"/);
    expect(source).toMatch(/metadata\.business_location_id/);
    expect(source).toMatch(/metadata\.billing_account_id/);
  });

  it("schedules paid cancellation at period end without creating refunds", () => {
    expect(source).toMatch(/stripe\.subscriptions\.update/);
    expect(source).toMatch(/cancel_at_period_end: true/);
    expect(source).toMatch(/current_period_ends_at/);
    expect(source).not.toMatch(/stripe\.subscriptions\.cancel/);
    expect(source).not.toMatch(/stripe\.refunds\.create/);
  });
});

describe("paid cancel function config", () => {
  it("registers the owner-callable paid cancellation function", () => {
    expect(config).toMatch(/\[functions\.stripe-cancel-paid-subscription\][\s\S]*?verify_jwt = false/);
  });
});
