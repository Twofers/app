import { describe, expect, it } from "vitest";

import { createSafeDisabledBillingSummary, type LocationBillingSummary } from "@/lib/billing/entitlements";
import {
  getMerchantAccessForBillingSummary,
  getMerchantAccessFromCapabilities,
  isMerchantAccessAllowedStatus,
} from "./merchant-access";

function summary(status: LocationBillingSummary["status"]): LocationBillingSummary {
  return {
    ...createSafeDisabledBillingSummary("loc_1"),
    status,
  };
}

describe("merchant access status gate", () => {
  it("allows active, trial-active, and canceling grace statuses", () => {
    for (const status of [
      "trial_active",
      "admin_trial_active",
      "trial_canceling",
      "pro_active",
      "pro_canceling",
      "paid_active",
      "paid_canceling",
    ] as const) {
      expect(isMerchantAccessAllowedStatus(status)).toBe(true);
    }
  });

  it("blocks pending, eligible, canceled, and suspended statuses", () => {
    for (const status of [
      "approved_not_activated",
      "trial_eligible",
      "trial_checkout_pending",
      "trial_credit_limit_reached",
      "trial_expired_suspended",
      "payment_failed_suspended",
      "canceled_suspended",
      "refunded_suspended",
    ] as const) {
      expect(isMerchantAccessAllowedStatus(status)).toBe(false);
    }
  });

  it("returns a simple blocked result for inactive merchants", () => {
    expect(
      getMerchantAccessForBillingSummary({
        isLoggedIn: true,
        businessId: "biz_1",
        summary: summary("trial_eligible"),
      }),
    ).toMatchObject({
      canAccessMerchantTools: false,
      canUseSetupTools: false,
      canGenerateAi: false,
      canPublishOffer: false,
      status: "trial_eligible",
      reason: "inactive_status",
    });
  });

  it("allows setup and menu drafting before activation without opening AI or publishing", () => {
    expect(
      getMerchantAccessForBillingSummary({
        isLoggedIn: true,
        businessId: "biz_1",
        businessStatus: "approved_not_activated",
        summary: summary("trial_eligible"),
      }),
    ).toMatchObject({
      canAccessMerchantTools: false,
      canUseSetupTools: true,
      canUseMenuTools: true,
      canExtractInitialMenu: true,
      canCreateTextDraft: true,
      canGenerateAi: false,
      canPublishOffer: false,
      canReceiveNewClaims: false,
      canRedeemExistingClaims: false,
      canManageBilling: true,
      status: "trial_eligible",
      reason: "approved_not_activated",
    });
  });

  it("treats canonical server capabilities as the UI source of truth", () => {
    expect(
      getMerchantAccessFromCapabilities({
        status: "trial_eligible",
        capabilities: {
          can_edit_business_information: true,
          can_use_setup_tools: true,
          can_use_menu_tools: true,
          can_extract_initial_menu: false,
          can_create_text_draft: true,
          can_generate_ai: false,
          can_consume_offer_credits: false,
          can_publish_offer: false,
          can_receive_new_claims: false,
          can_redeem_existing_claims: false,
          can_manage_billing: true,
          reason_code: "approved_not_activated",
          setup_menu_extractions_remaining: 0,
        },
      }),
    ).toMatchObject({
      canAccessMerchantTools: false,
      canUseSetupTools: true,
      canUseMenuTools: true,
      canExtractInitialMenu: false,
      canCreateTextDraft: true,
      canGenerateAi: false,
      canPublishOffer: false,
      reason: "approved_not_activated",
    });
  });

  it("keeps saved menu drafts and existing redemptions available after lapse", () => {
    expect(
      getMerchantAccessForBillingSummary({
        isLoggedIn: true,
        businessId: "biz_1",
        summary: summary("trial_expired_suspended"),
      }),
    ).toMatchObject({
      canAccessMerchantTools: false,
      canUseMenuTools: true,
      canExtractInitialMenu: false,
      canCreateTextDraft: true,
      canGenerateAi: false,
      canPublishOffer: false,
      canReceiveNewClaims: false,
      canRedeemExistingClaims: true,
      canManageBilling: true,
    });
  });

  it("allows explicit development bypasses", () => {
    expect(
      getMerchantAccessForBillingSummary({
        isLoggedIn: true,
        businessId: "biz_1",
        summary: summary("payment_failed_suspended"),
        bypass: true,
      }),
    ).toMatchObject({
      canAccessMerchantTools: true,
      status: "payment_failed_suspended",
      reason: "development_bypass",
    });
  });
});
