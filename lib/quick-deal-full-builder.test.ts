import { describe, expect, it } from "vitest";

import { buildQuickDealFullBuilderParams } from "./quick-deal-full-builder";

describe("quick deal full builder params", () => {
  it("uses the prefill names consumed by the AI builder", () => {
    expect(
      buildQuickDealFullBuilderParams({
        hint: "  BOGO latte  ",
        title: " BOGO iced latte ",
        offerLine: " Buy one iced latte, get one free. ",
        cta: " Claim today ",
        posterPath: "business/photo.jpg",
      }),
    ).toEqual({
      fromCreateHub: "1",
      prefillHint: "BOGO latte",
      prefillTitle: "BOGO iced latte",
      prefillPromoLine: "Buy one iced latte, get one free.",
      prefillDescription: "Buy one iced latte, get one free.",
      prefillCta: "Claim today",
      prefillPosterPath: "business/photo.jpg",
    });
  });

  it("keeps the navigation marker even when the quick draft is blank", () => {
    expect(buildQuickDealFullBuilderParams({})).toEqual({ fromCreateHub: "1" });
  });
});
