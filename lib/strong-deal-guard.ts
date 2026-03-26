export const STRONG_DEAL_ONLY_MESSAGE =
  "Twofer only allows strong deals (40%+ value). Try rephrasing to a clear BOGO.";

const STRONG_LANGUAGE_PATTERNS: RegExp[] = [
  /\bbogo\b/i,
  /\b2\s*[- ]?\s*for\s*1\b/i,
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
