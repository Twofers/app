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

  it("rejects a deal row whose end time does not follow its start time", () => {
    // Nothing downstream catches this: the publish RPC inserts start_time and
    // end_time verbatim and the deals table has no ordering constraint, so an
    // inverted window would persist as an already-expired deal.
    expect(source).toMatch(/function hasInvertedDealWindow/);
    expect(source).toMatch(/dealRows\.some\(\(row\) => hasInvertedDealWindow\(row\)\)/);
    expect(source).toMatch(/INVALID_DEAL_WINDOW/);
    // Judged only when both sides are present and parseable.
    expect(source).toMatch(/if \(!Number\.isFinite\(start\) \|\| !Number\.isFinite\(end\)\) return false;/);
  });

  it("validates the renderer ad spec before publishing", () => {
    expect(source).toMatch(/function validateAdSpecPayload/);
    expect(source).toMatch(/function validateComposedCardPayload/);
    expect(source).toMatch(/INVALID_AD_SPEC/);
    expect(source).toMatch(/MISSING_RENDERER_VERSION/);
    expect(source).toMatch(/MISSING_CHANNELS/);
    expect(source).toMatch(/MISSING_COMPOSED_CARD_APPROVAL/);
    expect(source).toMatch(/BLOCKED_COMPOSITE_QA/);
    expect(source).toMatch(/SCREENSHOT_QA_REQUIRED/);
  });

  it("validates poster ad specs against policy, ownership, and locked offer lines", () => {
    expect(source).toMatch(/validatePosterSpecV1/);
    expect(source).toMatch(/creative_format/);
    expect(source).toMatch(/posterValidation\.reasonCodes/);
    expect(source).toMatch(/businessId/);
    expect(source).toMatch(/OfferDefinitionV1/);
  });

  it("validates localization storage snapshots without allowing exact offer fields in localization rows", () => {
    expect(source).toMatch(/function validateLocalizationPayload/);
    expect(source).toMatch(/INVALID_LOCALIZATION_BUNDLE_HASH/);
    expect(source).toMatch(/MISSING_AD_LOCALIZATION/);
    expect(source).toMatch(/AD_LOCALIZATION_EXACT_OFFER_FIELDS_NOT_ALLOWED/);
    expect(source).toMatch(/adlocrow_\[0-9a-f\]\{8\}/);
  });

  it("can enforce exact localization approval when the PR4 flag is enabled", () => {
    expect(source).toMatch(/AI_V5_EXACT_LOCALIZATION_APPROVAL_ENABLED/);
    expect(source).toMatch(/validateExactLocalizationApprovalPayload/);
    expect(source).toMatch(/MISSING_LOCALIZATION_APPROVAL/);
  });

  it("blocks publishing when the owner has not accepted business terms, independent of billing", () => {
    expect(source).toMatch(/from\("terms_acceptances"\)/);
    expect(source).toMatch(/\.eq\("document_type", "business_terms"\)/);
    expect(source).toMatch(/TERMS_REQUIRED/);
    // The terms check must not replace or short-circuit the existing billing
    // suspension / verification checks — it runs before them and returns its
    // own error_code, leaving getSuspendedLocationFromDealRows untouched.
    expect(source).toMatch(/getSuspendedLocationFromDealRows/);
    expect(source).toMatch(/getUnverifiedLocationFromDealRows/);
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
    expect(source).toMatch(/selected_template_id/);
    expect(source).toMatch(/composite_qa_decision/);
    expect(source).toMatch(/merchant_style_override_used/);
    expect(source).toMatch(/localization_source_locale/);
    expect(source).toMatch(/localization_bundle_hash/);
    expect(source).toMatch(/deterministic_localization_fallback_locales/);
    expect(source).toMatch(/translation_qa_decision_by_locale/);
    expect(source).toMatch(/translation_repair_target_locales/);
    expect(source).toMatch(/locale_template_override_locales/);
    expect(source).toMatch(/localization_approval_hash/);
    expect(source).toMatch(/localized_term_snapshot_hash/);
    expect(source).not.toMatch(/context:[\s\S]*idempotency_key/);
  });
});
