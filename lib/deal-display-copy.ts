export type DealDisplayTitleFields = {
  title?: string | null;
  title_en?: string | null;
  headline?: string | null;
  customer_title?: string | null;
  ad_headline?: string | null;
  item_name?: string | null;
  itemName?: string | null;
  product_name?: string | null;
  productName?: string | null;
  required_item_description?: string | null;
  requiredItemDescription?: string | null;
  free_item_description?: string | null;
  freeItemDescription?: string | null;
  item_description?: string | null;
  itemDescription?: string | null;
  discount_percent?: number | string | null;
  discountPercent?: number | string | null;
  percent_off?: number | string | null;
  percentOff?: number | string | null;
  size?: string | null;
  item_size?: string | null;
  modifier?: string | null;
  variant?: string | null;
  deal_type?: string | null;
  offer_type?: string | null;
  type?: string | null;
};

const FALLBACK_SAME_ITEM = "Buy one item and get one free";
const FALLBACK_UNKNOWN = "Limited-time local offer";

const CUSTOMER_LOWERCASE_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "bagel",
  "bagels",
  "bakery",
  "before",
  "brew",
  "cake",
  "cold",
  "coffee",
  "coffees",
  "cookie",
  "cookies",
  "croissant",
  "croissants",
  "cup",
  "cups",
  "free",
  "fresh",
  "for",
  "get",
  "hot",
  "iced",
  "item",
  "items",
  "large",
  "latte",
  "lattes",
  "launch",
  "medium",
  "morning",
  "muffin",
  "muffins",
  "noon",
  "off",
  "one",
  "pair",
  "pastry",
  "pastries",
  "second",
  "small",
  "special",
  "tea",
  "today",
  "weekday",
  "with",
]);

const PRESERVE_TITLECASE_WORDS = new Set(["Americano"]);

function present(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value ?? "");
  return normalized ? normalized : null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function firstPresent(values: Array<string | null | undefined>): string {
  for (const value of values) {
    const normalized = present(value);
    if (normalized) return normalized;
  }
  return "";
}

function containsInternalDealLanguage(value: string): boolean {
  return (
    /\bBOGO\b/i.test(value) ||
    /\bSame[-\s]?Item\b/i.test(value) ||
    /\b2\s*[-xX]\s*for\s*[-xX]?\s*1\b/i.test(value) ||
    /\b2\s*x\s*1\b/i.test(value) ||
    /1\s*\+\s*1/.test(value)
  );
}

function containsSameItemLanguage(value: string): boolean {
  return (
    containsInternalDealLanguage(value) ||
    /\b2\s*[- ]?\s*for\s*[- ]?\s*1\b/i.test(value) ||
    /\b2\s*x\s*1\b/i.test(value) ||
    /1\s*\+\s*1/.test(value) ||
    /\btwo\s+for\s+one\b/i.test(value) ||
    /\bbuy\s+one\b.*\bget\s+one\b.*\bfree\b/i.test(value)
  );
}

function knownSameItemOffer(deal: DealDisplayTitleFields, rawTitle: string): boolean {
  const typeText = firstPresent([deal.deal_type, deal.offer_type, deal.type]);
  return /bogo|same[-_\s]?item|buy[-_\s]?one[-_\s]?get[-_\s]?one|2[-_\s]?for[-_\s]?1/i.test(typeText) || containsSameItemLanguage(rawTitle);
}

function stripMechanicalOfferWords(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/\bSame[-\s]?Item\b/gi, " ")
      .replace(/\bBOGO\b/gi, " ")
      .replace(/\b2\s*[- ]?\s*for\s*[- ]?\s*1\b/gi, " ")
      .replace(/\b2\s*x\s*1\b/gi, " ")
      .replace(/1\s*\+\s*1/g, " ")
      .replace(/\btwo\s+for\s+one\b/gi, " ")
      .replace(/^[\s:|/-]+|[\s:|/-]+$/g, " ")
      .replace(/\b\d{10,}\b/g, " "),
  );
}

function extractSameItemFromTitle(rawTitle: string): string | null {
  const withoutPrefix = rawTitle.replace(/\bSame[-\s]?Item\b/gi, " ");
  const bogoPrefix = withoutPrefix.match(/^\s*BOGO\s*:?\s*(.+)$/i)?.[1];
  if (bogoPrefix) return stripMechanicalOfferWords(bogoPrefix);
  const bogoSuffix = withoutPrefix.match(/^(.+?)\s*(?:BOGO|2\s*[- ]?\s*for\s*[- ]?\s*1|two\s+for\s+one)\s*$/i)?.[1];
  if (bogoSuffix) return stripMechanicalOfferWords(bogoSuffix);
  const compactSuffix = withoutPrefix.match(/^(.+?)\s*(?:2\s*x\s*1|1\s*\+\s*1)\s*$/i)?.[1];
  if (compactSuffix) return stripMechanicalOfferWords(compactSuffix);
  return null;
}

