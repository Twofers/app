import { describe, expect, it } from "vitest";

import {
  inferDealEligibilityFormFromText,
  mergeInferredEligibilityForm,
} from "./deal-eligibility-inference";
import { createDefaultDealEligibilityFormState } from "./deal-eligibility-form";
import { validateDealEligibility } from "./deal-eligibility";
import { dealEligibilityFormToInput } from "./deal-eligibility-form";

describe("deal eligibility inference", () => {
  it("infers a same-item BOGO latte offer from owner text", () => {
    const form = inferDealEligibilityFormFromText("Buy one latte get one free");

    expect(form).toMatchObject({
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredItemDescription: "latte",
      freeItemDescription: "latte",
    });
    expect(validateDealEligibility(dealEligibilityFormToInput(form!))).toMatchObject({
      eligible: true,
      eligibilityStatus: "VALID",
    });
  });

  it("infers a different free item offer", () => {
    expect(inferDealEligibilityFormFromText("Buy one sandwich, get a free coffee")).toMatchObject({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "sandwich",
      freeItemDescription: "coffee",
    });
  });

  it("merges inferred text into empty fields without overwriting manual entries", () => {
    const current = {
      ...createDefaultDealEligibilityFormState(),
      dealType: "BUY_ONE_GET_ONE_FREE" as const,
      requiredItemDescription: "manual sandwich",
      freeItemDescription: "",
    };
    const inferred = inferDealEligibilityFormFromText("Buy one latte get one free");

    expect(mergeInferredEligibilityForm(current, inferred)).toMatchObject({
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredItemDescription: "manual sandwich",
      freeItemDescription: "latte",
    });
  });

  it("can change the default percent-off state when the description clearly says BOGO", () => {
    const current = createDefaultDealEligibilityFormState();
    const inferred = inferDealEligibilityFormFromText("BOGO iced latte");

    expect(mergeInferredEligibilityForm(current, inferred, { allowDealTypeChange: true })).toMatchObject({
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredItemDescription: "iced latte",
      freeItemDescription: "iced latte",
    });
  });
});
