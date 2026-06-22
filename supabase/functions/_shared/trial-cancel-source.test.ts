import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "stripe-cancel-trial-subscription", "index.ts"),
  "utf8",
);
const config = readFileSync(join(process.cwd(), "supabase", "config.toml"), "utf8");

describe("stripe-cancel-trial-subscription source", () => {
  it("gates trial cancellation by auth, owner location, and purchase surface", () => {
    expect(source).toMatch(/auth\.getUser/);
    expect(source).toMatch(/isRedeemerUser/);
    expect(source).toMatch(/config\.purchaseSurface !== "in_app_link"/);
    expect(source).toMatch(/user_owns_business_location/);
  });

  it("only cancels active Stripe trials for the matching location", () => {
    expect(source).toMatch(/status !== "trial_active"/);
    expect(source).toMatch(/subscription\?\.status !== "trialing"/);
    expect(source).toMatch(/metadata\.business_location_id/);
    expect(source).toMatch(/metadata\.billing_account_id/);
  });

  it("schedules cancellation at period end instead of immediately ending access", () => {
    expect(source).toMatch(/stripe\.subscriptions\.update/);
    expect(source).toMatch(/cancel_at_period_end: true/);
    expect(source).toMatch(/status: "trial_canceling"/);
    expect(source).not.toMatch(/stripe\.subscriptions\.cancel/);
  });
});

describe("trial cancel function config", () => {
  it("registers the owner-callable trial cancellation function", () => {
    expect(config).toMatch(/\[functions\.stripe-cancel-trial-subscription\][\s\S]*?verify_jwt = false/);
  });
});
