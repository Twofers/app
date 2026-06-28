import { describe, expect, it } from "vitest";

import {
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
});
