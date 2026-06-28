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

  for (const required of AD_COPY_STRATEGY_IDS) {
    if (!strategies.has(required)) {
      addIssue(issues, {
        severity: "hard",
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
