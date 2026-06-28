import type { AiDealCopyVariant, DealOfferContract } from "./deal-offer-contract.ts";
import type { MerchantCreativeProfile } from "./merchant-creative-profile.ts";
import { AD_COPY_BOGO_SHORTHAND_PATTERNS, AD_COPY_FORBIDDEN_PATTERNS, AD_COPY_GENERIC_PHRASE_PATTERNS } from "./ad-language-policy.ts";

export const CANDIDATE_JUDGE_PROMPT_VERSION = "candidate-judge-v1";

export const CANDIDATE_JUDGE_JSON_SCHEMA = {
  name: "candidate_judge",
  strict: true,
  schema: {
    type: "object",
    properties: {
      pass: { type: "boolean" },
      winnerCandidateId: { type: "string" },
      rankedCandidateIds: {
        type: "array",
        items: { type: "string" },
      },
      scores: {
        type: "array",
        items: {
          type: "object",
          properties: {
            candidateId: { type: "string" },
            offerClarity: { type: "number" },
            naturalLocalLanguage: { type: "number" },
            customerAppeal: { type: "number" },
            merchantSpecificity: { type: "number" },
            categoryFit: { type: "number" },
            headlineStrength: { type: "number" },
            originality: { type: "number" },
            mobileReadability: { type: "number" },
          },
          required: [
            "candidateId",
            "offerClarity",
            "naturalLocalLanguage",
            "customerAppeal",
            "merchantSpecificity",
            "categoryFit",
            "headlineStrength",
            "originality",
            "mobileReadability",
          ],
          additionalProperties: false,
        },
      },
      hardFailReasons: {
        type: "array",
        items: {
          type: "object",
          properties: {
            candidateId: { type: "string" },
            code: { type: "string" },
          },
          required: ["candidateId", "code"],
          additionalProperties: false,
        },
      },
      conciseFeedback: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["pass", "winnerCandidateId", "rankedCandidateIds", "scores", "hardFailReasons", "conciseFeedback"],
    additionalProperties: false,
  },
} as const;

export type CandidateJudgeScore = {
  candidateId: string;
  offerClarity: number;
  naturalLocalLanguage: number;
  customerAppeal: number;
  merchantSpecificity: number;
  categoryFit: number;
  headlineStrength: number;
  originality: number;
  mobileReadability: number;
};

export type CandidateJudgeResult = {
  pass: boolean;
  winnerCandidateId?: string;
  rankedCandidateIds: string[];
  scores: CandidateJudgeScore[];
  hardFailReasons: Array<{
    candidateId: string;
    code:
      | "OFFER_MISMATCH"
      | "GENERIC_AI_LANGUAGE"
      | "BANNED_SHORTHAND"
      | "UNSUPPORTED_CLAIM"
      | "UNCLEAR_VALUE"
      | "CATEGORY_MISMATCH"
      | "REPETITIVE_COPY"
      | "MOBILE_COPY_TOO_DENSE";
  }>;
  conciseFeedback: string[];
};

export type DeterministicCandidateScore = {
  candidateId: string;
  total: number;
  details: {
    offerClarity: number;
    naturalLocalLanguage: number;
    merchantSpecificity: number;
    categoryFit: number;
    productDesire: number;
    headlineStrength: number;
    fieldCoherence: number;
    mobileReadability: number;
  };
};

export type CandidateForJudging = AiDealCopyVariant & {
  candidate_id?: string;
  strategy_id?: string;
  strategy_reason?: string;
  preliminary_score?: number;
};

function cleanText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function textOf(candidate: CandidateForJudging): string {
  return [
    candidate.headline,
    candidate.short_description,
    candidate.push_title,
    candidate.push_body,
    candidate.push_notification,
    candidate.social_caption,
  ].map(cleanText).filter(Boolean).join(" ");
}

function hasPattern(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function containsItem(text: string, item: string): boolean {
  const clean = cleanText(item).toLowerCase();
  if (!clean) return true;
  return text.toLowerCase().includes(clean);
}

function candidateId(candidate: CandidateForJudging, index: number): string {
  return candidate.candidate_id || `candidate_${index + 1}`;
}

function boundedScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function scoreCandidateDeterministically(
  candidate: CandidateForJudging,
  contract: DealOfferContract,
  profile?: MerchantCreativeProfile | null,
  index = 0,
): DeterministicCandidateScore {
  const text = textOf(candidate);
  const lower = text.toLowerCase();
  const requiredItems = contract.aiRules.mustUseExactItemNames;
  const itemCoverage = requiredItems.length === 0
    ? 1
    : requiredItems.filter((item) => containsItem(text, item)).length / requiredItems.length;
  const offerClarity =
    8 +
    itemCoverage * 12 +
    (/\b(?:buy|order|get|claim|save)\b/i.test(candidate.headline) ? 3 : 0) +
    (/\b(?:free|off|on us|save)\b/i.test(text) ? 2 : 0);

  const genericPenalty = hasPattern(text, AD_COPY_FORBIDDEN_PATTERNS) ||
    hasPattern(text, AD_COPY_GENERIC_PHRASE_PATTERNS) ||
    hasPattern(text, AD_COPY_BOGO_SHORTHAND_PATTERNS)
    ? 8
    : 0;
  const naturalLocalLanguage = 15 - genericPenalty - ((text.match(/!/g) ?? []).length > 0 ? 2 : 0);

  const profileTerms = [
    ...(profile?.signatureItems ?? []),
    ...(profile?.naturalCustomerLanguage ?? []),
    ...(profile?.verifiedDifferentiators ?? []),
    profile?.neighborhood ?? "",
  ].filter(Boolean);
  const merchantSpecificity = profileTerms.length > 0 && profileTerms.some((term) => lower.includes(term.toLowerCase()))
    ? 15
    : profile?.merchantSpecificContextLimited
    ? 6
    : 8;

  const categoryFit = candidate.strategy_id === "merchant_specific" && profile?.merchantSpecificContextLimited ? 8 : 15;
  const productDesire = /\b(?:with|plus|pair|break|lunch|coffee|service|session|visit|pick up)\b/i.test(text) ? 10 : 6;
  const headlineLength = cleanText(candidate.headline).length;
  const headlineStrength = headlineLength >= 14 && headlineLength <= 70 ? 10 : 6;
  const fieldCoherence = cleanText(candidate.short_description) && cleanText(candidate.push_notification) ? 5 : 2;
  const mobileReadability = text.length <= 380 ? 5 : 2;
  const total = boundedScore(
    offerClarity +
      naturalLocalLanguage +
      merchantSpecificity +
      categoryFit +
      productDesire +
      headlineStrength +
      fieldCoherence +
      mobileReadability,
  );

  return {
    candidateId: candidateId(candidate, index),
    total,
    details: {
      offerClarity: boundedScore(offerClarity),
      naturalLocalLanguage: boundedScore(naturalLocalLanguage),
      merchantSpecificity: boundedScore(merchantSpecificity),
      categoryFit: boundedScore(categoryFit),
      productDesire: boundedScore(productDesire),
      headlineStrength: boundedScore(headlineStrength),
      fieldCoherence: boundedScore(fieldCoherence),
      mobileReadability: boundedScore(mobileReadability),
    },
  };
}

export function rankCandidatesDeterministically(
  candidates: readonly CandidateForJudging[],
  contract: DealOfferContract,
  profile?: MerchantCreativeProfile | null,
): Array<CandidateForJudging & { preliminary_score: number }> {
  return candidates
    .map((candidate, index) => ({
      ...candidate,
      preliminary_score: scoreCandidateDeterministically(candidate, contract, profile, index).total,
    }))
    .sort((left, right) => (right.preliminary_score ?? 0) - (left.preliminary_score ?? 0));
}

export function normalizeCandidateJudgeResult(value: unknown): CandidateJudgeResult | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CandidateJudgeResult>;
  const ranked = Array.isArray(raw.rankedCandidateIds)
    ? raw.rankedCandidateIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const scores = Array.isArray(raw.scores)
    ? raw.scores
        .filter((score): score is CandidateJudgeScore => !!score && typeof score === "object" && typeof score.candidateId === "string")
        .map((score) => ({
          candidateId: score.candidateId,
          offerClarity: Number(score.offerClarity) || 0,
          naturalLocalLanguage: Number(score.naturalLocalLanguage) || 0,
          customerAppeal: Number(score.customerAppeal) || 0,
          merchantSpecificity: Number(score.merchantSpecificity) || 0,
          categoryFit: Number(score.categoryFit) || 0,
          headlineStrength: Number(score.headlineStrength) || 0,
          originality: Number(score.originality) || 0,
          mobileReadability: Number(score.mobileReadability) || 0,
        }))
    : [];
  return {
    pass: raw.pass === true,
    ...(typeof raw.winnerCandidateId === "string" ? { winnerCandidateId: raw.winnerCandidateId } : {}),
    rankedCandidateIds: ranked,
    scores,
    hardFailReasons: Array.isArray(raw.hardFailReasons)
      ? raw.hardFailReasons.filter((reason): reason is CandidateJudgeResult["hardFailReasons"][number] =>
          !!reason && typeof reason === "object" && typeof reason.candidateId === "string" && typeof reason.code === "string")
      : [],
    conciseFeedback: Array.isArray(raw.conciseFeedback)
      ? raw.conciseFeedback.filter((line): line is string => typeof line === "string").slice(0, 8)
      : [],
  };
}

export function applyJudgeScoresToCandidates<T extends CandidateForJudging>(
  candidates: readonly T[],
  judge: CandidateJudgeResult,
): T[] {
  const scoreById = new Map<string, number>();
  const hardFailIds = new Set(judge.hardFailReasons.map((reason) => reason.candidateId));
  judge.rankedCandidateIds.forEach((id, index) => {
    scoreById.set(id, 100 - index * 8);
  });
  if (judge.pass && judge.winnerCandidateId) scoreById.set(judge.winnerCandidateId, 110);

  return candidates
    .map((candidate, index) => {
      const id = candidateId(candidate, index);
      const judgeScore = hardFailIds.has(id) ? -100 : scoreById.get(id) ?? candidate.judge_score ?? 0;
      return { ...candidate, judge_score: judgeScore, judge_reason: hardFailIds.has(id) ? "JUDGE_HARD_FAIL" : "JUDGE_RANKED" };
    })
    .sort((left, right) => (right.judge_score ?? 0) - (left.judge_score ?? 0));
}

export function buildCandidateJudgePrompt(params: {
  offerFacts: string;
  categoryPlaybookBlock: string;
  merchantProfileBlock: string;
  creativeBrief: unknown;
  candidates: readonly CandidateForJudging[];
}): { system: string; userText: string; jsonSchema: typeof CANDIDATE_JUDGE_JSON_SCHEMA } {
  const candidates = params.candidates.map((candidate, index) => ({
    candidateId: candidateId(candidate, index),
    strategyId: candidate.strategy_id ?? "",
    strategyReason: candidate.strategy_reason ?? "",
    headline: candidate.headline,
    description: candidate.short_description,
    pushTitle: candidate.push_title ?? "",
    pushBody: candidate.push_body ?? candidate.push_notification,
    socialCaption: candidate.social_caption ?? "",
  }));

  return {
    system: [
      "You are judging mobile ad copy for Twofer.",
      "Choose the candidate a real local merchant would be most likely to approve.",
      "Do not reward generic excitement. Prefer exact offer clarity, natural local language, merchant specificity, and mobile readability.",
      "Hard-fail copy that changes the offer, uses BOGO/2-for-1 shorthand, invents claims, or sounds like generic AI marketing.",
      "Output JSON only.",
    ].join("\n"),
    userText: [
      "IMMUTABLE OFFER FACTS:",
      params.offerFacts,
      "",
      params.categoryPlaybookBlock,
      "",
      params.merchantProfileBlock,
      "",
      "CREATIVE BRIEF FROM GENERATOR:",
      JSON.stringify(params.creativeBrief ?? {}),
      "",
      "CANDIDATES TO JUDGE:",
      JSON.stringify(candidates),
      "",
      "Score every candidate from 0 to 10 for each rubric field. Return rankedCandidateIds from strongest to weakest.",
    ].join("\n"),
    jsonSchema: CANDIDATE_JUDGE_JSON_SCHEMA,
  };
}
