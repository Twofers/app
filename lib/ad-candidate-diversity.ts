export const AD_COPY_STRATEGY_IDS = [
  "value_clarity",
  "social_or_occasion",
  "product_desire",
  "local_discovery",
  "merchant_specific",
] as const;

export type AdCopyStrategyId = (typeof AD_COPY_STRATEGY_IDS)[number];

export type AdCandidateForDiversity = {
  candidate_id?: string;
  strategy_id?: string;
  headline: string;
  short_description: string;
  push_notification?: string;
  social_caption?: string;
};

export type AdCandidateDiversityIssue = {
  severity: "hard" | "warning";
  code:
    | "MISSING_REQUIRED_STRATEGY"
    | "UNKNOWN_STRATEGY"
    | "DUPLICATE_STRATEGY"
    | "IDENTICAL_HEADLINE"
    | "DUPLICATE_HEADLINE_OPENING"
    | "OBVIOUS_PARAPHRASE"
    | "HIGH_HEADLINE_SIMILARITY"
    | "HIGH_BODY_SIMILARITY";
  candidateIds: string[];
  message: string;
  score?: number;
};

export type AdCandidateDiversityResult = {
  ok: boolean;
  issues: AdCandidateDiversityIssue[];
  hardFailures: AdCandidateDiversityIssue[];
  warnings: AdCandidateDiversityIssue[];
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "get",
  "grab",
  "one",
  "order",
  "the",
  "to",
  "with",
  "when",
  "you",
  "your",
]);

