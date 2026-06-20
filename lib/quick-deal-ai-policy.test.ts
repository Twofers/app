import { describe, expect, it } from "vitest";

import {
  shouldUseQuickDealOfferDefinitionFallback,
} from "./quick-deal-ai-policy";

describe("quick deal AI policy", () => {
  it("uses the safe fallback only for true AI drafting failures when a source image exists", () => {
    expect(shouldUseQuickDealOfferDefinitionFallback(new Error("AI copy generation failed."), "COPY_FAILED", true)).toBe(true);
    expect(shouldUseQuickDealOfferDefinitionFallback(new Error("Request timed out."), undefined, true)).toBe(true);
  });

  it("does not create an image-less fallback when no photo was provided", () => {
    expect(shouldUseQuickDealOfferDefinitionFallback(new Error("AI copy generation failed."), "COPY_FAILED", false)).toBe(false);
    expect(shouldUseQuickDealOfferDefinitionFallback(new Error("Request timed out."), undefined, false)).toBe(false);
  });

  it("does not fallback around quota, cooldown, config, ownership, or input errors", () => {
    expect(shouldUseQuickDealOfferDefinitionFallback(new Error("Monthly AI limit reached."), "MONTHLY_LIMIT", true)).toBe(false);
    expect(shouldUseQuickDealOfferDefinitionFallback(new Error("Please wait 12s."), "COOLDOWN_ACTIVE", true)).toBe(false);
    expect(shouldUseQuickDealOfferDefinitionFallback(new Error("AI is not configured."), "OPENAI_KEY_MISSING", true)).toBe(false);
    expect(shouldUseQuickDealOfferDefinitionFallback(new Error("DEAL_NOT_ELIGIBLE_FOR_AI"), "DEAL_NOT_ELIGIBLE_FOR_AI", true)).toBe(false);
    expect(shouldUseQuickDealOfferDefinitionFallback(new Error("You do not own this business."), undefined, true)).toBe(false);
    expect(shouldUseQuickDealOfferDefinitionFallback(new Error("We couldn't use that photo."), undefined, true)).toBe(false);
  });
});
