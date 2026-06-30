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

  it("infers a same-item BOGO when the item appears after get one free", () => {
    expect(inferDealEligibilityFormFromText("Buy one get one free large coffee")).toMatchObject({
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredItemDescription: "large coffee",
      freeItemDescription: "large coffee",
    });
  });

  it("infers free-with-purchase phrasing", () => {
    expect(inferDealEligibilityFormFromText("Free coffee with any bagel sandwich after 10")).toMatchObject({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "bagel sandwich",
      freeItemDescription: "coffee",
    });
    expect(inferDealEligibilityFormFromText("Buy a sandwich and the coffee is on us")).toMatchObject({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "sandwich",
      freeItemDescription: "coffee",
    });
  });

  it("infers free reward text when free follows the reward item", () => {
    const form = inferDealEligibilityFormFromText(
      "Buy any large coffee drink and get one cookie of your choice free today only.",
    );

    expect(form).toMatchObject({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "any large coffee drink",
      freeItemDescription: "cookie of your choice",
    });
    expect(validateDealEligibility(dealEligibilityFormToInput(form!))).toMatchObject({
      eligible: true,
      eligibilityStatus: "VALID",
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

  it("switches the default discount state to a free-item offer from clear owner text", () => {
    const current = createDefaultDealEligibilityFormState();
    const inferred = inferDealEligibilityFormFromText(
      "Buy any large coffee drink and get one cookie of your choice free today only.",
    );

    expect(mergeInferredEligibilityForm(current, inferred, { allowDealTypeChange: true })).toMatchObject({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "any large coffee drink",
      freeItemDescription: "cookie of your choice",
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

  it("updates fields that still match the previous auto inference", () => {
    const current = {
      ...createDefaultDealEligibilityFormState(),
      dealType: "BUY_ONE_GET_ONE_FREE" as const,
      requiredItemDescription: "coffee",
      freeItemDescription: "coffee",
    };
    const previousInferred = inferDealEligibilityFormFromText("Buy one coffee get one free");
    const nextInferred = inferDealEligibilityFormFromText("Buy one large coffee get one free");

    expect(
      mergeInferredEligibilityForm(current, nextInferred, {
        allowDealTypeChange: true,
        previousInferred,
      }),
    ).toMatchObject({
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredItemDescription: "large coffee",
      freeItemDescription: "large coffee",
    });
  });

  it("does not overwrite fields the owner manually edited", () => {
    const current = {
      ...createDefaultDealEligibilityFormState(),
      dealType: "BUY_ONE_GET_ONE_FREE" as const,
      requiredItemDescription: "manual house coffee",
      freeItemDescription: "coffee",
    };
    const previousInferred = inferDealEligibilityFormFromText("Buy one coffee get one free");
    const nextInferred = inferDealEligibilityFormFromText("Buy one latte get one free");

    expect(
      mergeInferredEligibilityForm(current, nextInferred, {
        allowDealTypeChange: true,
        previousInferred,
      }),
    ).toMatchObject({
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredItemDescription: "manual house coffee",
      freeItemDescription: "latte",
    });
  });
});