function candidateId(candidate: AdCandidateForDiversity, index: number): string {
  return candidate.candidate_id || `candidate_${index + 1}`;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulWords(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function firstMeaningfulWords(value: string, count: number): string {
  return meaningfulWords(value).slice(0, count).join(" ");
}

function tokenSet(value: string): Set<string> {
  return new Set(meaningfulWords(value));
}

function jaccard(left: string, right: string): number {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((value) => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function addIssue(
  issues: AdCandidateDiversityIssue[],
  issue: AdCandidateDiversityIssue,
): void {
  issues.push(issue);
}

export function checkAdCandidateDiversity(
  candidates: readonly AdCandidateForDiversity[],
): AdCandidateDiversityResult {
  const issues: AdCandidateDiversityIssue[] = [];
  const strategies = new Map<string, string[]>();
  const normalizedHeadlines = new Map<string, string[]>();
  const openings = new Map<string, string[]>();

  candidates.forEach((candidate, index) => {
    const id = candidateId(candidate, index);
    const strategy = candidate.strategy_id ?? "";
    if (strategy && !(AD_COPY_STRATEGY_IDS as readonly string[]).includes(strategy)) {
      addIssue(issues, {
        severity: "hard",
        code: "UNKNOWN_STRATEGY",
        candidateIds: [id],
        message: `Unknown strategy: ${strategy}`,
      });
    }
    if (strategy) strategies.set(strategy, [...(strategies.get(strategy) ?? []), id]);

    const headline = normalize(candidate.headline);
    if (headline) normalizedHeadlines.set(headline, [...(normalizedHeadlines.get(headline) ?? []), id]);

    const opening = firstMeaningfulWords(candidate.headline, 4);
    if (opening.split(" ").length >= 4) openings.set(opening, [...(openings.get(opening) ?? []), id]);
  });

  // A strategy can only be genuinely "missing" when the model had the chance to
  // cover all of them. When fewer candidates arrive (an upstream gate already
  // filtered some out), absent strategies are expected — rejecting the whole
  // surviving set for them would discard good candidates.
  const missingStrategySeverity: AdCandidateDiversityIssue["severity"] =
    candidates.length >= AD_COPY_STRATEGY_IDS.length ? "hard" : "warning";
  for (const required of AD_COPY_STRATEGY_IDS) {
    if (!strategies.has(required)) {
      addIssue(issues, {
        severity: missingStrategySeverity,
        code: "MISSING_REQUIRED_STRATEGY",
        candidateIds: [],
        message: `Missing required strategy: ${required}`,
      });
    }
  }

  for (const [strategy, ids] of strategies.entries()) {
    if (ids.length > 1) {
      addIssue(issues, {
        severity: "hard",
        code: "DUPLICATE_STRATEGY",
        candidateIds: ids,
        message: `Duplicate strategy: ${strategy}`,
      });
    }
  }

  for (const [headline, ids] of normalizedHeadlines.entries()) {
    if (headline && ids.length > 1) {
      addIssue(issues, {
        severity: "hard",
        code: "IDENTICAL_HEADLINE",
        candidateIds: ids,
        message: "Two candidates have the same normalized headline.",
      });
    }
  }

  for (const [opening, ids] of openings.entries()) {
    if (opening && ids.length > 1) {
      addIssue(issues, {
        severity: "hard",
        code: "DUPLICATE_HEADLINE_OPENING",
        candidateIds: ids,
        message: `Two headlines begin with the same first four meaningful words: ${opening}`,
      });
    }
  }

  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const a = candidates[left]!;
      const b = candidates[right]!;
      const ids = [candidateId(a, left), candidateId(b, right)];
      const headlineScore = jaccard(a.headline, b.headline);
      const bodyScore = jaccard(
        `${a.short_description} ${a.push_notification ?? ""} ${a.social_caption ?? ""}`,
        `${b.short_description} ${b.push_notification ?? ""} ${b.social_caption ?? ""}`,
      );
      if (headlineScore >= 0.92 && bodyScore >= 0.85) {
        addIssue(issues, {
          severity: "hard",
          code: "OBVIOUS_PARAPHRASE",
          candidateIds: ids,
          message: "Two candidates are effectively the same idea with trivial wording changes.",
          score: Number(((headlineScore + bodyScore) / 2).toFixed(3)),
        });
        continue;
      }
      if (headlineScore >= 0.65) {
        addIssue(issues, {
          severity: "warning",
          code: "HIGH_HEADLINE_SIMILARITY",
          candidateIds: ids,
          message: "Headline similarity is high; keep for calibration unless other hard failures exist.",
          score: Number(headlineScore.toFixed(3)),
        });
      }
      if (bodyScore >= 0.75) {
        addIssue(issues, {
          severity: "warning",
          code: "HIGH_BODY_SIMILARITY",
          candidateIds: ids,
          message: "Body-copy similarity is high; keep for calibration unless other hard failures exist.",
          score: Number(bodyScore.toFixed(3)),
        });
      }
    }
  }

  const hardFailures = issues.filter((issue) => issue.severity === "hard");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return {
    ok: hardFailures.length === 0,
    issues,
    hardFailures,
    warnings,
  };
}

export type DiversityPruneResult = {
  survivors: AdCandidateForDiversity[];
  removedIds: string[];
  residualIssues: AdCandidateDiversityIssue[];
};

/**
 * Issue codes that name a genuine multi-candidate conflict (two or more
 * candidates competing over the same headline/opening/strategy lane), as
 * opposed to a single-candidate problem (UNKNOWN_STRATEGY) or a whole-batch
 * gap (MISSING_REQUIRED_STRATEGY) that removing a candidate cannot fix.
 */
const PRUNEABLE_DIVERSITY_CODES = new Set<AdCandidateDiversityIssue["code"]>([
  "DUPLICATE_STRATEGY",
  "IDENTICAL_HEADLINE",
  "DUPLICATE_HEADLINE_OPENING",
  "OBVIOUS_PARAPHRASE",
]);

/**
 * Pure pruning helper (additive, 2026-08-05): given a candidate batch, the
 * diversity issues already computed for it, and a preliminary score per
 * candidate id, repeatedly drops the lower-scored member of each offending
 * pair/group and re-runs checkAdCandidateDiversity until the survivors are
 * clean, no more pruneable hard issues remain, or fewer than 2 candidates are
 * left (nothing left to compare, so pruning stops rather than emptying the
 * batch further). Candidate ids are resolved once up front so removal is
 * stable even when candidates rely on the positional candidate_N fallback id.
 */
export function pruneDiversityOffenders(
  candidates: readonly AdCandidateForDiversity[],
  issues: readonly AdCandidateDiversityIssue[],
  preliminaryScores: Record<string, number>,
): DiversityPruneResult {
  const scoreOf = (id: string): number => preliminaryScores[id] ?? 0;

  let survivors: AdCandidateForDiversity[] = candidates.map((candidate, index) => ({
    ...candidate,
    candidate_id: candidateId(candidate, index),
  }));
  let currentIssues: readonly AdCandidateDiversityIssue[] = issues;
  const removedIds: string[] = [];

  while (survivors.length >= 2) {
    const pruneable = currentIssues.filter(
      (issue) => issue.severity === "hard" && issue.candidateIds.length >= 2 && PRUNEABLE_DIVERSITY_CODES.has(issue.code),
    );
    if (pruneable.length === 0) break;

    let worstId: string | null = null;
    let worstScore = Infinity;
    for (const issue of pruneable) {
      for (const id of issue.candidateIds) {
        const score = scoreOf(id);
        if (score < worstScore) {
          worstScore = score;
          worstId = id;
        }
      }
    }
    if (worstId === null) break;

    survivors = survivors.filter((candidate) => candidate.candidate_id !== worstId);
    removedIds.push(worstId);

    if (survivors.length < 2) break;
    currentIssues = checkAdCandidateDiversity(survivors).issues;
  }

  const residualIssues = checkAdCandidateDiversity(survivors).issues;
  return { survivors, removedIds, residualIssues };
}
