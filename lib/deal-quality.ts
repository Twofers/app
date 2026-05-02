/**
 * Publish-time deal quality (MVP).
 * Heuristic rules on title + description + optional price — no margin math.
 * Tune constants below; see docs/deal-quality-mvp.md.
 */

export type DealQualityTier = "strong" | "acceptable" | "weak";

export type DealQualityInput = {
  title: string;
  /** Full listing body (composed description) or null for quick deals */
  description?: string | null;
  /** Deal price field when set */
  price?: number | null;
};

/** Machine-readable reason for i18n (`dealQuality.blocks.*`). */
export type DealQualityBlockReason =
  | "TITLE_SHORT"
  | "MULTI_PERCENT"
  | "BELOW_THRESHOLD"
  | "CLARIFY_VALUE";

export type DealQualityResult = {
  tier: DealQualityTier;
  /** When true, block publish and show `message` */
  blocked: boolean;
  /** Use with i18n for ES/KO; English `message` remains for regression tests. */
  blockReason: DealQualityBlockReason | null;
  message: string;
  /** Optional nudge when published as acceptable (not shown by default in UI) */
  improvementTip?: string;
};

/** Any stated percentage discount must be at least this to qualify (MVP). */
export const DEAL_QUALITY_MIN_PERCENT = 40;

/** Default bar — high-value offer types. */
export const DEAL_QUALITY_BLOCK_MESSAGE =
  "TWOFER only allows high-value deals. Try 40%+ off, BOGO, 2-for-1, or a stronger bundle.";

/** More than one distinct % when no clear structural primary offer (BOGO / 2-for-1 / etc.). */
export const DEAL_QUALITY_MULTIPLE_PERCENT_MESSAGE =
  "This deal lists more than one discount percentage and the main offer isn’t clear. Simplify to one headline (40%+ off, BOGO, 2-for-1, or buy-2-get-1), or trim extra % lines from the fine print when your main offer is already one of those.";

/** Unclear bundle / free wording — how to fix. */
export const DEAL_QUALITY_CLARIFY_VALUE_MESSAGE =
  "Make the customer value obvious: name a strong free item (free drink, free side, or free dessert with purchase), or spell out a clear bundle (items + one price, e.g. “2 for $10” or “$8 lunch: 2 slices + drink”).";

const END_OF_DAY_PATTERNS: RegExp[] = [
  /\bend\s+of\s+day\b/i,
  /\bfinal\s+del\s+d[ií]a\b/i,
  /\boferta\s+del\s+final\s+del\s+d[ií]a\b/i,
  /\bfin\s+del\s+d[ií]a\b/i,
];

const CLEARANCE_PATTERNS: RegExp[] = [
  /\bclearance\b/i,
  /\bliquidaci[oó]n\b/i,
  /\bremate\b/i,
];

/**
 * Phrases where a real free item is obvious (aligned with strong-deal guard free-item
 * signals, but excluding bare “free surprise” / “free item” vagueness — those stay weak).
 */
const CLEAR_FREE_ITEM_PHRASE_PATTERNS: RegExp[] = [
  /\bget\s+a\s+free\b/i,
  /\bon\s+the\s+house\b/i,
  /\bcomplimentary\b/i,
  /\bbuy\s+[^,\n]{1,120},\s*get\s+a\s+free\b/i,
];

/** Meaningful free add-ons only (EN + ES). No generic “free thing with purchase”. */
const MEANINGFUL_FREE_PATTERNS: RegExp[] = [
  /\bfree\s+drink\s+with\b/i,
  /\bfree\s+side\s+with\b/i,
  /\bfree\s+dessert\s+with\b/i,
  /\bfree\s+second\s+(item\s+)?with\b/i,
  /\bfree\s+2nd\s+with\b/i,
  /\bsecond\s+item\s+free\b/i,
  /\bbebida\s+gratis\s+con\s+(la\s+)?compra\b/i,
  /\bacompa[nñ]amiento\s+gratis\s+con\s+(la\s+)?compra\b/i,
  /\bpostre\s+gratis\s+con\s+(la\s+)?compra\b/i,
  /\bsegundo\s+(art[ií]culo\s+)?gratis\b/i,
  /\b2[º°]\s+gratis\b/i,
];