function extractWithFreeOfferFromTitle(rawTitle: string): { item: string; freeItem: string } | null {
  const match = normalizeWhitespace(rawTitle).match(/^(.+?)\s+with\s+(?:a\s+|an\s+|one\s+)?free\s+(.+)$/i);
  if (!match?.[1] || !match[2]) return null;
  const item = stripMechanicalOfferWords(match[1]);
  const freeItem = stripMechanicalOfferWords(match[2]);
  return item && freeItem ? { item, freeItem } : null;
}

function normalizeWordCase(word: string, index: number): string {
  if (PRESERVE_TITLECASE_WORDS.has(word)) return word;
  if (word.length <= 1) return word.toLowerCase();
  if (CUSTOMER_LOWERCASE_WORDS.has(word.toLowerCase())) return word.toLowerCase();
  if (index === 0 && /^[A-Z][a-z]+$/.test(word) && !PRESERVE_TITLECASE_WORDS.has(word)) return word.toLowerCase();
  return word;
}

function normalizeNounPhrase(value: string): string {
  let wordIndex = 0;
  return normalizeWhitespace(value).replace(/[A-Za-z][A-Za-z']*/g, (word) => normalizeWordCase(word, wordIndex++));
}

export function toCustomerSentenceCase(value: string): string {
  const text = normalizeWhitespace(value);
  if (!text) return "";
  let wordIndex = 0;
  return text.replace(/[A-Za-z][A-Za-z']*/g, (word, offset) => {
    if (offset === 0) {
      if (word.toUpperCase() === word) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    return normalizeWordCase(word, wordIndex++);
  });
}

function itemNameFromDeal(deal: DealDisplayTitleFields): string | null {
  return present(
    firstPresent([
      deal.item_name,
      deal.itemName,
      deal.item_description,
      deal.itemDescription,
      deal.product_name,
      deal.productName,
      deal.required_item_description,
      deal.requiredItemDescription,
    ]),
  );
}

function freeItemNameFromDeal(deal: DealDisplayTitleFields): string | null {
  return present(firstPresent([deal.free_item_description, deal.freeItemDescription]));
}

function itemModifierFromDeal(deal: DealDisplayTitleFields): string | null {
  return present(firstPresent([deal.size, deal.item_size, deal.modifier, deal.variant]));
}

function buildItemWithModifier(item: string | null, modifier: string | null): string | null {
  if (!item && !modifier) return null;
  if (!item) return null;
  const normalizedItem = normalizeNounPhrase(stripMechanicalOfferWords(item));
  const normalizedModifier = modifier ? normalizeNounPhrase(stripMechanicalOfferWords(modifier)) : "";
  const combined = normalizeWhitespace(`${normalizedModifier} ${normalizedItem}`);
  return combined || null;
}

function isPlainEnglishOfferTitle(value: string): boolean {
  return /\bbuy\b.+\bget\b.+\bfree\b/i.test(value) || /\bget\b.+\bsecond\b.+\bfree\b/i.test(value);
}

function normalizePlainBuyGetTitle(rawTitle: string): string | null {
  const same = normalizeWhitespace(rawTitle).match(/^buy\s+one\s+(.+?)(?:,|\s+and)?\s+get\s+one\s+free\.?$/i);
  if (same?.[1]) {
    return `Buy one ${normalizeNounPhrase(same[1])} and get one free`;
  }
  const different = normalizeWhitespace(rawTitle).match(
    /^buy\s+(?:(?:a|an|one)\s+)?(.+?)(?:,|\s+and)?\s+get\s+(?:(?:a|an|one)\s+)?(.+?)\s+free\.?$/i,
  );
  if (different?.[1] && different[2]) {
    const item = normalizeNounPhrase(different[1]);
    const freeItem = normalizeNounPhrase(different[2]);
    if (normalizeForComparison(item) === normalizeForComparison(freeItem)) {
      return `Buy one ${item} and get one free`;
    }
    return `Buy ${articleFor(item)} ${item} and get a free ${freeItem}`;
  }
  return null;
}

function numericPercent(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value === "string") {
    const n = Number(value.replace(/[%\s]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

function discountPercentFromDeal(deal: DealDisplayTitleFields, rawTitle: string): number | null {
  const explicit = numericPercent(
    firstPresent([
      deal.discount_percent != null ? String(deal.discount_percent) : null,
      deal.discountPercent != null ? String(deal.discountPercent) : null,
      deal.percent_off != null ? String(deal.percent_off) : null,
      deal.percentOff != null ? String(deal.percentOff) : null,
    ]),
  );
  if (explicit != null) return explicit;
  const fromTitle = rawTitle.match(/\b(\d{1,3})\s*%\s*off\b/i)?.[1];
  return fromTitle ? numericPercent(fromTitle) : null;
}

function knownDifferentItemOffer(deal: DealDisplayTitleFields, rawTitle: string): boolean {
  const typeText = firstPresent([deal.deal_type, deal.offer_type, deal.type]);
  return (
    /something[-_\s]?free|different[-_\s]?item|buy[-_\s]?one[-_\s]?get[-_\s]?something/i.test(typeText) ||
    Boolean(freeItemNameFromDeal(deal)) ||
    /\bbuy\s+(?:a|one)\b.+\bget\s+(?:a|one)\b.+\bfree\b/i.test(rawTitle)
  );
}

function knownDiscountOffer(deal: DealDisplayTitleFields, rawTitle: string): boolean {
  const typeText = firstPresent([deal.deal_type, deal.offer_type, deal.type]);
  return /percent|discount|off[-_\s]?single/i.test(typeText) || /\b\d{1,3}\s*%\s*off\b/i.test(rawTitle);
}

function articleFor(nounPhrase: string): "a" | "an" {
  return /^[aeiou]/i.test(nounPhrase.trim()) ? "an" : "a";
}

function normalizeForComparison(value: string): string {
  return stripMechanicalOfferWords(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9%+\s]/g, " ")
    .replace(/\b(?:a|an|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getDealDisplayTitle(deal: DealDisplayTitleFields | null | undefined, preferredTitle?: string | null): string {
  const source = deal ?? {};
  const rawTitle = firstPresent([
    preferredTitle,
    source.customer_title,
    source.headline,
    source.ad_headline,
    source.title_en,
    source.title,
  ]);
  const sameItemOffer = knownSameItemOffer(source, rawTitle);
  const differentItemOffer = knownDifferentItemOffer(source, rawTitle);
  const discountOffer = knownDiscountOffer(source, rawTitle);
  const itemFromTitle = extractSameItemFromTitle(rawTitle);
  const withFreeOffer = extractWithFreeOfferFromTitle(rawTitle);
  const item = buildItemWithModifier(itemNameFromDeal(source) ?? itemFromTitle, itemModifierFromDeal(source));
  const freeItem = freeItemNameFromDeal(source) ? normalizeNounPhrase(stripMechanicalOfferWords(freeItemNameFromDeal(source)!)) : null;
  const discountPercent = discountPercentFromDeal(source, rawTitle);

  const normalizedPlainOffer = normalizePlainBuyGetTitle(rawTitle);
  if (normalizedPlainOffer && !containsInternalDealLanguage(rawTitle)) {
    return normalizedPlainOffer;
  }

  if (isPlainEnglishOfferTitle(rawTitle) && !containsInternalDealLanguage(rawTitle)) {
    return toCustomerSentenceCase(rawTitle);
  }

  if (differentItemOffer && item && freeItem && item !== freeItem) {
    return `Buy ${articleFor(item)} ${item} and get a free ${freeItem}`;
  }

  if (withFreeOffer) {
    const purchase = normalizeNounPhrase(withFreeOffer.item);
    const reward = normalizeNounPhrase(withFreeOffer.freeItem);
    return `Buy ${articleFor(purchase)} ${purchase} and get a free ${reward}`;
  }

  if (sameItemOffer && item) {
    return `Buy one ${item} and get one free`;
  }

  if (sameItemOffer) {
    return FALLBACK_SAME_ITEM;
  }

  if (discountOffer && discountPercent != null && item) {
    return `${discountPercent}% off ${item}`;
  }

  const cleaned = stripMechanicalOfferWords(rawTitle);
  if (!cleaned || containsInternalDealLanguage(cleaned)) return FALLBACK_UNKNOWN;

  return toCustomerSentenceCase(cleaned) || FALLBACK_UNKNOWN;
}

export function getDealDisplayDescription(
  deal: DealDisplayTitleFields | null | undefined,
  preferredDescription?: string | null,
  preferredTitle?: string | null,
): string {
  const description = present(preferredDescription);
  if (!description) return "";

  const title = getDealDisplayTitle(deal, preferredTitle);
  const normalizedTitle = normalizeForComparison(title);
  const normalizedDescription = normalizeForComparison(description);
  const normalizedDescriptionAsTitle = normalizeForComparison(getDealDisplayTitle({ ...(deal ?? {}), title: description }, description));

  if (!normalizedDescription) return "";
  if (normalizedDescription === normalizedTitle) return "";
  if (normalizedDescriptionAsTitle === normalizedTitle) return "";

  return description;
}
