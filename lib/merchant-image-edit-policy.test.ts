import { describe, expect, it } from "vitest";

import { validateMerchantImageEditInstruction } from "./merchant-image-edit-policy";

describe("merchant image edit policy", () => {
  it("allows safe styling-only instructions", () => {
    expect(validateMerchantImageEditInstruction("Make the lighting warmer and clean up crumbs.")).toEqual({
      ok: true,
      instruction: "Make the lighting warmer and clean up crumbs.",
      reasonCodes: [],
    });
  });

  it("blocks instructions that add ad graphics or change offer facts", () => {
    const result = validateMerchantImageEditInstruction("Add 50% off text and replace the latte with a burger.");

    expect(result.ok).toBe(false);
    expect(result.reasonCodes).toContain("ADDS_FORBIDDEN_GRAPHICS");
    expect(result.reasonCodes).toContain("CHANGES_OFFER_ITEM");
    expect(result.reasonCodes).toContain("CHANGES_OFFER_TERMS");
  });
});
