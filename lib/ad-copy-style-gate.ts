import type { AdSpecV3TextField, AdSpecV3TextProvenance } from "./ad-spec";

export type AdCopyStyleGateReason =
  | "FORBIDDEN_AI_PHRASE"
  | "GENERIC_MARKETING_PHRASE"
  | "AI_TONE_PHRASE"
  | "VAGUE_LOCAL_CLICHE"
  | "HYPE_WITHOUT_SPECIFICITY"
  | "TOO_MANY_EXCLAMATIONS"
  | "EMOJI_IN_AI_COPY";

export type AdCopyStyleGateInput = {
  copy: Partial<Record<AdSpecV3TextField, string>>;
  provenance: Partial<Record<AdSpecV3TextField, AdSpecV3TextProvenance>>;
  requiredSpecificTerms?: string[];
};

export type AdCopyStyleFieldFailure = {
  field: AdSpecV3TextField;
  provenance: AdSpecV3TextProvenance;
  reasons: AdCopyStyleGateReason[];
};

export type AdCopyStyleGateResult = {
  ok: boolean;
  failures: AdCopyStyleFieldFailure[];
  bypassedFields: AdSpecV3TextField[];
};

export type StyleSafeCopyCandidate<TCopy extends Partial<Record<AdSpecV3TextField, string>>> = {
  copy: TCopy;
  provenance: Partial<Record<AdSpecV3TextField, AdSpecV3TextProvenance>>;
};

export type StyleSafeCopySelection<TCopy extends Partial<Record<AdSpecV3TextField, string>>> = {
  copy: TCopy;
  gate: AdCopyStyleGateResult;
  selectedIndex: number | null;
  usedFallback: boolean;
};

const AI_CHECKED_FIELDS: AdSpecV3TextField[] = [
  "displayHook",
  "supportingLine",
  "cta",
  "pushTitle",
  "pushBody",
  "socialCaption",
];

const GENERIC_MARKETING_PATTERNS = [
  /\blimited[- ]time offer\b/i,
  /\blimited[- ]time local offer\b/i,
  /\bdon'?t miss out\b/i,
  /\bact now\b/i,
  /\btreat yourself\b/i,
  /\bspecial deal\b/i,
  /\bexclusive deal\b/i,
  /\bexclusive offer\b/i,
  /\bperfect for (?:any|every|your)\b/i,
];

const AI_TONE_PATTERNS = [
  /\belevate your\b/i,
  /\belevate your experience\b/i,
  /\bunlock (?:a|the|your)\b/i,
  /\bunlock savings\b/i,
  /\bexperience (?:a|an|the) (?:perfect|ultimate|unforgettable)\b/i,
  /\bunforgettable\b.{0,30}\bexperience\b/i,
  /\bsavor (?:the|a|our)\b/i,
  /\bsavor the flavo?r\b/i,
  /\bindulge in\b/i,
  /\bperfectly paired\b/i,
  /\bcrafted to perfection\b/i,
];

const FORBIDDEN_AI_COPY_PATTERNS = [
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
];

const LOCAL_CLICHE_PATTERNS = [
  /\blocal favorite\b/i,
  /\bneighbou?rhood gem\b/i,
  /\bhidden gem\b/i,
  /\bmade with love\b/i,
];

const HYPE_WORD_RE = /\b(amazing|best|delicious|fantastic|incredible|irresistible|mouthwatering|ultimate)\b/i;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function cleanText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTerm(value: string): string {
  return value.trim().toLowerCase();
}

function hasSpecificTerm(text: string, requiredSpecificTerms: string[] | undefined): boolean {
  const lower = text.toLowerCase();
  const terms = (requiredSpecificTerms ?? []).map(normalizeTerm).filter((term) => term.length >= 3);
  return terms.length === 0 || terms.some((term) => lower.includes(term));
}

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function shouldBypassStyleGate(provenance: AdSpecV3TextProvenance): boolean {
  return provenance === "merchant_typed" || provenance === "merchant_edited";
}

function reasonsForField(text: string, requiredSpecificTerms: string[] | undefined): AdCopyStyleGateReason[] {
  const reasons: AdCopyStyleGateReason[] = [];
  if (!text) return reasons;
  if (hasAnyPattern(text, FORBIDDEN_AI_COPY_PATTERNS)) reasons.push("FORBIDDEN_AI_PHRASE");
  if (hasAnyPattern(text, GENERIC_MARKETING_PATTERNS)) reasons.push("GENERIC_MARKETING_PHRASE");
  if (hasAnyPattern(text, AI_TONE_PATTERNS)) reasons.push("AI_TONE_PHRASE");
  if (hasAnyPattern(text, LOCAL_CLICHE_PATTERNS)) reasons.push("VAGUE_LOCAL_CLICHE");
  if (HYPE_WORD_RE.test(text) && !hasSpecificTerm(text, requiredSpecificTerms)) {
    reasons.push("HYPE_WITHOUT_SPECIFICITY");
  }
  if ((text.match(/!/g) ?? []).length > 1) reasons.push("TOO_MANY_EXCLAMATIONS");
  if (EMOJI_RE.test(text)) reasons.push("EMOJI_IN_AI_COPY");
  return reasons;
}

export function evaluateAdCopyStyleGate(input: AdCopyStyleGateInput): AdCopyStyleGateResult {
  const failures: AdCopyStyleFieldFailure[] = [];
  const bypassedFields: AdSpecV3TextField[] = [];

  for (const field of AI_CHECKED_FIELDS) {
    const provenance = input.provenance[field] ?? "ai_generated";
    if (shouldBypassStyleGate(provenance)) {
      bypassedFields.push(field);
      continue;
    }

    const reasons = reasonsForField(cleanText(input.copy[field]), input.requiredSpecificTerms);
    if (reasons.length > 0) {
      failures.push({ field, provenance, reasons });
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    bypassedFields,
  };
}

export function selectStyleSafeCopyCandidate<TCopy extends Partial<Record<AdSpecV3TextField, string>>>(
  candidates: Array<StyleSafeCopyCandidate<TCopy>>,
  deterministicFallback: StyleSafeCopyCandidate<TCopy>,
  requiredSpecificTerms?: string[],
): StyleSafeCopySelection<TCopy> {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const gate = evaluateAdCopyStyleGate({
      copy: candidate.copy,
      provenance: candidate.provenance,
      requiredSpecificTerms,
    });
    if (gate.ok) {
      return { copy: candidate.copy, gate, selectedIndex: index, usedFallback: false };
    }
  }

  const fallbackGate = evaluateAdCopyStyleGate({
    copy: deterministicFallback.copy,
    provenance: deterministicFallback.provenance,
    requiredSpecificTerms,
  });
  return { copy: deterministicFallback.copy, gate: fallbackGate, selectedIndex: null, usedFallback: true };
}
