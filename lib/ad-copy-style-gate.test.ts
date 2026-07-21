import { describe, expect, it } from "vitest";

import {
  evaluateAdCopyStyleGate,
  isFormulaicValueHeadline,
  selectStyleSafeCopyCandidate,
  startsWithDanglingConnector,
} from "./ad-copy-style-gate";
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

  it("blocks awkward article and quantifier grammar in AI-originated coffee offer copy", () => {
    const result = evaluateAdCopyStyleGate({
      copy: {
        displayHook: "Buy an any large coffee drink",
        supportingLine: "Try our any large coffee drink and get a cookie",
        pushBody: "Purchase an any large coffee drink to receive one cookie.",
      },
      provenance: aiProvenance,
      requiredSpecificTerms: ["Any large coffee drink", "Cookie of your choice"],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "displayHook",
          reasons: expect.arrayContaining(["AWKWARD_ARTICLE_QUANTIFIER"]),
        }),
        expect.objectContaining({
          field: "supportingLine",
          reasons: expect.arrayContaining(["WEAK_TRY_OUR_PHRASE", "AWKWARD_ARTICLE_QUANTIFIER"]),
        }),
        expect.objectContaining({
          field: "pushBody",
          reasons: expect.arrayContaining(["AWKWARD_ARTICLE_QUANTIFIER"]),
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

describe("startsWithDanglingConnector (R6)", () => {
  it("catches a headline whose head noun was dropped", () => {
    // Observed live: item "Haircut and fade" -> headline "AND FADE SAVINGS".
    expect(startsWithDanglingConnector("AND FADE SAVINGS")).toBe(true);
    expect(startsWithDanglingConnector("and fade savings")).toBe(true);
    expect(startsWithDanglingConnector("  Or Two Lattes")).toBe(true);
    expect(startsWithDanglingConnector("But Better")).toBe(true);
    expect(startsWithDanglingConnector("Plus A Free Latte")).toBe(true);
  });

  it("does not flag legitimate openers", () => {
    // Articles and prepositions validly begin headlines — only conjunctions do not.
    expect(startsWithDanglingConnector("The Colonel's Brew")).toBe(false);
    expect(startsWithDanglingConnector("A Latte For Two")).toBe(false);
    expect(startsWithDanglingConnector("With Every Order")).toBe(false);
    expect(startsWithDanglingConnector("Weekend Nails, Lighter Price")).toBe(false);
    expect(startsWithDanglingConnector("Mission: Two Lattes")).toBe(false);
  });

  it("does not flag a word that merely starts with a connector's letters", () => {
    expect(startsWithDanglingConnector("Andouille Sausage Plate")).toBe(false);
    expect(startsWithDanglingConnector("Orange Juice Deal Day")).toBe(false);
    expect(startsWithDanglingConnector("Butter Croissant Morning")).toBe(false);
  });

  it("is safe on empty input", () => {
    expect(startsWithDanglingConnector("")).toBe(false);
  });
});

describe("isFormulaicValueHeadline (R5)", () => {
  it("catches the <item> savings/deal template", () => {
    // All three appeared in a single generation batch.
    expect(isFormulaicValueHeadline("LOADED NACHOS SAVINGS")).toBe(true);
    expect(isFormulaicValueHeadline("ACAI BOWL SAVINGS")).toBe(true);
    expect(isFormulaicValueHeadline("BIRRIA TACOS SAVINGS")).toBe(true);
    expect(isFormulaicValueHeadline("Gel Manicure Deal")).toBe(true);
    expect(isFormulaicValueHeadline("Brisket Plate Specials")).toBe(true);
    expect(isFormulaicValueHeadline("Latte Offer")).toBe(true);
  });

  it("does not flag a headline that merely contains a value word", () => {
    expect(isFormulaicValueHeadline("Deal Of The Week Latte")).toBe(false);
    expect(isFormulaicValueHeadline("Savings Start With Coffee")).toBe(false);
    expect(isFormulaicValueHeadline("Two Lattes, One Great Deal Today")).toBe(false);
  });

  it("does not flag copy with an actual hook", () => {
    expect(isFormulaicValueHeadline("Weekend Nails, Lighter Price")).toBe(false);
    expect(isFormulaicValueHeadline("Mission: Two Lattes")).toBe(false);
    expect(isFormulaicValueHeadline("Two Rounds Of Stripes")).toBe(false);
  });

  it("does not flag the bare value word alone (needs a preceding word)", () => {
    expect(isFormulaicValueHeadline("Savings")).toBe(false);
    expect(isFormulaicValueHeadline("Deal")).toBe(false);
  });

  it("handles accents and collapses whitespace", () => {
    expect(isFormulaicValueHeadline("Açaí Bowl Savings")).toBe(true);
    expect(isFormulaicValueHeadline("  Birria   Tacos   Savings  ")).toBe(true);
    expect(isFormulaicValueHeadline("")).toBe(false);
  });
});
