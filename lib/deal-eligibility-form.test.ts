import { describe, expect, it } from "vitest";
import {
  dealEligibilityFormToInput,
  inferDealEligibilityFormFromHintText,
} from "./deal-eligibility-form";
import { validateDealEligibility } from "./deal-eligibility";

describe("inferDealEligibilityFormFromHintText", () => {
  it("infers buy-one-get-something-free from a word-only quick deal hint", () => {
    const form = inferDealEligibilityFormFromHintText("buy a coffee and get a free cookie");

    expect(form).toMatchObject({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "coffee",
      freeItemDescription: "cookie",
    });
    expect(validateDealEligibility(dealEligibilityFormToInput(form!))).toMatchObject({
      eligible: true,
    });
  });

  it("infers same-item BOGO from buy one get one free wording", () => {
    const form = inferDealEligibilityFormFromHintText("Buy one latte, get one free.");

    expect(form).toMatchObject({
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredItemDescription: "latte",
      freeItemDescription: "latte",
    });
    expect(validateDealEligibility(dealEligibilityFormToInput(form!))).toMatchObject({
      eligible: true,
    });
  });

  it("does not infer ambiguous discount notes", () => {
    expect(inferDealEligibilityFormFromHintText("slow afternoon coffee special")).toBeNull();
  });
});
