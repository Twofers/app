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

  it("drops a leading duplicate-qualifier from the free item (F-025 regression)", () => {
    // "get a second muffin free" named the free item "second muffin" -> the terms
    // line read "receive one second muffin free" and failed the strong-deal BOGO
    // match, blocking publish. The free item should just be "muffin".
    expect(
      inferDealEligibilityFormFromText("Buy any muffin and get a second muffin free today 3pm to 7pm"),
    ).toMatchObject({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "any muffin",
      freeItemDescription: "muffin",
    });
    expect(
      inferDealEligibilityFormFromText("Buy a taco and get another taco free"),
    ).toMatchObject({ freeItemDescription: "taco" });
    // Plural purchase, singular referential free item.
    expect(
      inferDealEligibilityFormFromText("Buy two muffins and get a third muffin free"),
    ).toMatchObject({ requiredItemDescription: "two muffins", freeItemDescription: "muffin" });
    // "Free X with Y" phrasing goes through the same gate.
    expect(
      inferDealEligibilityFormFromText("Free second muffin when you buy any muffin"),
    ).toMatchObject({ requiredItemDescription: "muffin", freeItemDescription: "muffin" });
  });

  it("keeps qualifier words that are part of a real item name (F-025 gating)", () => {
    // The strip must only fire when the qualifier refers back to the purchased
    // item. The first (unconditional) F-025 cut renamed real items.
    expect(inferDealEligibilityFormFromText("Buy an extra shot latte and get a cookie free")).toMatchObject({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "extra shot latte",
      freeItemDescription: "cookie",
    });
    expect(inferDealEligibilityFormFromText("Buy a burger and get an extra sauce free")).toMatchObject({
      requiredItemDescription: "burger",
      freeItemDescription: "extra sauce",
    });
  });

  it("does not alter percent-off deal facts by stripping 'second' (F-025 gating)", () => {
    // "50% off the second pizza" means the SECOND pizza is half price. The
    // unconditional strip turned the item into "pizza" (50% off ANY pizza),
    // silently widening the offer. The item must stay "second pizza".
    expect(inferDealEligibilityFormFromText("50% off the second pizza")).toMatchObject({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      itemDescription: "second pizza",
      discountPercent: "50",
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

  it("reads '2 for 1' phrasing as same-item BOGO, not a buy-two quantity (2026-07-10 plan)", () => {
    // On-device repro: typing "2 for 1 latte" left the item slots holding the
    // literal "2 for 1" text; the offer builder then read it as a buy-TWO deal
    // ("Buy two lattes…") and publish failed with REQUIRES_TWO_PURCHASES.
    // "2 for 1" means buy ONE, get ONE free of the SAME item.
    for (const text of ["2 for 1 latte", "2-for-1 latte", "two for one latte"]) {
      expect(inferDealEligibilityFormFromText(text)).toMatchObject({
        dealType: "BUY_ONE_GET_ONE_FREE",
        requiredItemDescription: "latte",
        freeItemDescription: "latte",
      });
    }
  });

  it("keeps same-item 'buy one X and get one X free' as BOGO, not a free-item flip (2026-07-10 plan)", () => {
    // On-device repro: "Buy one latte and get one latte free" silently flipped
    // the offer rule BOGO -> BUY_ONE_GET_SOMETHING_FREE. A same-item free-item
    // offer renders the canonical "get one latte free" line, which fails the
    // VAGUE_GET_ONE_FREE publish guard. Same reward noun => BOGO.
    const form = inferDealEligibilityFormFromText("Buy one latte and get one latte free");
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

  it("never emits a single-letter or partial-word item while the description is typed (2026-07-10 plan)", () => {
    // Per-keystroke inference must never commit a stray fragment (the "2"/"B"
    // corruption): a bad seed survives draft save/resume and poisons publish.
    // Feed every prefix of a phrase and assert any emitted item is >= 2 chars.
    const usable = (value: string) => value === "" || value.trim().length >= 2;
    for (const phrase of [
      "Buy one latte and get one latte free",
      "2 for 1 latte",
      "House vanilla latte, buy one get one free",
    ]) {
      for (let end = 1; end <= phrase.length; end++) {
        const prefix = phrase.slice(0, end);
        const form = inferDealEligibilityFormFromText(prefix);
        if (!form) continue;
        expect(usable(form.itemDescription), `item @ "${prefix}"`).toBe(true);
        expect(usable(form.requiredItemDescription), `required @ "${prefix}"`).toBe(true);
        expect(usable(form.freeItemDescription), `free @ "${prefix}"`).toBe(true);
      }
    }
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

  it("never overwrites a manually touched field, even when it matches the previous auto inference", () => {
    // touchedFields is the call-site guard (Phase 2.4): once the merchant edits a
    // field by hand, the free-text parser may never rewrite it — even if its value
    // coincidentally equals the last auto inference (which the still-auto heuristic
    // alone would treat as replaceable).
    const current = {
      ...createDefaultDealEligibilityFormState(),
      dealType: "BUY_ONE_GET_ONE_FREE" as const,
      requiredItemDescription: "coffee",
      freeItemDescription: "coffee",
    };
    const previousInferred = inferDealEligibilityFormFromText("Buy one coffee get one free");
    const nextInferred = inferDealEligibilityFormFromText("Buy one latte get one free");

    expect(
      mergeInferredEligibilityForm(current, nextInferred, {
        allowDealTypeChange: true,
        previousInferred,
        touchedFields: ["requiredItemDescription"],
      }),
    ).toMatchObject({
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredItemDescription: "coffee", // touched → protected
      freeItemDescription: "latte", // untouched → still auto-updates
    });
  });

  it("never flips a manually chosen deal type (touched dealType)", () => {
    // The merchant tapped the BOGO offer-rule chip; a later BOGSF inference from
    // the description must not silently flip the rule back.
    const current = {
      ...createDefaultDealEligibilityFormState(),
      dealType: "BUY_ONE_GET_ONE_FREE" as const,
      requiredItemDescription: "",
      freeItemDescription: "",
    };
    const inferred = inferDealEligibilityFormFromText("Buy one sandwich, get a free coffee");

    expect(
      mergeInferredEligibilityForm(current, inferred, {
        allowDealTypeChange: true,
        touchedFields: ["dealType"],
      }),
    ).toMatchObject({
      dealType: "BUY_ONE_GET_ONE_FREE", // stays despite BOGSF inference
      requiredItemDescription: "sandwich", // untouched item slots still fill
    });
  });
});
