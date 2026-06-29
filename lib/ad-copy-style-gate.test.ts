import { describe, expect, it } from "vitest";

import { evaluateAdCopyStyleGate, selectStyleSafeCopyCandidate } from "./ad-copy-style-gate";
import type { AdSpecV3TextField, AdSpecV3TextProvenance } from "./ad-spec";

const aiProvenance: Record<AdSpecV3TextField, AdSpecV3TextProvenance> = {
  displayHook: "ai_generated",
  offerLine: "deterministic",
  supportingLine: "ai_generated",
  cta: "ai_generated",
  pushTitle: "ai_generated",
  pushBody: "ai_generated",
  socialCaption: "ai_generated",
};

describe("ad copy style gate", () => {
  it("blocks generic AI-sounding phrases in AI-originated copy", () => {
    const result = evaluateAdCopyStyleGate({
      copy: {
        displayHook: "Limited-time offer!",
        supportingLine: "Treat yourself to an unforgettable cafe experience.",
        cta: "Don't miss out!!",
      },
      provenance: aiProvenance,
      requiredSpecificTerms: ["latte", "scone"],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "displayHook",
          reasons: expect.arrayContaining(["GENERIC_MARKETING_PHRASE"]),
        }),
        expect.objectContaining({
          field: "supportingLine",
          reasons: expect.arrayContaining(["FORBIDDEN_AI_PHRASE", "GENERIC_MARKETING_PHRASE", "AI_TONE_PHRASE"]),
        }),
        expect.objectContaining({
          field: "cta",
          reasons: expect.arrayContaining(["FORBIDDEN_AI_PHRASE", "GENERIC_MARKETING_PHRASE", "TOO_MANY_EXCLAMATIONS"]),
        }),
      ]),
    );
  });

  it("blocks the addendum forbidden phrases in AI-originated copy", () => {
    const result = evaluateAdCopyStyleGate({
      copy: {
        displayHook: "Coffee is included after a qualifying purchase",
        supportingLine: "This offer allows you to unlock savings today.",
        socialCaption: "Promotion applies to this exclusive deal.",
      },
      provenance: aiProvenance,
      requiredSpecificTerms: ["coffee"],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "displayHook",
          reasons: expect.arrayContaining(["FORBIDDEN_AI_PHRASE"]),
        }),
        expect.objectContaining({
          field: "supportingLine",
          reasons: expect.arrayContaining(["FORBIDDEN_AI_PHRASE"]),
        }),
        expect.objectContaining({
          field: "socialCaption",
          reasons: expect.arrayContaining(["FORBIDDEN_AI_PHRASE"]),
        }),
      ]),
    );
  });

  it("bypasses the style-only gate for merchant-authored copy", () => {
    const merchantProvenance = {
      ...aiProvenance,
      displayHook: "merchant_typed" as const,
      supportingLine: "merchant_edited" as const,
    };

    const result = evaluateAdCopyStyleGate({
      copy: {
        displayHook: "Limited-time offer!",
        supportingLine: "Treat yourself to an unforgettable cafe experience.",
      },
      provenance: merchantProvenance,
      requiredSpecificTerms: ["latte"],
    });

    expect(result.ok).toBe(true);
    expect(result.bypassedFields).toEqual(expect.arrayContaining(["displayHook", "supportingLine"]));
  });

  it("allows specific deterministic offer copy", () => {
    const deterministicProvenance = Object.fromEntries(
      Object.keys(aiProvenance).map((field) => [field, "deterministic"]),
    ) as Record<AdSpecV3TextField, AdSpecV3TextProvenance>;

    const result = evaluateAdCopyStyleGate({
      copy: {
        displayHook: "Buy a latte and get a free scone",
        supportingLine: "Good today at Cedar Bean.",
        cta: "Draft deal",
      },
      provenance: deterministicProvenance,
      requiredSpecificTerms: ["latte", "scone"],
    });

    expect(result).toMatchObject({ ok: true, failures: [] });
  });

  it("blocks hype without any required product specificity", () => {
    const result = evaluateAdCopyStyleGate({
      copy: {
        displayHook: "An amazing deal for your day",
      },
      provenance: aiProvenance,
      requiredSpecificTerms: ["bagel", "coffee"],
    });

    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatchObject({
      field: "displayHook",
      reasons: ["HYPE_WITHOUT_SPECIFICITY"],
    });
  });

  it("blocks bare product-name headlines and weak try-our echoes", () => {
    const result = evaluateAdCopyStyleGate({
      copy: {
        displayHook: "Any large coffee drink",
        pushTitle: "Try our any large coffee drink",
      },
      provenance: aiProvenance,
      requiredSpecificTerms: ["Any large coffee drink", "Cookie of your choice"],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "displayHook",
          reasons: expect.arrayContaining(["BARE_SPECIFIC_TERM"]),
        }),
        expect.objectContaining({
          field: "pushTitle",
          reasons: expect.arrayContaining(["WEAK_TRY_OUR_PHRASE"]),
        }),
      ]),
    );
  });

  it("selects the first style-safe AI candidate", () => {
    const selection = selectStyleSafeCopyCandidate(
      [
        {
          copy: { displayHook: "Elevate your morning with an ultimate treat" },
          provenance: aiProvenance,
        },
        {
          copy: { displayHook: "Bagel mornings, coffee included" },
          provenance: aiProvenance,
        },
      ],
      {
        copy: { displayHook: "Buy a bagel and get a free coffee" },
        provenance: { displayHook: "deterministic" },
      },
      ["bagel", "coffee"],
    );

    expect(selection.usedFallback).toBe(false);
    expect(selection.selectedIndex).toBe(1);
    expect(selection.copy.displayHook).toBe("Bagel mornings, coffee included");
  });

  it("falls back deterministically when every AI candidate fails style", () => {
    const selection = selectStyleSafeCopyCandidate(
      [
        {
          copy: { displayHook: "Don't miss out on this exclusive offer!" },
          provenance: aiProvenance,
        },
      ],
      {
        copy: { displayHook: "Buy a latte and get a free scone" },
        provenance: { displayHook: "deterministic" },
      },
      ["latte", "scone"],
    );

    expect(selection.usedFallback).toBe(true);
    expect(selection.selectedIndex).toBeNull();
    expect(selection.gate.ok).toBe(true);
    expect(selection.copy.displayHook).toBe("Buy a latte and get a free scone");
  });
});
