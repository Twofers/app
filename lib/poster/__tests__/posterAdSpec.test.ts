import { describe, expect, it } from "vitest";

import { validateDealEligibility, type DealEligibilityInput } from "../../deal-eligibility";
import { buildOfferDefinitionV1 } from "../../offer-definition";
import { buildPosterSpecFromOfferDefinition } from "../posterCopy";
import { posterCopyForLocale } from "../posterAdSpec";
import type { PosterSpecV1 } from "../posterTypes";

function definitionFor(input: DealEligibilityInput) {
  const eligibilityResult = validateDealEligibility(input);
  const definition = buildOfferDefinitionV1({
    businessId: "biz_123",
    businessName: "Merit Twofer Coffee",
    locationId: "loc_123",
    locationName: "Merit Coffee",
    dealEligibility: input,
    eligibilityResult,
    quantityLimit: 5,
    redemptionLimit: "Claims close 15 minutes before the deal ends.",
  });
  if (!definition) throw new Error("expected valid offer definition");
  return definition;
}

function buildFullSpec(): PosterSpecV1 {
  const definition = definitionFor({
    dealType: "PERCENT_OFF_SINGLE_ITEM",
    appliesTo: "SINGLE_ITEM",
    discountPercent: 40,
    itemDescription: "Iced americano",
  });
  return buildPosterSpecFromOfferDefinition({
    definition,
    enabled: true,
    templateId: "fresh",
    headline: "Iced americano",
    businessCategory: "Cafe",
  });
}

describe("posterCopyForLocale", () => {
  it("resolves the requested locale when present", () => {
    const spec = buildFullSpec();

    expect(posterCopyForLocale(spec, "es-US")?.offer_line_1).toBe("40% DE DESCUENTO");
    expect(posterCopyForLocale(spec, "ko-KR")?.offer_line_1).toBe("40% 할인");
    expect(posterCopyForLocale(spec, "en-US")?.offer_line_1).toBe("40% OFF");
  });

  it("falls back to en-US when the requested locale is missing", () => {
    const spec = buildFullSpec();
    const enOnly: PosterSpecV1 = {
      ...spec,
      copy_by_language: { "en-US": spec.copy_by_language["en-US"] } as PosterSpecV1["copy_by_language"],
    };

    expect(posterCopyForLocale(enOnly, "es-US")).toEqual(enOnly.copy_by_language["en-US"]);
  });

  it("falls back to en-US for an unsupported locale string", () => {
    const spec = buildFullSpec();

    expect(posterCopyForLocale(spec, "fr-FR")).toEqual(spec.copy_by_language["en-US"]);
    expect(posterCopyForLocale(spec, null)).toEqual(spec.copy_by_language["en-US"]);
    expect(posterCopyForLocale(spec, undefined)).toEqual(spec.copy_by_language["en-US"]);
  });
});
