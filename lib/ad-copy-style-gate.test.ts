import { describe, expect, it } from "vitest";

import {
  endsInDanglingFunctionWord,
  evaluateAdCopyStyleGate,
  hasArticleSoundDisagreement,
  hasQuantityArticleCollision,
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

describe("hasSpecificTerm content-word overlap (2026-08-05)", () => {
  it("passes hype copy that names the item via a partial phrase, not the full item string", () => {
    // Previously a false reject: the copy never contains the FULL normalized
    // term "12 ounce bag of whole bean coffee" verbatim, so the old exact-substring
    // check called this non-specific and any hype word triggered HYPE_WITHOUT_SPECIFICITY.
    const result = evaluateAdCopyStyleGate({
      copy: {
        displayHook: "Whole bean coffee, roasted this week — an amazing morning ritual",
      },
      provenance: aiProvenance,
      requiredSpecificTerms: ["12 ounce bag of whole bean coffee"],
    });

    expect(result.failures.find((failure) => failure.field === "displayHook")?.reasons ?? []).not.toContain(
      "HYPE_WITHOUT_SPECIFICITY",
    );
  });

  it("still rejects genuinely vague hype with no overlap with the required term", () => {
    const result = evaluateAdCopyStyleGate({
      copy: {
        displayHook: "Amazing deal on great food",
      },
      provenance: aiProvenance,
      requiredSpecificTerms: ["12 ounce bag of whole bean coffee"],
    });

    expect(result.ok).toBe(false);
    expect(result.failures.find((failure) => failure.field === "displayHook")?.reasons).toContain(
      "HYPE_WITHOUT_SPECIFICITY",
    );
  });

  it("requires the word itself for a single-content-word required term", () => {
    const missing = evaluateAdCopyStyleGate({
      copy: { displayHook: "An amazing morning treat" },
      provenance: aiProvenance,
      requiredSpecificTerms: ["coffee"],
    });
    expect(missing.failures.find((failure) => failure.field === "displayHook")?.reasons).toContain(
      "HYPE_WITHOUT_SPECIFICITY",
    );

    const present = evaluateAdCopyStyleGate({
      copy: { displayHook: "An amazing cup of coffee" },
      provenance: aiProvenance,
      requiredSpecificTerms: ["coffee"],
    });
    expect(present.failures.find((failure) => failure.field === "displayHook")?.reasons ?? []).not.toContain(
      "HYPE_WITHOUT_SPECIFICITY",
    );
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

describe("endsInDanglingFunctionWord (2026-07-26 corpus)", () => {
  it("catches truncated fragments observed in live copy", () => {
    // Shipped as AI_VALIDATED: "Coffee and a free to" / "Coffee in, to free".
    expect(endsInDanglingFunctionWord("Coffee and a free to")).toBe(true);
    expect(endsInDanglingFunctionWord("Buy one latte and")).toBe(true);
    expect(endsInDanglingFunctionWord("Your usual, plus")).toBe(true);
    expect(endsInDanglingFunctionWord("A second round of ")).toBe(true);
  });

  it("does not flag complete phrases or punctuated sentences", () => {
    expect(endsInDanglingFunctionWord("Second latte's on us")).toBe(false);
    expect(endsInDanglingFunctionWord("Grab the sandwich and the coffee is free.")).toBe(false);
    // Terminal punctuation marks a finished sentence even if the last word is short.
    expect(endsInDanglingFunctionWord("Where the regulars go to.")).toBe(false);
    expect(endsInDanglingFunctionWord("")).toBe(false);
  });
});

describe("hasQuantityArticleCollision (2026-07-26 corpus)", () => {
  it("catches a count pasted directly against an article-bearing item name", () => {
    // Shipped live: "40% off one THE SERGEANT'S STRIPES".
    expect(hasQuantityArticleCollision("40% off one THE SERGEANT'S STRIPES")).toBe(true);
    expect(hasQuantityArticleCollision("Buy two the house blends")).toBe(true);
    expect(hasQuantityArticleCollision("Save on 3 the works burgers")).toBe(true);
  });

  it("does not flag natural counting or punctuated clauses", () => {
    expect(hasQuantityArticleCollision("Buy one latte and get one free")).toBe(false);
    expect(hasQuantityArticleCollision("Buy one, the second is free")).toBe(false);
    expect(hasQuantityArticleCollision("One of the best ways to start the day")).toBe(false);
    expect(hasQuantityArticleCollision("")).toBe(false);
  });
});

describe("hasArticleSoundDisagreement (2026-08-03 live poster)", () => {
  it("catches an article that disagrees with the following sound", () => {
    // Shipped live on the Cedar & Bean Cafe poster as the hero headline.
    expect(hasArticleSoundDisagreement("Half off a espresso")).toBe(true);
    expect(hasArticleSoundDisagreement("Grab a iced americano")).toBe(true);
    expect(hasArticleSoundDisagreement("Free with a order of fries")).toBe(true);
    expect(hasArticleSoundDisagreement("Take an croissant home")).toBe(true);
  });

  it("accepts correct articles, including the sounds spelling gets wrong", () => {
    expect(hasArticleSoundDisagreement("Half off an espresso")).toBe(false);
    expect(hasArticleSoundDisagreement("Free with a croissant")).toBe(false);
    // Vowel letters opening on a consonant sound.
    expect(hasArticleSoundDisagreement("A one-time offer on a unique blend")).toBe(false);
    expect(hasArticleSoundDisagreement("A user favorite for a euro")).toBe(false);
    // Silent h takes "an"; sounded h is a stylistic choice we never flag.
    expect(hasArticleSoundDisagreement("Ready in half an hour")).toBe(false);
    expect(hasArticleSoundDisagreement("An historic roast")).toBe(false);
    // Letter-name initialisms are unpredictable, so they are left alone.
    expect(hasArticleSoundDisagreement("Upgrade to an XL cold brew")).toBe(false);
    expect(hasArticleSoundDisagreement("Ask about a FAQ card")).toBe(false);
    expect(hasArticleSoundDisagreement("")).toBe(false);
  });

  it("never fires on the deterministic writer's own article choice", () => {
    // articleFor() in deal-offer-contract/localized-offer-renderer picks the
    // article for fallback copy, and that fallback is itself run through this
    // gate — if the two disagreed, a rejected AI candidate would fall back to
    // copy that also fails.
    const articleFor = (value: string): "a" | "an" => {
      if (/^(?:honest|hour|heir|herb)\b/i.test(value)) return "an";
      if (/^(?:uni([^nmd]|$)|user|useful|utensil|u[bcfhjkqrst][a-z])/i.test(value)) return "a";
      return /^[aeiou]/i.test(value) ? "an" : "a";
    };
    for (const item of ["espresso", "iced latte", "apple turnover", "croissant", "hour-long tasting", "usual order"]) {
      expect(hasArticleSoundDisagreement(`Free ${articleFor(item)} ${item}`)).toBe(false);
    }
  });
});

describe("gate wiring for instruction leaks, fragments, and collisions", () => {
  it("rejects planning vocabulary, truncated lines, and count-article collisions in AI copy", () => {
    const result = evaluateAdCopyStyleGate({
      copy: {
        displayHook: "Coffee and a free to",
        supportingLine: "Save 40% on one latte, clearly and simply",
        pushBody: "40% off one the Recon Roast",
      },
      provenance: aiProvenance,
      requiredSpecificTerms: ["latte"],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "displayHook",
          reasons: expect.arrayContaining(["TRUNCATED_FRAGMENT"]),
        }),
        expect.objectContaining({
          field: "supportingLine",
          reasons: expect.arrayContaining(["INSTRUCTION_LEAK_PHRASE"]),
        }),
        expect.objectContaining({
          field: "pushBody",
          reasons: expect.arrayContaining(["QUANTITY_ARTICLE_COLLISION"]),
        }),
      ]),
    );
  });

  it("still passes clean copy through unchanged", () => {
    const result = evaluateAdCopyStyleGate({
      copy: {
        displayHook: "Second latte's on us",
        supportingLine: "Order your usual and hand the free one to a friend.",
      },
      provenance: aiProvenance,
      requiredSpecificTerms: ["latte"],
    });

    expect(result.ok).toBe(true);
  });
});
