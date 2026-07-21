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

export type StrongDealRejectReason =
  | "conditional"
  | "low_percent"
  | "second_item_discount"
  | "entire_order"
  | "no_strong_language";

/**
 * Structured, already-validated offer facts. When these say the deal is strong, they
 * OUTRANK the prose scan below.
 *
 * R13: without this the guard could only ask whether the *wording* contained a strong-deal
 * phrase, so a genuine 40%-off deal was blocked from publishing because the AI happened to
 * write "for 40% less" instead of "40% off" — and the error told the merchant to fix an
 * offer that was never wrong. Publishing succeeded or failed on the model's choice of
 * synonym. The facts were always available and simply were not consulted.
 */
export type StrongDealStructuredOffer = {
  dealType?: string | null;
  discountPercent?: number | null;
  freeItemQuantity?: number | null;
  freeItemDiscountPercent?: number | null;
};

const FREE_ITEM_DEAL_TYPES = new Set(["BUY_ONE_GET_ONE_FREE", "BUY_ONE_GET_SOMETHING_FREE"]);

function numeric(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Does the structured contract, on its own, describe a strong deal? Returns null when there
 * are no usable structured facts, so the caller falls through to the prose rules unchanged.
 */
export function structuredOfferIsStrong(offer?: StrongDealStructuredOffer | null): boolean | null {
  if (!offer) return null;
  const dealType = typeof offer.dealType === "string" ? offer.dealType.trim().toUpperCase() : "";
  const discountPercent = numeric(offer.discountPercent);
  const freeItemQuantity = numeric(offer.freeItemQuantity);
  const freeItemDiscountPercent = numeric(offer.freeItemDiscountPercent);

  if (FREE_ITEM_DEAL_TYPES.has(dealType)) return true;
  if (freeItemQuantity !== null && freeItemQuantity >= 1 && (freeItemDiscountPercent === null || freeItemDiscountPercent >= 100)) {
    return true;
  }
  if (discountPercent !== null) return discountPercent >= 39.5;
  if (!dealType) return null;
  return null;
}

export function validateStrongDealOnly(input: {
  title: string;
  description?: string | null;
  /** Optional explicit percentage for future percentage-based offer types. */
  discountPercent?: number | null;
  /** Authoritative offer facts. Present at publish; absent for free-text callers. */
  structuredOffer?: StrongDealStructuredOffer | null;
}): { ok: true } | { ok: false; reason: StrongDealRejectReason; message: string } {
  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  const text = `${title}\n${description}`.toLowerCase();
  const structured = structuredOfferIsStrong(
    input.structuredOffer ?? (input.discountPercent != null ? { discountPercent: input.discountPercent } : null),
  );

  // ── 1. FREE ITEM — always pass ──────────────────────────────────────────────
  const hasSecondItemDiscount = SECOND_ITEM_DISCOUNT_PATTERNS.some((p) => p.test(text));
  if (hasSecondItemDiscount) {
    return { ok: false, reason: "second_item_discount", message: STRONG_DEAL_ONLY_MESSAGE };
  }

  const hasEntireOrderDiscount = ENTIRE_ORDER_DISCOUNT_PATTERNS.some((p) => p.test(text));
  if (hasEntireOrderDiscount) {
    return { ok: false, reason: "entire_order", message: STRONG_DEAL_ONLY_MESSAGE };
  }

  // R13: the structured contract is authoritative, so a deal it certifies as strong passes
  // here regardless of how the copy happens to word it. Deliberately placed alongside the
  // prose free-item check rather than above the two shape rejections, so it can only turn a
  // REJECT into a PASS for offers whose own facts already say they qualify — no previously
  // passing offer starts failing, and "buy X + N% off Y" / entire-order shapes still reject.
  // Note this also means a stray low percentage in the prose no longer vetoes a deal the
  // contract says is 40%+, which is exactly the false rejection R13 was about.
  const hasFreeItem = FREE_ITEM_PATTERNS.some((p) => p.test(text));
  if (hasFreeItem || structured === true) return { ok: true };

  // ── 2. CONDITIONAL DISCOUNT — reject when no free item ────────────────────
  const hasConditional = CONDITIONAL_DISCOUNT_PATTERNS.some((p) => p.test(text));
  if (hasConditional) return { ok: false, reason: "conditional", message: STRONG_DEAL_ONLY_MESSAGE };

  // ── 3. PERCENT FLOOR ───────────────────────────────────────────────────────
  if (structured === false) {
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
  // The menu wizard's canonical BOGO summary intentionally uses natural
  // punctuation ("Buy one, get one"). Normalize that comma for the shared
  // strong-language matcher, which otherwise expects whitespace between the
  // two clauses and rejects the wizard's own valid offer.
  const normalizedSummary = s.replace(/\bbuy\s+one\s*,\s*get\s+one\b/gi, "buy one get one");
  return validateStrongDealOnly({
    title: normalizedSummary,
    description: normalizedSummary,
    discountPercent: input.discount_percent ?? null,
  });
}
