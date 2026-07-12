import { describe, expect, it } from "vitest";

import {
  canUseFallbackTemplateForOutcome,
  classifyGenerationFailure,
} from "./create-ai-generation-outcome";

describe("classifyGenerationFailure", () => {
  it("blocks fallback for ownership errors", () => {
    const kind = classifyGenerationFailure({
      raw: "You do not own this business.",
      hasFallbackSource: true,
    });

    expect(kind).toBe("ownership_blocked");
    expect(canUseFallbackTemplateForOutcome(kind)).toBe(false);
  });

  it("blocks fallback for the monthly quota cap", () => {
    expect(
      classifyGenerationFailure({
        raw: "Monthly AI limit reached.",
        code: "MONTHLY_LIMIT",
        hasFallbackSource: true,
      }),
    ).toBe("quota_or_cooldown_blocked");
  });

  it("classifies a short cooldown separately from the monthly cap", () => {
    const kind = classifyGenerationFailure({
      raw: "Please wait 12s.",
      code: "COOLDOWN_ACTIVE",
      hasFallbackSource: true,
    });

    expect(kind).toBe("cooldown_blocked");
    expect(canUseFallbackTemplateForOutcome(kind)).toBe(false);
  });

  it("allows fallback only for AI failures with a source image", () => {
    expect(
      classifyGenerationFailure({
        raw: "The ad draft timed out.",
        hasFallbackSource: true,
      }),
    ).toBe("ai_failed_fallback_available");
    expect(
      classifyGenerationFailure({
        raw: "The ad draft timed out.",
        hasFallbackSource: false,
      }),
    ).toBe("ai_failed_no_fallback");
  });

  it("treats photo, config, and offer errors as input blockers", () => {
    expect(
      classifyGenerationFailure({
        raw: "We couldn't use that photo.",
        hasFallbackSource: true,
      }),
    ).toBe("input_or_offer_blocked");
    expect(
      classifyGenerationFailure({
        raw: "AI is not configured.",
        code: "OPENAI_KEY_MISSING",
        hasFallbackSource: true,
      }),
    ).toBe("input_or_offer_blocked");
    expect(
      classifyGenerationFailure({
        raw: "DEAL_NOT_ELIGIBLE_FOR_AI",
        code: "DEAL_NOT_ELIGIBLE_FOR_AI",
        hasFallbackSource: true,
      }),
    ).toBe("input_or_offer_blocked");
  });
});
