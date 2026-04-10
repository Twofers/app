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

/**
 * Default English fallback. Callers with i18n access should pass
 * t("dealQuality.strongDealMessage") as the `message` parameter instead.
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
  // Spanish free-item patterns
  /\bgratis\b/i,                        // gratis (free)
  /\bcortesía\b/i,                      // cortesía (complimentary)
  /\bde\s+regalo\b/i,                   // de regalo (as a gift)
  /\binvita\s+la\s+casa\b/i,           // invita la casa (on the house)
  // Korean free-item patterns
  /무료/,                                // 무료 (free)
  /서비스/,                              // 서비스 (service/on the house)
  /공짜/,                                // 공짜 (free/gratis)
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
  /\bget\s+one\s+free\b/i,
  /\bget\s+1\s+free\b/i,
  /\bsecond\s+item\s+free\b/i,
  /\bsecond\s+one\s+free\b/i,
  /\b2nd\s+item\s+free\b/i,
  /\bsecond\s+half\s+off\b/i,
  /\bsecond\s+\w+\s+half\s+off\b/i,
  /\b50\s*%\s*off\s+the\s+second\b/i,
  /\b40\s*%\s*off\b/i,
  /\b[4-9]\d\s*%\s*off\b/i,
  /\b100\s*%\s*off\b/i,
  // Spanish BOGO / strong-deal patterns
  /\bcompra\s+uno?\b.*\bgratis\b/i,                 // compra uno ... gratis
  /\blleva(?:te)?\s+(?:otro|el\s+segundo)\b.*\bgratis\b/i, // llevate otro gratis
  /\b2\s*(?:x|por)\s*1\b/i,                         // 2x1, 2 por 1
  /\bdos\s+por\s+uno\b/i,                           // dos por uno
  /\b[4-9]\d\s*%\s*(?:de\s+)?descuento\b/i,         // 40%+ descuento
  /\bmitad\s+de\s+precio\b/i,                        // mitad de precio (half price)
  /\bel\s+segundo\s+a\s+mitad\b/i,                   // el segundo a mitad
  // Korean BOGO / strong-deal patterns
  /1\s*\+\s*1/,                                      // 1+1
  /\b[4-9]\d\s*%\s*할인/,                             // 40%+ 할인 (discount)
  /하나\s*사면\s*하나/,                                // 하나 사면 하나 (buy one get one)
  /반값/,                                             // 반값 (half price)
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

export type StrongDealRejectReason = "conditional" | "low_percent" | "no_strong_language";

export function validateStrongDealOnly(input: {
  title: string;
  description?: string | null;
  /** Optional explicit percentage for future percentage-based offer types. */
  discountPercent?: number | null;
}): { ok: true } | { ok: false; reason: StrongDealRejectReason; message: string } {
  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  const text = `${title}\n${description}`.toLowerCase();

  // ── 1. FREE ITEM — always pass ──────────────────────────────────────────────
  const hasFreeItem = FREE_ITEM_PATTERNS.some((p) => p.test(text));
  if (hasFreeItem) return { ok: true };

  // ── 2. CONDITIONAL DISCOUNT — reject when no free item ────────────────────
  const hasConditional = CONDITIONAL_DISCOUNT_PATTERNS.some((p) => p.test(text));
  if (hasConditional) return { ok: false, reason: "conditional", message: STRONG_DEAL_ONLY_MESSAGE };

  // ── 3. PERCENT FLOOR ───────────────────────────────────────────────────────
  if (typeof input.discountPercent === "number" && input.discountPercent < 40) {
    return { ok: false, reason: "low_percent", message: STRONG_DEAL_ONLY_MESSAGE };
  }
  const percents = extractPercents(text);
  if (percents.some((p) => p < 40)) {
    return { ok: false, reason: "low_percent", message: STRONG_DEAL_ONLY_MESSAGE };
  }

  // ── 4. STRONG LANGUAGE ────────────────────────────────────────────────────
  const hasStrongLanguage = STRONG_LANGUAGE_PATTERNS.some((pattern) => pattern.test(text));
  if (!hasStrongLanguage) {
    return { ok: false, reason: "no_strong_language", message: STRONG_DEAL_ONLY_MESSAGE };
  }

  return { ok: true };
}

/** Menu wizard canonical line — same rules as publish, without importing StructuredOffer. */
export function validateMenuOfferCanonicalSummary(input: {
  human_summary: string;
  discount_percent?: number | null;
}): ReturnType<typeof validateStrongDealOnly> {
  const s = (input.human_summary ?? "").trim();
  return validateStrongDealOnly({
    title: s,
    description: s,
    discountPercent: input.discount_percent ?? null,
  });
}
