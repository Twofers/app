/**
 * Client-side mirror of the Postgres `is_strong_deal_offer` guardrail.
 * Keep this logic in sync with the SQL trigger.
 *
 * Rules (in priority order):
 *  1. FREE ITEM  — anything where something is given free → PASS
 *  2. CONDITIONAL DISCOUNT — "buy X + N% off Y" style (discount requires a purchase
 *     of a different item, and the reward is NOT free) → REJECT
 *  3. PERCENT FLOOR — any explicit percentage < 40 that isn't part of a free-item
 *     offer → REJECT
 *  4. STRONG LANGUAGE — explicit BOGO / 2-for-1 / 40%+ off language → PASS
 *  5. Otherwise → REJECT
 */

export const STRONG_DEAL_ONLY_MESSAGE =
  "Every Twofer deal must be at least 40% off or give something free — " +
  'e.g. "Buy a coffee, get a muffin free" or "2-for-1 lattes". ' +
  'Conditional deals like "buy X + 40% off Y" don\'t qualify.';

// ── 1. FREE ITEM ─────────────────────────────────────────────────────────────
// "free" preceded by whitespace or start-of-string (excludes "sugar-free",
// "dairy-free" etc. where the hyphen sits right before the word).
const FREE_ITEM_PATTERNS: RegExp[] = [
  // "free" preceded by whitespace or start-of-string, followed by a word boundary.
  // This excludes "sugar-free", "dairy-free" (hyphen before free, no space).
  /(?:^|\s)free\b/i,
  /\bon\s+the\s+house\b/i,   // on the house
  /\bcomplimentary\b/i,      // complimentary [item]
];

// ── 2. CONDITIONAL DISCOUNT ───────────────────────────────────────────────────
// "buy X + N% off Y" — the discount is contingent on buying something else
// and the reward is not free.  The "+" notation is the canonical signal.
const CONDITIONAL_DISCOUNT_PATTERNS: RegExp[] = [
  /buy\s+\S.{0,60}\s*\+\s*\d{1,3}\s*%\s*off/i,
];

// ── 4. STRONG LANGUAGE ────────────────────────────────────────────────────────
const STRONG_LANGUAGE_PATTERNS: RegExp[] = [
  /\bbogo\b/i,
  /\b2\s*[- ]?\s*for\s*[- ]?\s*1\b/i,  // 2-for-1, 2 for 1, 2for1
  /\b2\s*for\s*one\b/i,
  /\btwo\s*for\s*one\b/i,
  /\bbuy\s*one\s*get\s*one\b/i,
  /\bbuy\s*1\s*get\s*1\b/i,
  /\bsecond\s+item\s+free\b/i,
  /\bsecond\s+one\s+free\b/i,
  /\b2nd\s+item\s+free\b/i,
  /\bsecond\s+half\s+off\b/i,
  /\bsecond\s+\w+\s+half\s+off\b/i,
  /\b50\s*%\s*off\s+the\s+second\b/i,
  /\b40\s*%\s*off\b/i,
  /\b[4-9]\d\s*%\s*off\b/i,
  /\b100\s*%\s*off\b/i,
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
  /** Optional explicit percentage for future percentage-based offer types. */
  discountPercent?: number | null;
}): { ok: true } | { ok: false; message: string } {
  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  const text = `${title}\n${description}`.toLowerCase();

  // ── 1. FREE ITEM — always pass ──────────────────────────────────────────────
  const hasFreeItem = FREE_ITEM_PATTERNS.some((p) => p.test(text));
  if (hasFreeItem) return { ok: true };

  // ── 2. CONDITIONAL DISCOUNT — reject when no free item ────────────────────
  const hasConditional = CONDITIONAL_DISCOUNT_PATTERNS.some((p) => p.test(text));
  if (hasConditional) return { ok: false, message: STRONG_DEAL_ONLY_MESSAGE };

  // ── 3. PERCENT FLOOR ───────────────────────────────────────────────────────
  if (typeof input.discountPercent === "number" && input.discountPercent < 40) {
    return { ok: false, message: STRONG_DEAL_ONLY_MESSAGE };
  }
  const percents = extractPercents(text);
  if (percents.some((p) => p < 40)) {
    return { ok: false, message: STRONG_DEAL_ONLY_MESSAGE };
  }

  // ── 4. STRONG LANGUAGE ────────────────────────────────────────────────────
  const hasStrongLanguage = STRONG_LANGUAGE_PATTERNS.some((pattern) => pattern.test(text));
  if (!hasStrongLanguage) {
    return { ok: false, message: STRONG_DEAL_ONLY_MESSAGE };
  }

  return { ok: true };
}
