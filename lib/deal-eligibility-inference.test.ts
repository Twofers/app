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

  it("never seeds half-typed fragments as items (F-002 regression)", () => {
    // Mid-typing "buy one get o[ne free]" used to seed the single letter "o"
    // as both items; that garbage survived draft resume and made server-side
    // image QA unpassable (required visual item "o").
    expect(inferDealEligibilityFormFromText("House vanilla latte, buy one get o")).toBeNull();
    expect(inferDealEligibilityFormFromText("House vanilla latte, buy one get on")).toBeNull();
    expect(inferDealEligibilityFormFromText("House vanilla latte, buy one get one fre")).toBeNull();
    // No item in the offer clause at all -> stay empty instead of seeding "one"/"free".
    expect(inferDealEligibilityFormFromText("House vanilla latte, buy one get one free, today only")).toBeNull();
    expect(inferDealEligibilityFormFromText("Buy one get one free")).toBeNull();
  });

  it("does not split items across 'and the … is on us' garbage (F-002 regression)", () => {
    expect(inferDealEligibilityFormFromText("Buy one vanilla latte and the o is on us.")).toBeNull();
  });

  it("still infers BOGO when the item precedes 'free' after get", () => {
    expect(inferDealEligibilityFormFromText("Buy one get one latte free")).toMatchObject({
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredItemDescription: "latte",
      freeItemDescription: "latte",
    });
    expect(inferDealEligibilityFormFromText("Buy one get free coffee")).toMatchObject({
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredItemDescription: "coffee",
      freeItemDescription: "coffee",
    });
  });

  it("uses a plain item description to seed the default single-item discount", () => {
    expect(inferDealEligibilityFormFromText("Hot fudge sundae")).toMatchObject({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      itemDescription: "Hot fudge sundae",
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

  it("updates a still-auto item when the owner corrects the plain item description", () => {
    const current = {
      ...createDefaultDealEligibilityFormState(),
      dealType: "PERCENT_OFF_SINGLE_ITEM" as const,
      itemDescription: "Hot fudge sunday",
    };
    const previousInferred = inferDealEligibilityFormFromText("Hot fudge sunday");
    const nextInferred = inferDealEligibilityFormFromText("Hot fudge sundae");

    expect(
      mergeInferredEligibilityForm(current, nextInferred, {
        allowDealTypeChange: true,
        previousInferred,
      }),
    ).toMatchObject({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      itemDescription: "Hot fudge sundae",
    });
  });
});