/** BOGO, 2-for-1, b2g1, half-price, second 50%, dozen-style (EN + ES). */
const CORE_STRONG_PATTERNS: RegExp[] = [
  /\bbogo\b/i,
  /\bbuy\s*one\s*get\s*one\b/i,
  /\bbuy\s*1\s*get\s*1\b/i,
  /** BOGO shorthand; covers "…get one free" when "buy one get one" is missing (e.g. typo "buy on"). */
  /\bget\s+one\s+free\b/i,
  /\bget\s+1\s+free\b/i,
  /\b2\s*[- ]?\s*for\s*1\b/i,
  /\btwo\s*for\s*one\b/i,
  /\bhalf\s+off\b/i,
  /\b50\s*%\s*off\b/i,
  /\b50\s*percent\b/i,
  /\bbuy\s*2\s*,?\s*get\s*1\b/i,
  /\bbuy\s*two\s*,?\s*get\s*one\b/i,
  /\bsecond\s+\w*\s*half\s+off\b/i,
  /\bsecond\s+half\s+off\b/i,
  /\bsecond\s+(item\s+)?50\s*%/i,
  /\b2nd\s+(item\s+)?50\s*%/i,
  /\b50\s*%\s*off\s+(the\s+)?second\b/i,
  /\bmixed\s+dozen\b/i,
  /\bdozen\s+for\b/i,
  /\bcompra\s+uno\s+y\s+ll[eé]vate\s+otro\s+gratis\b/i,
  /\bcompra\s+1\s+y\s+ll[eé]vate\s+1\s+gratis\b/i,
  /\b2\s*por\s*1\b/i,
  /\b2x1\b/i,
  /\bcompra\s+2\s+y\s+ll[eé]vate\s+1\s+gratis\b/i,
  /\bmitad\s+de\s+precio\b/i,
  /\bsegundo\s+a\s+mitad\s+de\s+precio\b/i,
  /\bsegundo\s+al\s+50\s*%/i,
  /\b50\s*%\s+en\s+el\s+segundo\b/i,
];

/** Core Korean retail/deal phrases (MVP). */
const KOREAN_DEAL_PATTERNS: RegExp[] = [
  /1\s*\+\s*1/i,
  /원플원/,
  /투\s*포\s*원/,
  /2\s*개\s*사면\s*1/i,
  /하나\s*더\s*무료/,
  /두\s*번째\s*반값/,
  /두\s*번째\s*50\s*%/,
  /50\s*%\s*할인/,
  /\d{1,3}\s*%\s*할인/,
  /증정\s*음료/,
  /무료\s*음료/,
  /마감\s*할인/,
  /타임세일/,
];

/** Localized phrases that imply a strong percentage discount — skip the numeric floor check. */
const LOCALIZED_PERCENT_STRONG_PATTERNS: RegExp[] = [
  /\b\d{1,3}\s*%\s*de?\s*descuento\b/i,
  /\b\d{1,3}\s*%\s*할인\b/,
];

const STRONG_OFFER_PATTERNS: RegExp[] = [
  ...CORE_STRONG_PATTERNS,
  ...CLEAR_FREE_ITEM_PHRASE_PATTERNS,
  ...MEANINGFUL_FREE_PATTERNS,
  ...KOREAN_DEAL_PATTERNS,
];

/**
 * Headline offers that may coexist with other % mentions in fine print.
 * Excludes whole-deal “half off” / generic “50% off” / “mitad de precio” so two competing
 * headline percents still trip the multi-% rule.
 */
const STRUCTURAL_PRIMARY_PATTERNS: RegExp[] = [
  ...MEANINGFUL_FREE_PATTERNS,
  ...CLEAR_FREE_ITEM_PHRASE_PATTERNS,
  /\bbogo\b/i,
  /\bbuy\s*one\s*get\s*one\b/i,
  /\bbuy\s*1\s*get\s*1\b/i,
  /\bget\s+one\s+free\b/i,
  /\bget\s+1\s+free\b/i,
  /\b2\s*[- ]?\s*for\s*1\b/i,
  /\btwo\s*for\s*one\b/i,
  /\bbuy\s*2\s*,?\s*get\s*1\b/i,
  /\bbuy\s*two\s*,?\s*get\s*one\b/i,
  /\bsecond\s+\w*\s*half\s+off\b/i,
  /\bsecond\s+half\s+off\b/i,
  /\bsecond\s+(item\s+)?50\s*%/i,
  /\b2nd\s+(item\s+)?50\s*%/i,
  /\b50\s*%\s*off\s+(the\s+)?second\b/i,
  /\bmixed\s+dozen\b/i,
  /\bdozen\s+for\b/i,
  /\bcompra\s+uno\s+y\s+ll[eé]vate\s+otro\s+gratis\b/i,
  /\bcompra\s+1\s+y\s+ll[eé]vate\s+1\s+gratis\b/i,
  /\b2\s*por\s*1\b/i,
  /\b2x1\b/i,
  /\bcompra\s+2\s+y\s+ll[eé]vate\s+1\s+gratis\b/i,
  /\bsegundo\s+a\s+mitad\s+de\s+precio\b/i,
  /\bsegundo\s+al\s+50\s*%/i,
  /\b50\s*%\s+en\s+el\s+segundo\b/i,
  /1\s*\+\s*1/i,
  /원플원/,
  /투\s*포\s*원/,
  /2\s*개\s*사면\s*1/i,
  /하나\s*더\s*무료/,
  /두\s*번째\s*반값/,
  /두\s*번째\s*50\s*%/,
  /증정\s*음료/,
  /무료\s*음료/,
];

