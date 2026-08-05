import { describe, expect, it } from "vitest";

import {
  CANDIDATE_JUDGE_JSON_SCHEMA,
  CANDIDATE_JUDGE_POSTER_JSON_SCHEMA,
  CANDIDATE_JUDGE_PROMPT_VERSION,
  applyJudgeScoresToCandidates,
  buildCandidateJudgePrompt,
  rankCandidatesDeterministically,
  scoreCandidateDeterministically,
} from "./candidate-judge";
import { buildDealOfferContract, type AiDealCopyVariant, type DealOfferContract } from "./deal-offer-contract";
import { buildMerchantCreativeProfile } from "./merchant-creative-profile";
import { validateDealEligibility, type DealEligibilityInput } from "./deal-eligibility";

function contractFor(input: DealEligibilityInput): DealOfferContract {
  const contract = buildDealOfferContract({
    businessId: "biz_123",
    businessName: "Cedar Street Cafe",
    locationId: "loc_123",
    locationName: "Cedar Street Cafe - Main",
    dealEligibility: input,
    eligibilityResult: validateDealEligibility(input),
  });
  if (!contract) throw new Error("expected contract");
  return contract;
}

const contract = contractFor({
  dealType: "BUY_ONE_GET_SOMETHING_FREE",
  appliesTo: "SINGLE_ITEM",
  requiredPurchaseQuantity: 1,
  requiredItemDescription: "coffee",
  freeItemQuantity: 1,
  freeItemDescription: "bagel",
  freeItemDiscountPercent: 100,
});

const coffeeCookieContract = contractFor({
  dealType: "BUY_ONE_GET_SOMETHING_FREE",
  appliesTo: "SINGLE_ITEM",
  requiredPurchaseQuantity: 1,
  requiredItemDescription: "any large coffee drink",
  freeItemQuantity: 1,
  freeItemDescription: "cookie of your choice",
  freeItemDiscountPercent: 100,
});

function copy(id: string, overrides: Partial<AiDealCopyVariant>): AiDealCopyVariant {
  return {
    candidate_id: id,
    strategy_id: "value_clarity",
    headline: "Buy a coffee and get a free bagel",
    short_description: "Buy a coffee and the bagel is on us.",
    push_notification: "Claim the coffee deal and get a free bagel.",
    ...overrides,
  };
}

