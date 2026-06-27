import type { PosterCopyV1, PosterPolicyResult, PosterSanitizeOptions } from "./posterTypes.ts";

type PatternRule = {
  code: string;
  label: string;
  pattern: RegExp;
};

const FORBIDDEN_RULES: PatternRule[] = [
  { code: "APP_BRAND_TOKEN", label: "Twofer", pattern: /\btwofer\b/gi },
  { code: "CTA_CLAIM", label: "claim", pattern: /\bclaim(?:\s+(?:on|in)\s+\w+)?\b/gi },
  { code: "CTA_REDEEM", label: "redeem", pattern: /\bredeem(?:\s+now)?\b/gi },
  { code: "CTA_SCAN", label: "scan", pattern: /\bscan\b/gi },
  { code: "CTA_TAP", label: "tap", pattern: /\btap\b/gi },
  { code: "CTA_APP", label: "get in app", pattern: /\bget\s+(?:it\s+)?in\s+(?:the\s+)?app\b/gi },
  { code: "SCARCITY_ONLY", label: "only X available", pattern: /\bonly\s+\d+\s+(?:available|left|remain(?:ing)?)\b/gi },
  { code: "SCARCITY_AVAILABLE", label: "available/left", pattern: /\b\d+\s+(?:available|left|remain(?:ing)?)\b/gi },
  { code: "SCARCITY_LIMITED_QUANTITY", label: "limited quantity", pattern: /\blimited\s+quantit(?:y|ies)\b/gi },
  { code: "SCARCITY_HURRY", label: "hurry", pattern: /\bhurry\b/gi },
  { code: "MUTABLE_LIVE_NOW", label: "live now", pattern: /\blive\s+now\b/gi },
  { code: "MUTABLE_TIME_LEFT", label: "time left", pattern: /\b(?:ends?\s+in|time\s+left|left\s+today)\b/gi },
  { code: "QR_CODE", label: "QR", pattern: /\bqr\s*code\b|\bqr\b/gi },
  { code: "COUPON_CODE", label: "coupon/code", pattern: /\b(?:coupon|promo)\s+code\b/gi },
];

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function applyForbiddenRemovals(input: string): { text: string; removedTerms: string[] } {
  let text = cleanText(input);
  const removedTerms: string[] = [];
  for (const rule of FORBIDDEN_RULES) {
    if (rule.pattern.test(text)) {
      removedTerms.push(rule.label);
      text = text.replace(rule.pattern, " ");
    }
    rule.pattern.lastIndex = 0;
  }
  return {
    text: text.replace(/\s{2,}/g, " ").replace(/\s+([,.!?:;])/g, "$1").trim(),
    removedTerms: [...new Set(removedTerms)],
  };
}

export function clampPosterText(input: string, maxChars: number): string {
  const clean = cleanText(input);
  if (!clean || clean.length <= maxChars) return clean;
  const words = clean.split(/\s+/);
  if (words.length === 1) {
    return clean.length <= maxChars + 8 ? clean : clean.slice(0, maxChars).trim();
  }
  let out = "";
  for (const word of words) {
    const candidate = out ? `${out} ${word}` : word;
    if (candidate.length > maxChars) break;
    out = candidate;
  }
  return out || clean;
}

export function sanitizePosterText(input: string, options: PosterSanitizeOptions = {}): string {
  const fallback = cleanText(options.fallback);
  const removed = applyForbiddenRemovals(input);
  const base = removed.text || fallback;
  const clamped = options.maxChars ? clampPosterText(base, options.maxChars) : base;
  return options.uppercase === false ? clamped : clamped.toUpperCase();
}

export function scanPosterTextPolicy(input: string): PosterPolicyResult {
  const clean = cleanText(input);
  const reasonCodes: string[] = [];
  const removedTerms: string[] = [];
  for (const rule of FORBIDDEN_RULES) {
    if (rule.pattern.test(clean)) {
      reasonCodes.push(rule.code);
      removedTerms.push(rule.label);
    }
    rule.pattern.lastIndex = 0;
  }
  return {
    passed: reasonCodes.length === 0,
    reasonCodes: [...new Set(reasonCodes)],
    removedTerms: [...new Set(removedTerms)],
    warnings: [],
  };
}

export function assertPosterCopyPolicy(copy: PosterCopyV1): PosterPolicyResult {
  const fields = [
    copy.business_name,
    copy.headline,
    copy.offer_line_1,
    copy.offer_line_2,
    copy.subline ?? "",
  ];
  const reasonCodes: string[] = [];
  const removedTerms: string[] = [];
  const warnings: string[] = [];
  for (const field of fields) {
    const result = scanPosterTextPolicy(field);
    reasonCodes.push(...result.reasonCodes);
    removedTerms.push(...result.removedTerms);
  }
  if (!cleanText(copy.business_name)) reasonCodes.push("MISSING_BUSINESS_NAME");
  if (!cleanText(copy.headline)) warnings.push("MISSING_HEADLINE");
  if (!cleanText(copy.offer_line_1) || !cleanText(copy.offer_line_2)) reasonCodes.push("MISSING_OFFER_LINES");
  return {
    passed: reasonCodes.length === 0,
    reasonCodes: [...new Set(reasonCodes)],
    removedTerms: [...new Set(removedTerms)],
    warnings: [...new Set(warnings)],
  };
}

export function sanitizePosterCopy(copy: PosterCopyV1, fallbackBusinessName: string): {
  copy: PosterCopyV1;
  policy: PosterPolicyResult;
} {
  const subline = cleanText(copy.subline)
    ? sanitizePosterText(copy.subline ?? "", { fallback: "", maxChars: 32 })
    : "";
  const sanitized: PosterCopyV1 = {
    business_name: sanitizePosterText(copy.business_name, {
      fallback: fallbackBusinessName,
      maxChars: 34,
      uppercase: false,
    }),
    headline: sanitizePosterText(copy.headline, { fallback: copy.offer_line_1, maxChars: 28 }),
    offer_line_1: sanitizePosterText(copy.offer_line_1, { fallback: "LOCAL DEAL", maxChars: 28 }),
    offer_line_2: sanitizePosterText(copy.offer_line_2, { fallback: "LOCAL FAVORITE", maxChars: 28 }),
    ...(subline ? { subline } : {}),
  };
  return { copy: sanitized, policy: assertPosterCopyPolicy(sanitized) };
}
