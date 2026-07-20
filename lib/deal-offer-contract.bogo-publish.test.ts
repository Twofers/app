import { describe, expect, it } from "vitest";

import { buildDealOfferContract, validateAiCopyAgainstOffer } from "./deal-offer-contract";
import { dealEligibilityFormToInput, type DealEligibilityFormState } from "./deal-eligibility-form";
import { buildOfferDefinitionV1FromContract } from "./offer-definition";
import { buildPublishMechanicsValidationCopy } from "./offer-version-publish";

// Regression for the merchant BOGO publish blocker found in S10 device QA
// (2026-07-20): "Create new offer" -> Buy one get one free -> Publish failed
// every time with reasonCode CHANGES_FREE_ITEM, regardless of the ad copy the
// merchant typed. The publish path validates a machine-built copy derived from
// offerDefinition.canonicalOfferLine (app/create/ai.tsx:3504), not the typed
// copy — so the rejection is an internal disagreement between the canonical
// offer line and the contract's own item names.
function contractFor(requiredItem: string, freeItem: string) {
  return buildDealOfferContract({
    businessId: "biz-1",
    businessName: "The Colonel's Brew",
    locationId: "loc-1",
    locationName: "The Colonel's Brew",
    dealEligibility: {
      dealType: "BUY_ONE_GET_ONE_FREE",
      appliesTo: "SAME_ITEM",
      requiredPurchaseQuantity: 1,
      freeItemQuantity: 1,
      requiredItemDescription: requiredItem,
      freeItemDescription: freeItem,
    },
    eligibilityResult: { eligible: true, customerValuePercent: 50 },
    quantityLimit: 10,
  });
}

const CASES = [
  { label: "multi-word item, empty free item (the on-device case)", required: "drip coffee", free: "" },
  { label: "multi-word item, free item echoed", required: "drip coffee", free: "drip coffee" },
  { label: "known dictionary item", required: "coffee", free: "" },
  { label: "known dictionary item, echoed", required: "latte", free: "latte" },
  { label: "two-char fragment (parser artifact)", required: "Bu", free: "" },
  // A BUY_ONE_GET_ONE_FREE deal is same-item by definition, and the BOGO form
  // exposes no free-item input — so a differing freeItemDescription can only be
  // stale state (e.g. left over from the "Free item" / "% off" rules or the
  // free-text parser). It must never be able to block publish, because the
  // merchant has no field in which to correct it.
  { label: "stale differing free item — must not block publish", required: "drip coffee", free: "cookie" },
  { label: "stale parser fragment as free item", required: "drip coffee", free: "Bu" },
];

describe("BOGO publish mechanics validation", () => {
  for (const testCase of CASES) {
    it(`diagnoses: ${testCase.label}`, () => {
      const contract = contractFor(testCase.required, testCase.free);
      expect(contract, "contract should build").not.toBeNull();
      if (!contract) return;

      const offerDefinition = buildOfferDefinitionV1FromContract(contract, {
        dealEligibility: {
          dealType: "BUY_ONE_GET_ONE_FREE",
          appliesTo: "SAME_ITEM",
          requiredPurchaseQuantity: 1,
          freeItemQuantity: 1,
          requiredItemDescription: testCase.required,
          freeItemDescription: testCase.free,
        },
        redemptionLimit: "Claim closes 15 min before the deal ends.",
        schedule: { mode: "one_time", summary: "Today 1:45 AM - 2:45 AM" },
      });

      const copy = buildPublishMechanicsValidationCopy(offerDefinition);
      const result = validateAiCopyAgainstOffer(copy, contract);

      // eslint-disable-next-line no-console
      console.log(
        [
          `\n--- ${testCase.label} ---`,
          `requiredPurchase.itemName : ${JSON.stringify(contract.requiredPurchase?.itemName)}`,
          `freeReward.itemName       : ${JSON.stringify(contract.freeReward?.itemName)}`,
          `canonicalOfferLine        : ${JSON.stringify(contract.canonicalOfferLine)}`,
          `canonicalShortTerms       : ${JSON.stringify(contract.canonicalShortTerms)}`,
          `validated headline        : ${JSON.stringify(copy.headline)}`,
          `reasonCodes               : ${JSON.stringify(result.reasonCodes)}`,
        ].join("\n"),
      );

      expect(result.reasonCodes, `publish must not reject its own canonical offer line`).toEqual([]);
    });
  }
});

// The originating defect behind the on-device COPY_FAILED: a "drip coffee" BOGO
// shipped a contract whose free_reward was "Bu" — a free-text parser fragment left
// in freeItemDescription. BOGO is same-item by definition and its form has no
// free-item input, so the reward must always be the purchased item.
describe("BUY_ONE_GET_ONE_FREE reward item is always the purchased item", () => {
  const STALE_FREE_ITEM_VALUES = ["", "Bu", "cookie", "a free cookie", "THE SERGEANT'S STRIPES"];

  for (const stale of STALE_FREE_ITEM_VALUES) {
    it(`ignores stale freeItemDescription ${JSON.stringify(stale)}`, () => {
      const contract = contractFor("drip coffee", stale);
      expect(contract).not.toBeNull();
      expect(contract?.requiredPurchase?.itemName).toBe("drip coffee");
      expect(contract?.freeReward?.itemName).toBe("drip coffee");
      expect(contract?.canonicalOfferLine).toBe("Buy one drip coffee and get one free");
    });
  }

  // The payload sent to the ai-generate-ad-variants edge function is built from
  // dealEligibilityFormToInput, and that function rebuilds the contract server-side.
  // The stale value therefore has to be dropped here too, not only in the contract
  // builder, or the server keeps generating copy for an item that does not exist.
  it("drops stale form free-item state before it reaches the edge function payload", () => {
    const form: DealEligibilityFormState = {
      dealType: "BUY_ONE_GET_ONE_FREE",
      discountPercent: "",
      itemDescription: "",
      itemRetailValue: "",
      requiredItemDescription: "drip coffee",
      requiredItemRetailValue: "",
      freeItemDescription: "Bu",
      freeItemRetailValue: "",
    };
    expect(dealEligibilityFormToInput(form).freeItemDescription).toBe("drip coffee");
    expect(dealEligibilityFormToInput({ ...form, dealType: "BUY_ONE_GET_SOMETHING_FREE" }).freeItemDescription).toBe("Bu");
  });

  it("still honours a distinct reward for BUY_ONE_GET_SOMETHING_FREE", () => {
    const contract = buildDealOfferContract({
      businessId: "biz-1",
      businessName: "The Colonel's Brew",
      locationId: "loc-1",
      locationName: "The Colonel's Brew",
      dealEligibility: {
        dealType: "BUY_ONE_GET_SOMETHING_FREE",
        appliesTo: "SAME_ITEM",
        requiredPurchaseQuantity: 1,
        freeItemQuantity: 1,
        requiredItemDescription: "drip coffee",
        freeItemDescription: "cookie",
      },
      eligibilityResult: { eligible: true, customerValuePercent: 50 },
      quantityLimit: 10,
    });
    expect(contract?.requiredPurchase?.itemName).toBe("drip coffee");
    expect(contract?.freeReward?.itemName).toBe("cookie");
  });
});
