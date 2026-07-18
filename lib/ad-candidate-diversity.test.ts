import { describe, expect, it } from "vitest";

import { AD_COPY_STRATEGY_IDS, checkAdCandidateDiversity, type AdCandidateForDiversity } from "./ad-candidate-diversity";

function candidate(strategy: string, headline: string, description = "Buy a coffee and the bagel is on us."): AdCandidateForDiversity {
  return {
    candidate_id: strategy,
    strategy_id: strategy,
    headline,
    short_description: description,
    push_notification: headline,
  };
}

describe("ad candidate diversity", () => {
  it("accepts the five required strategy lanes", () => {
    const result = checkAdCandidateDiversity([
      candidate("value_clarity", "Coffee gets the bagel"),
      candidate("social_or_occasion", "Bring breakfast to the break"),
      candidate("product_desire", "Coffee plus a bakery-case bagel"),
      candidate("local_discovery", "Try Cedar Street with breakfast"),
      candidate("merchant_specific", "Your coffee run gets breakfast"),
    ]);

    expect(AD_COPY_STRATEGY_IDS).toHaveLength(5);
    expect(result.ok).toBe(true);
    expect(result.hardFailures).toEqual([]);
  });

  it("hard-fails duplicate strategy lanes", () => {
    const result = checkAdCandidateDiversity([
      candidate("value_clarity", "Coffee gets the bagel"),
      candidate("value_clarity", "Coffee earns breakfast"),
    ]);

    expect(result.ok).toBe(false);
    expect(result.hardFailures.map((issue) => issue.code)).toContain("DUPLICATE_STRATEGY");
  });

  it("hard-fails a missing strategy only when the full candidate set was provided", () => {
    const fullSetWithDuplicate = checkAdCandidateDiversity([
      candidate("value_clarity", "Coffee gets the bagel"),
      candidate("value_clarity", "Coffee earns breakfast"),
      candidate("product_desire", "Coffee plus a bakery-case bagel"),
      candidate("local_discovery", "Try Cedar Street with breakfast"),
      candidate("merchant_specific", "Your coffee run gets breakfast"),
    ]);

    expect(fullSetWithDuplicate.ok).toBe(false);
    expect(fullSetWithDuplicate.hardFailures.map((issue) => issue.code)).toContain("MISSING_REQUIRED_STRATEGY");
  });

  it("downgrades missing strategies to warnings when candidates were already filtered upstream", () => {
    const survivors = checkAdCandidateDiversity([
      candidate("value_clarity", "Coffee gets the bagel"),
      candidate("social_or_occasion", "Bring breakfast to the break"),
      candidate("product_desire", "Coffee plus a bakery-case bagel"),
      candidate("local_discovery", "Try Cedar Street with breakfast"),
    ]);

    expect(survivors.ok).toBe(true);
    expect(survivors.hardFailures).toEqual([]);
    expect(survivors.warnings.map((issue) => issue.code)).toContain("MISSING_REQUIRED_STRATEGY");
  });

  it("hard-fails duplicate first four meaningful headline words", () => {
    const result = checkAdCandidateDiversity([
      candidate("value_clarity", "Coffee bagel morning reward"),
      candidate("social_or_occasion", "Coffee bagel morning reward today"),
      candidate("product_desire", "Warm breakfast with coffee"),
      candidate("local_discovery", "Try Cedar Street breakfast"),
      candidate("merchant_specific", "Your coffee run gets breakfast"),
    ]);

    expect(result.ok).toBe(false);
    expect(result.hardFailures.map((issue) => issue.code)).toContain("DUPLICATE_HEADLINE_OPENING");
  });
});
