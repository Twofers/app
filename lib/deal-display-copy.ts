export type DealDisplayTitleFields = {
  locked_offer_line?: string | null;
  lockedOfferLine?: string | null;
  locked_terms_line?: string | null;
  lockedTermsLine?: string | null;
  canonical_offer_sentence?: string | null;
  canonicalOfferSentence?: string | null;
  disclosure_line?: string | null;
  disclosureLine?: string | null;
  ad_spec?: unknown;
  adSpec?: unknown;
  offer_version?: DealDisplayOfferVersionFields | DealDisplayOfferVersionFields[] | null;
  offer_versions?: DealDisplayOfferVersionFields | DealDisplayOfferVersionFields[] | null;
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
  required_purchase_quantity?: number | string | null;
  requiredPurchaseQuantity?: number | string | null;
  free_item_quantity?: number | string | null;
  freeItemQuantity?: number | string | null;
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

type DealDisplayOfferVersionFields = {
  canonical_offer_sentence?: string | null;
  canonicalOfferSentence?: string | null;
  disclosure_line?: string | null;
  disclosureLine?: string | null;
  ad_spec?: unknown;
  adSpec?: unknown;
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textAtPath(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    const currentRecord = record(current);
    if (!currentRecord) return null;
    current = currentRecord[key];
  }
  return typeof current === "string" ? present(current) : null;
}

function firstOfferVersion(source: DealDisplayTitleFields): DealDisplayOfferVersionFields | null {
  const value = source.offer_version ?? source.offer_versions;
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object" ? candidate : null;
}

function adSpecFromDeal(source: DealDisplayTitleFields): unknown {
  return source.ad_spec ?? source.adSpec ?? firstOfferVersion(source)?.ad_spec ?? firstOfferVersion(source)?.adSpec ?? null;
}

function lockedOfferLineFromDeal(source: DealDisplayTitleFields): string | null {
  const version = firstOfferVersion(source);
  const adSpec = adSpecFromDeal(source);
  return present(
    firstPresent([
      source.locked_offer_line,
      source.lockedOfferLine,
      source.canonical_offer_sentence,
      source.canonicalOfferSentence,
      version?.canonical_offer_sentence,
      version?.canonicalOfferSentence,
      textAtPath(adSpec, ["terms", "lockedOfferLine"]),
      textAtPath(adSpec, ["creative", "offerLine"]),
      textAtPath(adSpec, ["offer", "canonicalOfferSentence"]),
    ]),
  );
}

function lockedTermsLineFromDeal(source: DealDisplayTitleFields): string | null {
  const version = firstOfferVersion(source);
  const adSpec = adSpecFromDeal(source);
  return present(
    firstPresent([
      source.locked_terms_line,
      source.lockedTermsLine,
      source.disclosure_line,
      source.disclosureLine,
      version?.disclosure_line,
      version?.disclosureLine,
      textAtPath(adSpec, ["terms", "summary"]),
      textAtPath(adSpec, ["offer", "disclosureLine"]),
    ]),
  );
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
    return `Buy ${formatPurchasePhrase(1, item)} and get ${formatFreeRewardPhrase(1, freeItem)}`;
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

function positiveQuantity(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[$,%\s]/g, ""))
        : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

const SMALL_NUMBER_WORDS: Record<number, string> = {
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
};

const QUANTITY_PREFIXES = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "single",
  "double",
  "triple",
  "half-dozen",
  "half dozen",
  "dozen",
];

function numberWord(value: number): string {
  return SMALL_NUMBER_WORDS[value] ?? String(value);
}

function stripLeadingArticle(value: string): string {
  return normalizeWhitespace(value).replace(/^(?:a|an|the)\s+/i, "");
}

function lowerFirst(value: string): string {
  const clean = normalizeWhitespace(value);
  if (!clean) return "";
  if (/^[A-Z]{2,}\b/.test(clean)) return clean;
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(clean)) return clean;
  return `${clean.charAt(0).toLowerCase()}${clean.slice(1)}`;
}

