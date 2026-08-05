import { describe, expect, it } from "vitest";

import {
  AD_COPY_STRATEGY_IDS,
  checkAdCandidateDiversity,
  pruneDiversityOffenders,
  type AdCandidateForDiversity,
} from "./ad-candidate-diversity";

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

describe("pruneDiversityOffenders", () => {
  function withId(id: string, base: AdCandidateForDiversity): AdCandidateForDiversity {
    return { ...base, candidate_id: id };
  }

  it("keeps the higher-scored candidate and removes the lower-scored one from a duplicate-headline pair", () => {
    const candidates: AdCandidateForDiversity[] = [
      withId("low", candidate("value_clarity", "Coffee gets the bagel")),
      withId("high", candidate("social_or_occasion", "Coffee gets the bagel")),
      withId("third", candidate("product_desire", "Warm breakfast with coffee")),
    ];
    const check = checkAdCandidateDiversity(candidates);
    expect(check.hardFailures.map((issue) => issue.code)).toContain("IDENTICAL_HEADLINE");

    const result = pruneDiversityOffenders(candidates, check.issues, { low: 20, high: 80, third: 50 });

    expect(result.removedIds).toEqual(["low"]);
    expect(result.survivors.map((entry) => entry.candidate_id).sort()).toEqual(["high", "third"]);
    expect(result.residualIssues.some((issue) => issue.code === "IDENTICAL_HEADLINE")).toBe(false);
  });

  it("prunes cascading conflicts one at a time until the group is clean", () => {
    // All three share the exact same normalized headline, so the initial
    // IDENTICAL_HEADLINE issue names all three ids at once. Removing only the
    // single worst-scored candidate should leave a fresh conflict between the
    // remaining two, which a second pruning pass must also resolve.
    const candidates: AdCandidateForDiversity[] = [
      withId("worst", candidate("value_clarity", "Coffee gets the bagel")),
      withId("middle", candidate("social_or_occasion", "Coffee gets the bagel")),
      withId("best", candidate("product_desire", "Coffee gets the bagel")),
    ];
    const check = checkAdCandidateDiversity(candidates);
    const identical = check.hardFailures.find((issue) => issue.code === "IDENTICAL_HEADLINE");
    expect(identical?.candidateIds.sort()).toEqual(["best", "middle", "worst"]);

    const result = pruneDiversityOffenders(candidates, check.issues, { worst: 10, middle: 50, best: 90 });

    expect(result.removedIds).toEqual(["worst", "middle"]);
    expect(result.survivors.map((entry) => entry.candidate_id)).toEqual(["best"]);
    expect(result.residualIssues.some((issue) => issue.code === "IDENTICAL_HEADLINE")).toBe(false);
  });

  it("stops pruning once fewer than 2 candidates remain instead of emptying the batch", () => {
    const candidates: AdCandidateForDiversity[] = [
      withId("a", candidate("value_clarity", "Coffee gets the bagel")),
      withId("b", candidate("social_or_occasion", "Coffee gets the bagel")),
    ];
    const check = checkAdCandidateDiversity(candidates);

    const result = pruneDiversityOffenders(candidates, check.issues, { a: 30, b: 30 });

    expect(result.survivors).toHaveLength(1);
    expect(result.removedIds).toHaveLength(1);
    // The batch is down to one survivor; whatever remains (e.g. missing-strategy
    // warnings) is reported as residual rather than triggering further pruning.
    expect(result.residualIssues.some((issue) => issue.code === "IDENTICAL_HEADLINE")).toBe(false);
  });

  it("leaves candidates untouched when there are no pruneable hard issues", () => {
    const candidates: AdCandidateForDiversity[] = [
      withId("a", candidate("value_clarity", "Coffee gets the bagel")),
      withId("b", candidate("social_or_occasion", "Bring breakfast to the break")),
    ];
    const check = checkAdCandidateDiversity(candidates);

    const result = pruneDiversityOffenders(candidates, check.issues, { a: 10, b: 10 });

    expect(result.removedIds).toEqual([]);
    expect(result.survivors.map((entry) => entry.candidate_id)).toEqual(["a", "b"]);
  });
});
