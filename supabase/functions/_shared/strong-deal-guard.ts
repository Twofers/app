export const STRONG_DEAL_ONLY_MESSAGE =
  "Twofer only allows strong deals (40%+ value). Try rephrasing to a clear buy-one-get-one offer.";

const STRONG_LANGUAGE_PATTERNS: RegExp[] = [
  /\bbogo\b/i,
  /\b2\s*[- ]?\s*for\s*1\b/i,
  /\b2\s*for\s*one\b/i,
  /\btwo\s*for\s*one\b/i,
  /\bbuy\s*one\s*get\s*one\b/i,
  /\bbuy\s*1\s*get\s*1\b/i,
  /\bget\s+one\s+free\b/i,
  /\bget\s+1\s+free\b/i,
  /\bsecond\s+item\s+free\b/i,
  /\bsecond\s+one\s+free\b/i,
  /\b2nd\s+item\s+free\b/i,
  /\b40\s*%\s*off\b/i,
  /\b[4-9]\d\s*%\s*off\b/i,
  /\b100\s*%\s*off\b/i,
];

const SECOND_ITEM_DISCOUNT_PATTERNS: RegExp[] = [
  /\bbuy\s+one\s+get\s+one\s+\d{1,3}\s*%\s*off\b/i,
  /\bbuy\s+1\s+get\s+1\s+\d{1,3}\s*%\s*off\b/i,
  /\bsecond\s+(?:item|one|\w+)\s+half\s+off\b/i,
  /\b\d{1,3}\s*%\s*off\s+(?:the\s+)?second\b/i,
  /\bsecond\s+(?:item|one|\w+)\s+\d{1,3}\s*%\s*off\b/i,
];

const ENTIRE_ORDER_DISCOUNT_PATTERNS: RegExp[] = [
  /\b\d{1,3}\s*%\s*off\s+(?:your\s+)?(?:entire|whole)\s+order\b/i,
  /\b\d{1,3}\s*%\s*off\s+(?:everything|all\s+(?:drinks|items|pastries|orders|food))\b/i,
];

function extractPercents(text: string): number[] {
  const values: number[] = [];
  const re = /(\d{1,3})\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 100) values.push(n);
  }
  return values;
}

export function validateStrongDealOnly(input: {
  title: string;
  description?: string | null;
  discountPercent?: number | null;
}): { ok: true } | { ok: false; message: string } {
  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  const text = `${title}\n${description}`.toLowerCase();

  if (SECOND_ITEM_DISCOUNT_PATTERNS.some((p) => p.test(text))) {
    return { ok: false, message: STRONG_DEAL_ONLY_MESSAGE };
  }

  if (ENTIRE_ORDER_DISCOUNT_PATTERNS.some((p) => p.test(text))) {
    return { ok: false, message: STRONG_DEAL_ONLY_MESSAGE };
  }

  if (typeof input.discountPercent === "number" && input.discountPercent < 40) {
    return { ok: false, message: STRONG_DEAL_ONLY_MESSAGE };
  }

  const percents = extractPercents(text);
  if (percents.some((p) => p < 40)) {
    return { ok: false, message: STRONG_DEAL_ONLY_MESSAGE };
  }

  const hasStrongLanguage = STRONG_LANGUAGE_PATTERNS.some((pattern) => pattern.test(text));
  if (!hasStrongLanguage) {
    return { ok: false, message: STRONG_DEAL_ONLY_MESSAGE };
  }

  return { ok: true };
}

/**
 * Detects only POSITIVE weak-deal signals in free text — never the absence of
 * strong language. Unlike validateStrongDealOnly (which requires a strong-language
 * match and therefore rejects any text that doesn't explicitly say "BOGO"/"free"/etc,
 * including a perfectly legitimate free-item offer phrased without that vocabulary),
 * this only flags text that positively describes a weak mechanic: a second-item
 * discount, an entire-order discount, or an explicit sub-40% figure. Additive export;
 * does not change validateStrongDealOnly's behavior or any existing export.
 *
 * Returns a short human-readable reason when a weak signal is found, else null.
 */
export function findWeakDealSignal(text: string): string | null {
  const normalized = (text ?? "").trim().toLowerCase();
  if (!normalized) return null;

  if (SECOND_ITEM_DISCOUNT_PATTERNS.some((p) => p.test(normalized))) {
    return "describes a second-item discount rather than a free item or 40%+ off";
  }

  if (ENTIRE_ORDER_DISCOUNT_PATTERNS.some((p) => p.test(normalized))) {
    return "describes an entire-order discount rather than a free item or 40%+ off";
  }

  const weakPercent = extractPercents(normalized).find((p) => p < 40);
  if (typeof weakPercent === "number") {
    return `${weakPercent}% off is below the 40% strong-deal threshold`;
  }

  return null;
}