describe("candidate judge helpers", () => {
  it("scores concrete local copy above generic language", () => {
    const profile = buildMerchantCreativeProfile({
      businessId: "biz_123",
      category: "Coffee shop",
      location: "Downtown Grapevine",
      research: { item_name: "coffee and bagel", description: "", is_familiar: true },
    });
    const strong = copy("strong", { short_description: "Make the morning coffee run count with the bagel on us." });
    const generic = copy("generic", { short_description: "Don't miss out on this amazing deal." });

    expect(scoreCandidateDeterministically(strong, contract, profile).total)
      .toBeGreaterThan(scoreCandidateDeterministically(generic, contract, profile).total);
    expect(rankCandidatesDeterministically([generic, strong], contract, profile)[0]?.candidate_id).toBe("strong");
  });

  it("scores weak try-our item headlines below offer-aware headlines", () => {
    const weak = copy("weak", {
      headline: "Try our any large coffee drink",
      short_description: "Buy any large coffee drink and get a cookie of your choice free.",
      push_notification: "Buy any large coffee drink and get a cookie free.",
    });
    const strong = copy("strong", {
      headline: "Buy a large coffee, get a cookie",
      short_description: "Buy any large coffee drink and the cookie of your choice is on us.",
      push_notification: "Claim a large coffee and free cookie today.",
    });
    const weakScore = scoreCandidateDeterministically(weak, coffeeCookieContract);
    const strongScore = scoreCandidateDeterministically(strong, coffeeCookieContract);

    expect(weakScore.details.headlineStrength).toBeLessThan(strongScore.details.headlineStrength);
    expect(strongScore.total).toBeGreaterThan(weakScore.total);
    expect(rankCandidatesDeterministically([weak, strong], coffeeCookieContract)[0]?.candidate_id).toBe("strong");
  });

  it("applies judge winner and hard-fail signals to candidate scores", () => {
    const ranked = applyJudgeScoresToCandidates([
      copy("a", {}),
      copy("b", { short_description: "Buy a coffee and get breakfast handled." }),
    ], {
      pass: true,
      winnerCandidateId: "b",
      rankedCandidateIds: ["b", "a"],
      scores: [],
      hardFailReasons: [{ candidateId: "a", code: "GENERIC_AI_LANGUAGE" }],
      conciseFeedback: [],
    });

    expect(ranked[0]?.candidate_id).toBe("b");
    expect(ranked.find((candidate) => candidate.candidate_id === "a")?.judge_score).toBe(-100);
  });

  it("builds a blind judge prompt without provider identity", () => {
    const prompt = buildCandidateJudgePrompt({
      offerFacts: "Buy a coffee and get a free bagel.",
      categoryPlaybookBlock: "CATEGORY PLAYBOOK: coffee_cafe",
      merchantProfileBlock: "MERCHANT CREATIVE PROFILE: sparse",
      creativeBrief: { exactCustomerHook: "breakfast is included" },
      candidates: [copy("a", {}), copy("b", {})],
    });

    expect(prompt.system).toContain("Output JSON only");
    expect(prompt.userText).toContain("CANDIDATES TO JUDGE");
    expect(prompt.userText).not.toMatch(/openai|gemini|provider/i);
  });

  it("carries the v2 say-it-aloud, category-fit, and planning-vocabulary rubric", () => {
    const prompt = buildCandidateJudgePrompt({
      offerFacts: "Buy a coffee and get a free bagel.",
      categoryPlaybookBlock: "CATEGORY PLAYBOOK: coffee_cafe",
      merchantProfileBlock: "MERCHANT CREATIVE PROFILE: sparse",
      creativeBrief: { exactCustomerHook: "breakfast is included" },
      candidates: [copy("a", {}), copy("b", {})],
    });

    expect(CANDIDATE_JUDGE_PROMPT_VERSION).toBe("candidate-judge-v2");
    expect(prompt.system).toContain("saying it out loud");
    expect(prompt.system).toContain("borrowed from a different kind of business");
    expect(prompt.system).toContain("planning vocabulary");
    expect(prompt.system).toContain("what the customer does, and what the customer gets");
  });

  it("leaves the prompt and schema byte-identical when poster params are absent", () => {
    const base = {
      offerFacts: "Buy a coffee and get a free bagel.",
      categoryPlaybookBlock: "CATEGORY PLAYBOOK: coffee_cafe",
      merchantProfileBlock: "MERCHANT CREATIVE PROFILE: sparse",
      creativeBrief: { exactCustomerHook: "breakfast is included" },
      candidates: [copy("a", {}), copy("b", {})],
    };

    const withoutParams = buildCandidateJudgePrompt(base);
    const withEmptyParams = buildCandidateJudgePrompt({ ...base, creativeFormat: undefined, posterOfferLines: undefined });
    const withEmptyLines = buildCandidateJudgePrompt({ ...base, creativeFormat: "poster_v1", posterOfferLines: [] });

    expect(withoutParams.userText).not.toContain("POSTER RENDER CONTEXT");
    expect(withoutParams.system).toBe([
      "You are judging mobile ad copy for Twofer.",
      "Choose the candidate a real local merchant would be most likely to approve.",
      "Read each headline and description as if the owner were saying it out loud to a regular customer. Reward lines a person would actually say; punish template-sounding or machine-filled lines.",
      "Reward copy that fits this exact item and business category; punish moments borrowed from a different kind of business.",
      "The exchange must be instantly clear: what the customer does, and what the customer gets.",
      "Do not reward generic excitement. Prefer exact offer clarity, natural local language, merchant specificity, and mobile readability.",
      'Hard-fail copy that changes the offer, uses BOGO/2-for-1 shorthand, invents claims, echoes planning vocabulary such as "clearly and simply" or "exact exchange", or sounds like generic AI marketing.',
      "Output JSON only.",
    ].join("\n"));
    expect(withEmptyParams.userText).toBe(withoutParams.userText);
    expect(withEmptyLines.userText).toBe(withoutParams.userText);
    expect(withoutParams.jsonSchema).toBe(CANDIDATE_JUDGE_JSON_SCHEMA);
    expect(withEmptyParams.jsonSchema).toBe(CANDIDATE_JUDGE_JSON_SCHEMA);
    expect(withEmptyLines.jsonSchema).toBe(CANDIDATE_JUDGE_JSON_SCHEMA);
  });

  it("appends POSTER RENDER CONTEXT and swaps in the poster schema when creativeFormat is poster_v1", () => {
    const prompt = buildCandidateJudgePrompt({
      offerFacts: "Buy a coffee and get a free bagel.",
      categoryPlaybookBlock: "CATEGORY PLAYBOOK: coffee_cafe",
      merchantProfileBlock: "MERCHANT CREATIVE PROFILE: sparse",
      creativeBrief: { exactCustomerHook: "breakfast is included" },
      candidates: [copy("a", {}), copy("b", {})],
      creativeFormat: "poster_v1",
      posterOfferLines: ["Buy 1 coffee", "Get 1 bagel free"],
    });

    expect(prompt.userText).toContain("POSTER RENDER CONTEXT");
    expect(prompt.userText).toContain("two-line hero over a photo");
    expect(prompt.userText).toContain("- Buy 1 coffee");
    expect(prompt.userText).toContain("- Get 1 bagel free");
    expect(prompt.userText).toContain("adds an angle beyond those offer lines");
    expect(prompt.jsonSchema).toBe(CANDIDATE_JUDGE_POSTER_JSON_SCHEMA);
    expect(prompt.jsonSchema.schema.properties.scores.items.properties).toHaveProperty("posterHeroStrength");
    expect(prompt.jsonSchema.schema.properties.scores.items.required).toContain("posterHeroStrength");
  });
});