/** Obvious bundle / stack pricing (EN + ES). Keep small — see docs for copy tips. */
const BUNDLE_AND_FIXED_PRICE_PATTERNS: RegExp[] = [
  /\$\s*\d+(\.\d{2})?\s*(lunch|combo|special|deal|slice|drink)/i,
  /\b(two|2)\s+(slices?|tacos?|drinks?)\b.*\$\s*\d+/i,
  /\$\s*\d+(\.\d{2})?\s*(for|and)\s*(two|2|a)/i,
  /\b(2|two)\s+for\s*\$\s*\d+/i,
  /\bdinner\s+for\s+two\s+for\s*(\$\s*)?\d+/i,
  /\b2\s+por\s*(\$\s*)?\d+/i,
  /\bdos\s+por\s*(\$\s*)?\d+/i,
  /\bcena\s+para\s+dos\s+por\s*(\$\s*)?\d+/i,
];

function normalizeText(input: DealQualityInput): string {
  const t = (input.title ?? "").trim();
  const d = (input.description ?? "").trim();
  return `${t}\n${d}`.toLowerCase();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/** Numeric % only: `40%` or `40 percent` (digits). No spelled-out numbers (EN/ES). */
function extractPercents(text: string): number[] {
  const out: number[] = [];
  const rePercent = /(\d{1,3})\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = rePercent.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 100) out.push(n);
  }
  const reWord = /(\d{1,3})\s*percent(?:age)?/g;
  while ((m = reWord.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 100) out.push(n);
  }
  return out;
}

function uniquePercentValues(text: string): number[] {
  const all = extractPercents(text);
  return [...new Set(all)].sort((a, b) => a - b);
}

function combinedLength(input: DealQualityInput): number {
  return (input.title ?? "").trim().length + (input.description ?? "").trim().length;
}

/**
 * Value signal for end-of-day / clearance only: strong offer, bundle/fixed phrasing,
 * or a single clear headline discount ≥ 40%. No bare $ amounts or listing price alone.
 */
function hasContextualValueForEodOrClearance(text: string): boolean {
  const unique = uniquePercentValues(text);
  if (unique.length === 1 && unique[0] >= DEAL_QUALITY_MIN_PERCENT) return true;
  if (matchesAny(text, STRONG_OFFER_PATTERNS)) return true;
  if (matchesAny(text, BUNDLE_AND_FIXED_PRICE_PATTERNS)) return true;
  return false;
}

/**
 * Assess whether a deal is strong enough for the Twofer marketplace.
 * Weak deals are blocked; strong vs acceptable is stored for future ranking/notifications.
 */
export function assessDealQuality(input: DealQualityInput): DealQualityResult {
  const title = (input.title ?? "").trim();
  if (title.length < 8) {
    return {
      tier: "weak",
      blocked: true,
      blockReason: "TITLE_SHORT",
      message: `Your title is too short to show the value. ${DEAL_QUALITY_BLOCK_MESSAGE}`,
    };
  }

  const text = normalizeText(input);
  const uniquePercents = uniquePercentValues(text);

  if (
    uniquePercents.length > 1 &&
    !matchesAny(text, STRUCTURAL_PRIMARY_PATTERNS)
  ) {
    return {
      tier: "weak",
      blocked: true,
      blockReason: "MULTI_PERCENT",
      message: DEAL_QUALITY_MULTIPLE_PERCENT_MESSAGE,
    };
  }

  if (matchesAny(text, STRONG_OFFER_PATTERNS)) {
    return { tier: "strong", blocked: false, blockReason: null, message: "" };
  }

  if (matchesAny(text, END_OF_DAY_PATTERNS) && hasContextualValueForEodOrClearance(text)) {
    return { tier: "strong", blocked: false, blockReason: null, message: "" };
  }

  if (matchesAny(text, CLEARANCE_PATTERNS) && hasContextualValueForEodOrClearance(text)) {
    return { tier: "strong", blocked: false, blockReason: null, message: "" };
  }

  const singlePercent = uniquePercents.length === 1 ? uniquePercents[0] : null;

  if (singlePercent != null && singlePercent < DEAL_QUALITY_MIN_PERCENT) {
    if (matchesAny(text, LOCALIZED_PERCENT_STRONG_PATTERNS)) {
      return { tier: "acceptable", blocked: false, blockReason: null, message: "" };
    }
    return {
      tier: "weak",
      blocked: true,
      blockReason: "BELOW_THRESHOLD",
      message: DEAL_QUALITY_BLOCK_MESSAGE,
    };
  }

  if (singlePercent != null && singlePercent >= DEAL_QUALITY_MIN_PERCENT) {
    return {
      tier: "acceptable",
      blocked: false,
      blockReason: null,
      message: "",
      improvementTip:
        "BOGO, 2-for-1, and clear bundles often rank higher than percent-off alone when you add those later.",
    };
  }

  if (matchesAny(text, BUNDLE_AND_FIXED_PRICE_PATTERNS)) {
    return { tier: "acceptable", blocked: false, blockReason: null, message: "" };
  }

  const len = combinedLength(input);
  if (len < 14) {
    return {
      tier: "weak",
      blocked: true,
      blockReason: "CLARIFY_VALUE",
      message: DEAL_QUALITY_CLARIFY_VALUE_MESSAGE,
    };
  }

  return {
    tier: "weak",
    blocked: true,
    blockReason: "CLARIFY_VALUE",
    message: DEAL_QUALITY_CLARIFY_VALUE_MESSAGE,
  };
}
