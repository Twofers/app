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
  size?: string | null;
  item_size?: string | null;
  modifier?: string | null;
  variant?: string | null;
  deal_type?: string | null;
  offer_type?: string | null;
  type?: string | null;
};

const FALLBACK_SAME_ITEM = "Buy one item, get one free";
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
  return /\bBOGO\b/i.test(value) || /\bSame[-\s]?Item\b/i.test(value);
}

function containsSameItemLanguage(value: string): boolean {
  return (
    containsInternalDealLanguage(value) ||
    /\b2\s*[- ]?\s*for\s*[- ]?\s*1\b/i.test(value) ||
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
  return null;
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
      deal.product_name,
      deal.productName,
      deal.required_item_description,
      deal.requiredItemDescription,
    ]),
  );
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
  const itemFromTitle = extractSameItemFromTitle(rawTitle);
  const item = buildItemWithModifier(itemNameFromDeal(source) ?? itemFromTitle, itemModifierFromDeal(source));

  if (isPlainEnglishOfferTitle(rawTitle) && !containsInternalDealLanguage(rawTitle)) {
    return toCustomerSentenceCase(rawTitle);
  }

  if (sameItemOffer && item) {
    return `Buy one ${item}, get one free`;
  }

  if (sameItemOffer) {
    return FALLBACK_SAME_ITEM;
  }

  const cleaned = stripMechanicalOfferWords(rawTitle);
  if (!cleaned || containsInternalDealLanguage(cleaned)) return FALLBACK_UNKNOWN;

  return toCustomerSentenceCase(cleaned) || FALLBACK_UNKNOWN;
}
