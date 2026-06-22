export const AD_COPY_BANNED_PHRASES = [
  "qualifying purchase",
  "included after",
  "unlock savings",
  "elevate your experience",
  "treat yourself to",
  "indulge in",
  "limited-time local offer",
  "don't miss out",
  "act now",
  "exclusive deal",
  "savor the flavor",
  "perfectly paired",
  "AI-generated",
  "this offer allows you to",
  "customers can enjoy",
  "promotion applies to",
  "terms and conditions apply",
  "amazing deal",
  "delicious treat",
  "come enjoy our special offer",
] as const;

export const AD_COPY_GENERIC_PHRASE_PATTERNS = [
  /\blimited[- ]time offer\b/i,
  /\blimited[- ]time local offer\b/i,
  /\blimited[- ]time offer you'?ll love\b/i,
  /\bdon'?t miss out\b/i,
  /\bact now\b/i,
  /\btreat yourself\b/i,
  /\bspecial deal\b/i,
  /\bspecial offer just for you\b/i,
  /\bexclusive deal\b/i,
  /\bexclusive offer\b/i,
  /\bperfect for (?:any|every|your)\b/i,
  /\bperfect for any occasion\b/i,
  /\bsomething for everyone\b/i,
  /\byou deserve it\b/i,
  /\ban experience you won'?t forget\b/i,
] as const;

export const AD_COPY_AI_TONE_PATTERNS = [
  /\belevate your\b/i,
  /\belevate your experience\b/i,
  /\bunlock (?:a|the|your)\b/i,
  /\bunlock savings\b/i,
  /\bexperience (?:a|an|the) (?:perfect|ultimate|unforgettable)\b/i,
  /\bunforgettable\b.{0,30}\bexperience\b/i,
  /\bsavor (?:the|a|our)\b/i,
  /\bsavor the flavo?r\b/i,
  /\bindulge in\b/i,
  /\bindulge in deliciousness\b/i,
  /\bperfectly paired\b/i,
  /\bcrafted to perfection\b/i,
] as const;

export const AD_COPY_FORBIDDEN_PATTERNS = [
  /\bqualifying\s+purchase\b/i,
  /\bqualifying\b.{0,48}\bpurchase\b/i,
  /\bincluded\s+after\b/i,
  /\bunlock\s+savings\b/i,
  /\belevate\s+your\s+experience\b/i,
  /\btreat\s+yourself\s+to\b/i,
  /\bindulge\s+in\b/i,
  /\blimited[- ]time\s+local\s+offer\b/i,
  /\bdon'?t\s+miss\s+out\b/i,
  /\bact\s+now\b/i,
  /\bexclusive\s+deal\b/i,
  /\bsavor\s+the\s+flavo?r\b/i,
  /\bperfectly\s+paired\b/i,
  /\bAI-generated\b/i,
  /\bthis\s+offer\s+allows\s+you\s+to\b/i,
  /\bcustomers\s+can\s+enjoy\b/i,
  /\bpromotion\s+applies\s+to\b/i,
  /\bterms\s+and\s+conditions\s+apply\b/i,
] as const;

export const AD_COPY_LOCAL_CLICHE_PATTERNS = [
  /\blocal favorite\b/i,
  /\bneighbou?rhood gem\b/i,
  /\bhidden gem\b/i,
  /\bmade with love\b/i,
] as const;

export const AD_COPY_HYPE_WORD_PATTERN =
  /\b(amazing|best|delicious|fantastic|incredible|irresistible|mouthwatering|ultimate)\b/i;

export const AD_COPY_BOGO_SHORTHAND_PATTERNS = [
  /\bb\s*\.?\s*o\s*\.?\s*g\s*\.?\s*o\b/i,
  /\b2\s*[- ]?\s*for\s*[- ]?\s*1\b/i,
  /\btwo\s*[- ]?\s*for\s*[- ]?\s*one\b/i,
  /\b2\s*x\s*1\b/i,
] as const;

export const AD_COPY_CUSTOMER_FACING_FORBIDDEN_PATTERNS = [
  ...AD_COPY_FORBIDDEN_PATTERNS,
  ...AD_COPY_GENERIC_PHRASE_PATTERNS,
  ...AD_COPY_AI_TONE_PATTERNS,
  ...AD_COPY_BOGO_SHORTHAND_PATTERNS,
] as const;

export function matchesAdCopyPattern(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}