function startsWithDeterminer(value: string): boolean {
  return /^(?:a|an|any|the)\s+/i.test(normalizeWhitespace(value));
}

function startsWithQuantityPhrase(value: string): boolean {
  const clean = normalizeWhitespace(value).toLowerCase();
  if (!clean) return false;
  if (/^\d+\s*[-]?\s*(?:pack|ct|count|piece|pc|dozen)\b/.test(clean)) return true;
  return QUANTITY_PREFIXES.some((prefix) => clean === prefix || clean.startsWith(`${prefix} `) || clean.startsWith(`${prefix}-`));
}

function pluralizeWord(word: string): string {
  if (!word) return word;
  if (/[^A-Za-z]$/.test(word)) return word;
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/fe$/i.test(word)) return `${word.slice(0, -2)}ves`;
  if (/f$/i.test(word)) return `${word.slice(0, -1)}ves`;
  return `${word}s`;
}

function pluralizeItemPhrase(itemName: string): string {
  const clean = stripLeadingArticle(itemName);
  const match = clean.match(/([A-Za-z][A-Za-z'-]*)([^A-Za-z]*)$/);
  if (!match) return clean;
  const [full, word, suffix] = match;
  if (/s$/i.test(word) && !/(?:ss|us)$/i.test(word)) return clean;
  return `${clean.slice(0, clean.length - full.length)}${pluralizeWord(word)}${suffix}`;
}

function singularizeWord(word: string): string {
  if (/ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|zes|ses)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/(?:ss|us)$/i.test(word)) return word.slice(0, -1);
  return word;
}

function singularizeItemPhrase(itemName: string): string {
  const clean = stripLeadingArticle(itemName);
  const match = clean.match(/([A-Za-z][A-Za-z'-]*)([^A-Za-z]*)$/);
  if (!match) return clean;
  const [full, word, suffix] = match;
  return `${clean.slice(0, clean.length - full.length)}${singularizeWord(word)}${suffix}`;
}

function looksPluralLike(itemName: string): boolean {
  const clean = stripLeadingArticle(itemName).toLowerCase();
  const lastWord = clean.match(/[a-z][a-z'-]*$/)?.[0] ?? "";
  return Boolean(lastWord && /s$/.test(lastWord) && !/(?:ss|us)$/.test(lastWord));
}

function formatPurchasePhrase(quantity: number, itemName: string): string {
  const item = normalizeNounPhrase(stripMechanicalOfferWords(itemName));
  if (!item) return "";
  if (quantity === 1) {
    if (startsWithDeterminer(item) || startsWithQuantityPhrase(item)) return lowerFirst(item);
    return `${articleFor(item)} ${lowerFirst(item)}`;
  }
  return `${numberWord(quantity)} ${pluralizeItemPhrase(item)}`;
}

function formatCountedItem(quantity: number, itemName: string): string {
  const item = normalizeNounPhrase(stripMechanicalOfferWords(stripLeadingArticle(itemName)));
  if (!item) return "";
  if (quantity === 1) {
    if (startsWithQuantityPhrase(item)) return lowerFirst(item);
    return `one ${lowerFirst(item)}`;
  }
  return `${numberWord(quantity)} ${pluralizeItemPhrase(item)}`;
}

function formatFreeRewardPhrase(quantity: number, itemName: string): string {
  const item = normalizeNounPhrase(stripMechanicalOfferWords(itemName));
  if (!item) return "";
  if (quantity === 1) {
    if (startsWithDeterminer(item) || startsWithQuantityPhrase(item)) return `${lowerFirst(item)} free`;
    if (looksPluralLike(item)) return `free ${lowerFirst(stripLeadingArticle(item))}`;
    return `a free ${lowerFirst(item)}`;
  }
  return `${numberWord(quantity)} free ${pluralizeItemPhrase(item)}`;
}

function formatDiscountItemPhrase(itemName: string): string {
  const item = normalizeNounPhrase(stripMechanicalOfferWords(itemName));
  if (!item) return "item";
  if (startsWithDeterminer(item) || startsWithQuantityPhrase(item)) return lowerFirst(item);
  return `one ${lowerFirst(singularizeItemPhrase(item))}`;
}

function structuredOfferTitle(source: DealDisplayTitleFields): string | null {
  const typeText = firstPresent([source.deal_type, source.offer_type, source.type]);
  const item = buildItemWithModifier(itemNameFromDeal(source), itemModifierFromDeal(source));
  const freeItem = freeItemNameFromDeal(source);
  const discountPercent = discountPercentFromDeal(source, "");

  if (/percent|discount|off[-_\s]?single/i.test(typeText) && discountPercent != null && item) {
    return `Get ${discountPercent}% off ${formatDiscountItemPhrase(item)}`;
  }

  const isDifferentItem = /something[-_\s]?free|different[-_\s]?item|buy[-_\s]?one[-_\s]?get[-_\s]?something/i.test(typeText);
  const isSameItem = /bogo|same[-_\s]?item|buy[-_\s]?one[-_\s]?get[-_\s]?one|2[-_\s]?for[-_\s]?1/i.test(typeText);
  if (!item || (!isSameItem && !isDifferentItem)) return null;

  const requiredQuantity = positiveQuantity(firstPresent([
    source.required_purchase_quantity != null ? String(source.required_purchase_quantity) : null,
    source.requiredPurchaseQuantity != null ? String(source.requiredPurchaseQuantity) : null,
  ]));
  const rewardQuantity = positiveQuantity(firstPresent([
    source.free_item_quantity != null ? String(source.free_item_quantity) : null,
    source.freeItemQuantity != null ? String(source.freeItemQuantity) : null,
  ]));
  const rewardItem = isDifferentItem && freeItem ? freeItem : item;

  if (normalizeForComparison(item) === normalizeForComparison(rewardItem)) {
    const rewardPhrase = rewardQuantity === 1 ? "one free" : `${numberWord(rewardQuantity)} free`;
    return `Buy ${formatCountedItem(requiredQuantity, item)} and get ${rewardPhrase}`;
  }

  return `Buy ${formatPurchasePhrase(requiredQuantity, item)} and get ${formatFreeRewardPhrase(rewardQuantity, rewardItem)}`;
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
  const clean = stripLeadingArticle(nounPhrase).trim();
  if (!clean) return "a";
  if (/^(?:honest|hour|heir|herb)\b/i.test(clean)) return "an";
  if (/^(?:uni([^nmd]|$)|user|useful|utensil|u[bcfhjkqrst][a-z])/i.test(clean)) return "a";
  return /^[aeiou]/i.test(clean) ? "an" : "a";
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
  const lockedOfferLine = lockedOfferLineFromDeal(source);
  if (lockedOfferLine) return lockedOfferLine;
  const structuredTitle = structuredOfferTitle(source);
  if (structuredTitle) return structuredTitle;
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
    return `Buy ${formatPurchasePhrase(1, item)} and get ${formatFreeRewardPhrase(1, freeItem)}`;
  }

  if (withFreeOffer) {
    const purchase = normalizeNounPhrase(withFreeOffer.item);
    const reward = normalizeNounPhrase(withFreeOffer.freeItem);
    return `Buy ${formatPurchasePhrase(1, purchase)} and get ${formatFreeRewardPhrase(1, reward)}`;
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
  const source = deal ?? {};
  const lockedTermsLine = present(lockedTermsLineFromDeal(source));
  const description = lockedTermsLine ?? present(preferredDescription);
  if (!description) return "";

  const title = getDealDisplayTitle(source, preferredTitle);
  const normalizedTitle = normalizeForComparison(title);
  const normalizedDescription = normalizeForComparison(description);

  if (lockedTermsLine) {
    return normalizedDescription && normalizedDescription !== normalizedTitle ? description : "";
  }

  const normalizedDescriptionAsTitle = normalizeForComparison(getDealDisplayTitle({ ...(deal ?? {}), title: description }, description));

  if (!normalizedDescription) return "";
  if (normalizedDescription === normalizedTitle) return "";
  if (normalizedDescriptionAsTitle === normalizedTitle) return "";

  return description;
}
