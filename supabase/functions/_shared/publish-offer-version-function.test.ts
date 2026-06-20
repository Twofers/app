import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "publish-offer-version", "index.ts"),
  "utf8",
);

describe("publish-offer-version edge function", () => {
  it("authenticates the owner and blocks redeemer sessions", () => {
    expect(source).toMatch(/auth\.getUser\(\)/);
    expect(source).toMatch(/isRedeemerUser\(user\)/);
    expect(source).toMatch(/Business not found for owner/);
  });

  it("validates the offer definition before publishing", () => {
    expect(source).toMatch(/validateOfferDefinitionPayload\(offerDefinition\)/);
    expect(source).toMatch(/INVALID_OFFER_DEFINITION/);
    expect(source).toMatch(/offerDefinition\.merchantId !== businessId/);
  });

  it("validates the renderer ad spec before publishing", () => {
    expect(source).toMatch(/function validateAdSpecPayload/);
    expect(source).toMatch(/INVALID_AD_SPEC/);
    expect(source).toMatch(/MISSING_RENDERER_VERSION/);
    expect(source).toMatch(/MISSING_CHANNELS/);
  });

  it("uses the atomic publish rpc and exposes a migration-unavailable rollback error", () => {
    expect(source).toMatch(/publish_offer_versioned_deal/);
    expect(source).toMatch(/PUBLISH_OFFER_VERSION_UNAVAILABLE/);
    expect(source).toMatch(/idempotency_key/);
  });

  it("logs non-sensitive versioned publish telemetry", () => {
    expect(source).toMatch(/app_analytics_events/);
    expect(source).toMatch(/ai_ad_versioned_publish/);
    expect(source).toMatch(/renderer_version/);
    expect(source).not.toMatch(/context:[\s\S]*idempotency_key/);
  });
});
