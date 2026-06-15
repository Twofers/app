import { describe, expect, it } from "vitest";
import { validateDealEligibility } from "./deal-eligibility";

describe("validateDealEligibility", () => {
  it("accepts 40% off one item", () => {
    expect(
      validateDealEligibility({
        dealType: "PERCENT_OFF_SINGLE_ITEM",
        appliesTo: "SINGLE_ITEM",
        discountPercent: 40,
        itemDescription: "croissant",
        itemRetailValueCents: 500,
      }),
    ).toMatchObject({ eligible: true, eligibilityStatus: "VALID", customerValuePercent: 40 });
  });

  it("accepts 50% off one item", () => {
    expect(
      validateDealEligibility({
        dealType: "PERCENT_OFF_SINGLE_ITEM",
        appliesTo: "SINGLE_ITEM",
        discountPercent: 50,
        itemDescription: "latte",
        itemRetailValueCents: 600,
      }),
    ).toMatchObject({ eligible: true, customerValuePercent: 50 });
  });

  it("accepts buy $5 item, get $5 item free", () => {
    expect(
      validateDealEligibility({
        dealType: "BUY_ONE_GET_ONE_FREE",
        requiredItemDescription: "latte",
        requiredItemRetailValueCents: 500,
        freeItemDescription: "latte",
        freeItemRetailValueCents: 500,
        freeItemDiscountPercent: 100,
      }),
    ).toMatchObject({ eligible: true, customerValuePercent: 50 });
  });

  it("accepts buy $6 item, get $4 item free at exactly 40% customer value", () => {
    expect(
      validateDealEligibility({
        dealType: "BUY_ONE_GET_SOMETHING_FREE",
        requiredItemDescription: "drink",
        requiredItemRetailValueCents: 600,
        freeItemDescription: "bakery item",
        freeItemRetailValueCents: 400,
        freeItemDiscountPercent: 100,
      }),
    ).toMatchObject({ eligible: true, customerValuePercent: 40 });
  });

  it("accepts custom free item text with enough value", () => {
    expect(
      validateDealEligibility({
        dealType: "BUY_ONE_GET_SOMETHING_FREE",
        requiredItemDescription: "coffee",
        requiredItemRetailValueCents: 500,
        freeItemDescription: "any pastry from the case",
        freeItemRetailValueCents: 500,
        freeItemDiscountPercent: 100,
      }),
    ).toMatchObject({ eligible: true, customerValuePercent: 50 });
  });

  it.each([20, 39])("rejects %s%% off one item", (discountPercent) => {
    expect(
      validateDealEligibility({
        dealType: "PERCENT_OFF_SINGLE_ITEM",
        appliesTo: "SINGLE_ITEM",
        discountPercent,
        itemDescription: "coffee",
        itemRetailValueCents: 500,
      }),
    ).toMatchObject({ eligible: false, reasonCode: "DISCOUNT_TOO_LOW" });
  });

  it("rejects 40% off an entire order", () => {
    expect(
      validateDealEligibility({
        dealType: "PERCENT_OFF_SINGLE_ITEM",
        appliesTo: "ENTIRE_ORDER",
        discountPercent: 40,
        itemDescription: "order",
        itemRetailValueCents: 2000,
      }),
    ).toMatchObject({ eligible: false, reasonCode: "ENTIRE_ORDER_DISCOUNT_NOT_ALLOWED" });
  });

  it.each(["BUY_ONE_GET_ONE_50_OFF", "BUY_ONE_GET_ONE_80_OFF", "SECOND_ITEM_HALF_OFF"])(
    "rejects discounted second-item deal type %s",
    (dealType) => {
      expect(
        validateDealEligibility({
          dealType,
          requiredItemDescription: "latte",
          requiredItemRetailValueCents: 600,
          freeItemDescription: "latte",
          freeItemRetailValueCents: 600,
          freeItemDiscountPercent: dealType.includes("80") ? 80 : 50,
        }),
      ).toMatchObject({ eligible: false, reasonCode: "SECOND_ITEM_DISCOUNT_NOT_ALLOWED" });
    },
  );

  it("rejects discounted second item on an otherwise free-item-shaped payload", () => {
    expect(
      validateDealEligibility({
        dealType: "BUY_ONE_GET_ONE_FREE",
        requiredItemDescription: "sandwich",
        requiredItemRetailValueCents: 1000,
        freeItemDescription: "sandwich",
        freeItemRetailValueCents: 1000,
        freeItemDiscountPercent: 80,
      }),
    ).toMatchObject({ eligible: false, reasonCode: "FREE_ITEM_MUST_BE_100_PERCENT_FREE" });
  });

  it("rejects weak free item value below 40%", () => {
    const result = validateDealEligibility({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "coffee",
      requiredItemRetailValueCents: 500,
      freeItemDescription: "topping",
      freeItemRetailValueCents: 100,
      freeItemDiscountPercent: 100,
    });
    expect(result).toMatchObject({
      eligible: false,
      reasonCode: "TOTAL_CUSTOMER_VALUE_TOO_LOW",
      customerValuePercent: 16.67,
    });
  });

  it("rejects custom free item with missing retail value", () => {
    expect(
      validateDealEligibility({
        dealType: "BUY_ONE_GET_SOMETHING_FREE",
        requiredItemDescription: "coffee",
        requiredItemRetailValueCents: 500,
        freeItemDescription: "any pastry",
        freeItemDiscountPercent: 100,
      }),
    ).toMatchObject({ eligible: false, reasonCode: "MISSING_FREE_ITEM_VALUE" });
  });

  it("rejects free item with no description", () => {
    expect(
      validateDealEligibility({
        dealType: "BUY_ONE_GET_SOMETHING_FREE",
        requiredItemDescription: "coffee",
        requiredItemRetailValueCents: 500,
        freeItemRetailValueCents: 500,
        freeItemDiscountPercent: 100,
      }),
    ).toMatchObject({ eligible: false, reasonCode: "MISSING_FREE_ITEM_DESCRIPTION" });
  });

  it("rejects unsupported deal type", () => {
    expect(
      validateDealEligibility({
        dealType: "FREE_GIFT_WITH_NO_PURCHASE",
      }),
    ).toMatchObject({ eligible: false, reasonCode: "INVALID_DEAL_TYPE" });
  });
});
