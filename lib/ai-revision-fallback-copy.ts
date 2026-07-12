import {
  DEAL_COPY_LIMITS,
  deterministicFallbackCopy,
  validateAiCopyAgainstOffer,
  type AiDealCopyVariant,
  type DealOfferContract,
} from "./deal-offer-contract.ts";

const ITEM_LABEL_STOP_WORDS = new Set([
  "a",
  "an",
  "any",
  "the",
  "one",
  "of",
  "your",
  "choice",
  "large",
  "medium",
  "small",
  "regular",
  "hot",
  "iced",
  "ice",
  "cold",
]);

const KNOWN_ITEM_WORDS = [
  "coffee",
  "latte",
  "espresso",
  "cappuccino",
  "cookie",
  "bagel",
  "sandwich",
  "muffin",
  "croissant",
  "pastry",
  "scone",
  "tea",
  "drink",
  "taco",
  "dessert",
  "entree",
  "pizza",
  "burger",
  "salad",
  "bowl",
  "smoothie",
];

function cleanText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function normalize(value: string | null | undefined): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9%+\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripArticle(value: string): string {
  return cleanText(value).replace(/^(?:a|an|the)\s+/i, "");
}

function lowerFirst(value: string): string {
  const text = cleanText(value);
  if (!text) return "";
  if (/^[A-Z]{2,}\b/.test(text)) return text;
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function capitalizeFirst(value: string): string {
  const text = cleanText(value);
  if (!text) return "";
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function articleFor(value: string): "a" | "an" {
  const text = stripArticle(value);
  if (/^(?:honest|hour|heir|herb)\b/i.test(text)) return "an";
  if (/^(?:uni([^nmd]|$)|user|useful|utensil|u[bcfhjkqrst][a-z])/i.test(text)) return "a";
  return /^[aeiou]/i.test(text) ? "an" : "a";
}

function looksPlural(value: string): boolean {
  const word = stripArticle(value).toLowerCase().match(/[a-z][a-z'-]*$/)?.[0] ?? "";
  return Boolean(word && /s$/.test(word) && !/(?:ss|us)$/.test(word));
}

function pluralizeWord(word: string): string {
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

function pluralizePhrase(value: string): string {
  const text = stripArticle(value);
  const match = text.match(/([A-Za-z][A-Za-z'-]*)([^A-Za-z]*)$/);
  if (!match) return text;
  const [full, word, suffix] = match;
  if (/s$/i.test(word) && !/(?:ss|us)$/i.test(word)) return text;
  return `${text.slice(0, text.length - full.length)}${pluralizeWord(word)}${suffix}`;
}

function compact(value: string, max: number): string {
  const text = cleanText(value);
  if (text.length <= max) return text;
  const clipped = text.slice(0, max + 1);
  const lastSpace = clipped.search(/\s+\S*$/);
  if (lastSpace > Math.max(14, Math.floor(max * 0.65))) return clipped.slice(0, lastSpace).trimEnd();
  return text.slice(0, max).trimEnd();
}

function itemLabel(value: string): string {
  const normalized = normalize(value);
  if (!normalized) return "";
  const words = normalized.split(/\s+/).filter(Boolean);
  const known = KNOWN_ITEM_WORDS.find((word) => words.includes(word));
  if (known && !(known === "drink" && words.includes("coffee"))) return known;
  if (words.includes("coffee")) return "coffee";
  const meaningful = words.filter((word) => !ITEM_LABEL_STOP_WORDS.has(word));
  return meaningful.length > 0 ? meaningful.slice(-2).join(" ") : words.slice(0, 2).join(" ");
}

function purchasePhrase(quantity: number, itemName: string): string {
  const item = cleanText(itemName);
  if (!item) return "the qualifying item";
  if (quantity <= 1) {
    if (/^(?:a|an|the|any|one|1|\d+)\b/i.test(item)) return lowerFirst(item);
    return `${articleFor(item)} ${lowerFirst(stripArticle(item))}`;
  }
  return `${Math.floor(quantity)} ${pluralizePhrase(item)}`;
}

function rewardSubject(quantity: number, itemName: string): string {
  const item = stripArticle(itemName);
  if (!item) return "the reward";
  if (quantity <= 1) return `the ${lowerFirst(item)}`;
  return `${Math.floor(quantity)} ${pluralizePhrase(item)}`;
}

function headlineRewardPhrase(label: string): string {
  const text = lowerFirst(stripArticle(label));
  if (!text) return "reward";
  return looksPlural(text) ? text : `${articleFor(text)} ${text}`;
}

function freeItemCopy(contract: DealOfferContract): {
  buyItem: string;
  rewardItem: string;
  buyQty: number;
  rewardQty: number;
} {
  return {
    buyItem: contract.requiredPurchase?.itemName ?? "item",
    rewardItem: contract.freeReward?.itemName ?? contract.requiredPurchase?.itemName ?? "item",
    buyQty: contract.requiredPurchase?.quantity ?? 1,
    rewardQty: contract.freeReward?.quantity ?? 1,
  };
}

function buildHeadlineCandidates(contract: DealOfferContract, feedback?: string | null): string[] {
  const normalizedFeedback = normalize(feedback);
  const wantsDirect = /\b(?:actual ad|awkward|boring|clear|confusing|direct|doesn t read right|full offer|generic|make sense|natural|plain|read right|reads weird|real ad|simple|sounds off|whole deal|whole offer)\b/.test(normalizedFeedback);
  const wantsWarmer = /\b(?:appetizing|appealing|friendlier|friendly|inviting|less cold|more human|tasty|warmer)\b/.test(normalizedFeedback);

  if (contract.dealType === "PERCENT_OFF_SINGLE_ITEM") {
    const item = contract.singleItemDiscount?.itemName ?? "item";
    const label = itemLabel(item) || item;
    const discount = contract.singleItemDiscount?.discountPercent ?? 40;
    return [
      `${discount}% ${label} savings`,
      `Save ${discount}% on ${label}`,
      `${capitalizeFirst(label)} for less`,
    ];
  }

  const { buyItem, rewardItem } = freeItemCopy(contract);
  const buyLabel = itemLabel(buyItem) || buyItem;
  const rewardLabel = itemLabel(rewardItem) || rewardItem;
  const sameItem = normalize(buyItem) === normalize(rewardItem);

  if (sameItem) {
    return [
      `${capitalizeFirst(buyLabel)} bonus on your order`,
      `Your next ${lowerFirst(buyLabel)} is on us`,
      `${capitalizeFirst(buyLabel)} pair-up bonus`,
    ];
  }

  const reward = headlineRewardPhrase(rewardLabel);
  const core = [
    `${capitalizeFirst(buyLabel)} + ${lowerFirst(rewardLabel)} break`,
    `${capitalizeFirst(rewardLabel)} with your ${lowerFirst(buyLabel)}`,
    `${capitalizeFirst(buyLabel)} comes with ${reward}`,
  ];
  if (wantsWarmer) return [core[2]!, core[0]!, core[1]!];
  if (wantsDirect) return [core[0]!, core[1]!, core[2]!];
  return core;
}

function buildDescription(contract: DealOfferContract): string {
  if (contract.dealType === "PERCENT_OFF_SINGLE_ITEM") {
    const item = contract.singleItemDiscount?.itemName ?? "item";
    const discount = contract.singleItemDiscount?.discountPercent ?? 40;
    return `Save ${discount}% on one ${lowerFirst(stripArticle(item))}.`;
  }

  const { buyItem, rewardItem, buyQty, rewardQty } = freeItemCopy(contract);
  if (normalize(buyItem) === normalize(rewardItem)) {
    return `Buy ${purchasePhrase(buyQty, buyItem)} and the next one is on us.`;
  }
  const reward = rewardSubject(rewardQty, rewardItem);
  return `Buy ${purchasePhrase(buyQty, buyItem)} and ${reward} ${rewardQty > 1 ? "are" : "is"} on us.`;
}

function buildCandidate(contract: DealOfferContract, headline: string): AiDealCopyVariant {
  const description = compact(buildDescription(contract), DEAL_COPY_LIMITS.description);
  const cleanHeadline = compact(headline, DEAL_COPY_LIMITS.headline).replace(/[.!?]+$/g, "");
  const push = compact(`${cleanHeadline}: ${description}`, DEAL_COPY_LIMITS.pushBody);
  return {
    candidate_id: "deterministic_revision_fallback",
    strategy_id: "deterministic_revision",
    strategy_reason: "Guarantees a visible copy change from locked offer facts when AI revision output is unchanged.",
    headline: cleanHeadline,
    short_description: description,
    push_notification: push,
    push_body: push,
    social_caption: compact(`${cleanHeadline}. ${description}`, DEAL_COPY_LIMITS.socialCaption),
  };
}

export function buildDeterministicRevisionFallbackCopy(params: {
  contract: DealOfferContract;
  feedback?: string | null;
  avoidHeadlines?: Array<string | null | undefined>;
}): AiDealCopyVariant {
  const avoided = new Set((params.avoidHeadlines ?? []).map(normalize).filter(Boolean));
  const candidates = buildHeadlineCandidates(params.contract, params.feedback);
  const validCandidates = candidates
    .map((headline) => buildCandidate(params.contract, headline))
    .filter((candidate) => validateAiCopyAgainstOffer(candidate, params.contract).valid);

  const changed = validCandidates.find((candidate) => !avoided.has(normalize(candidate.headline)));
  if (changed) return changed;
  if (validCandidates[0]) return validCandidates[0];

  return {
    ...deterministicFallbackCopy(params.contract),
    candidate_id: "deterministic_revision_fallback",
    strategy_id: "deterministic_revision",
  };
}
