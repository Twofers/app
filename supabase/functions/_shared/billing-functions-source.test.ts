import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readFunction(name: string): string {
  return readFileSync(join(process.cwd(), "supabase", "functions", name, "index.ts"), "utf8");
}

describe("billing edge function safety", () => {
  it("gates checkout creation on the server-owned in-app purchase surface", () => {
    const source = readFunction("stripe-create-checkout-session");
    expect(source).toMatch(/loadRuntimeBillingConfig/);
    expect(source).toMatch(/config\.purchaseSurface !== "in_app_link"/);
    expect(source).toMatch(/user_owns_business_location/);
    expect(source).toMatch(/STRIPE_TWOFER_BUSINESS_PRICE_ID/);
    expect(source).not.toMatch(/subscription_tier/);
  });

  it("gates portal creation on location ownership and purchase surface", () => {
    const source = readFunction("stripe-customer-portal-session");
    expect(source).toMatch(/loadRuntimeBillingConfig/);
    expect(source).toMatch(/config\.purchaseSurface !== "in_app_link"/);
    expect(source).toMatch(/user_owns_business_location/);
    expect(source).toMatch(/location_id/);
  });

  it("makes verified webhook invoice events the paid activation path", () => {
    const source = readFunction("stripe-webhook");
    expect(source).toMatch(/constructEventAsync/);
    expect(source).toMatch(/billing_provider_events/);
    expect(source).toMatch(/event\.type === "invoice\.paid"/);
    expect(source).toMatch(/grantPaidPeriod/);
    expect(source).toMatch(/paid_deal_credit_allowance/);
  });

  it("disables the old simulate subscribe helper", () => {
    const source = readFunction("simulate-subscribe");
    expect(source).toMatch(/status: 410/);
    expect(source).not.toMatch(/subscription_status/);
    expect(source).not.toMatch(/subscription_tier/);
  });
});
