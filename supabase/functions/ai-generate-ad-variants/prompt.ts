import type { DealOfferContract } from "../../../lib/deal-offer-contract.ts";

export type BusinessContext = {
  category?: string;
  tone?: string;
  location?: string;
  address?: string;
  description?: string;
};

export type ItemResearch = {
  item_name: string;
  description: string;
  is_familiar: boolean;
};

export type OutputLanguage = "en" | "es" | "ko";

export type PreviousAdCopy = {
  headline: string;
  short_description?: string;
  subheadline?: string;
  push_notification?: string;
  terms_summary?: string;
};

export type DealCopyPromptParams = {
  itemHint: string;
  research: ItemResearch;
  businessName: string;
  businessContext: BusinessContext;
  offerScheduleSummary: string;
  quantityLimit: number | null;
  redemptionLimit: string;
  uploadedImageDescription?: string;
  outputLanguage: OutputLanguage;
  revisionPreset?: string;
  revisionFeedback?: string;
  previousAd?: PreviousAdCopy;
  offerContract?: DealOfferContract;
  validationFeedback?: string;
};

export const AD_COPY_PROMPT_VERSION = "v3";

export const AD_COPY_JSON_SCHEMA = {
  name: "deal_ad_copy",
  strict: true,
  schema: {
    type: "object",
    properties: {
      variants: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            headline: { type: "string" },
            short_description: { type: "string" },
            push_notification: { type: "string" },
            social_caption: { type: "string" },
          },
          required: ["headline", "short_description", "push_notification", "social_caption"],
          additionalProperties: false,
        },
      },
    },
    required: ["variants"],
    additionalProperties: false,
  },
};

export const COPY_VOICE_RULES = [
  "Write for a local coffee shop, cafe, bakery, or small food business, not a chain restaurant and not a generic image caption.",
  "The job is to write a live, time-limited Twofer deal ad for a mobile app.",
  "Use the validated offer contract as ground truth. Owner notes, photo context, research context, and generic cafe assumptions can add flavor but must never change deal terms.",
  "Clearly mention the actual product or deal item when one is provided.",
  "Include the time window when provided.",
  "Include quantity scarcity when provided.",
  "Make the offer feel immediate and live, but do not use fake urgency.",
  "Keep all copy short enough for a mobile app.",
  "Avoid generic marketing language and vague restaurant-promo copy.",
  "Do not invent missing products, prices, neighborhoods, ingredients, preparation methods, awards, discounts, times, or business facts.",
  "Do not over-promise quality, freshness, popularity, health benefits, speed, or availability beyond the facts provided.",
  "No hashtags, emojis, excessive hype, social media-style captions, or exclamation marks.",
  "",
  "BANNED PHRASES:",
  '  - "Don\'t miss out"',
  '  - "Amazing deal"',
  '  - "Delicious treat"',
  '  - "Limited time only" unless paired with the actual time',
  '  - "Come enjoy our special offer"',
  '  - "Treat yourself", "indulge", "best", "ultimate", "perfect", "incredible"',
  "",
  "OUTPUT FIELD RULES:",
  "  - headline: 4 to 8 words, mention the product or moment, no generic hype.",
  "  - short_description: 1 to 2 sentences. Mention the product, the exact deal value, time window, and quantity when available.",
  "  - push_notification: under 85 characters, direct and specific, makes sense on a phone lock screen.",
  "  - social_caption: under 220 characters, plain and shareable.",
  "",
  "EXAMPLES:",
  '  Bad: "Enjoy a delicious treat today with this amazing offer from our business."',
  '  Good: "Midday latte break? Buy one iced vanilla latte and get a fresh blueberry muffin free from 11:30 to 1:00. Only 20 Twofers available."',
  '  Good: "Lunch hour slowdown special: buy one turkey croissant and get one drip coffee free today. Available nearby until 1:00."',
  '  Good: "Afternoon coffee run? Buy one cold brew and get one free for a friend. 15 available today."',
];

function languageName(outputLanguage: OutputLanguage): string {
  if (outputLanguage === "es") return "Spanish";
  if (outputLanguage === "ko") return "Korean";
  return "English";
}

function nonEmpty(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function contractSystemRules(contract: DealOfferContract): string[] {
  return [
    "",
    "NON-NEGOTIABLE DEAL RULES:",
    "1. You must not change the deal mechanics.",
    "2. You must not change what the customer has to buy.",
    "3. You must not change what the customer gets for free or discounted.",
    "4. You must use the exact item names provided in the offer contract.",
    "5. You must not add extra purchase requirements.",
    "6. You must not invent new items, bundles, discounts, or conditions.",
    "7. You must not describe a free reward as something the customer has to buy.",
    "8. You must not describe a single-item discount as a BOGO or free-item deal.",
    "9. You must not mention a deal is valid today unless the contract says it is active today.",
    "10. You must write copy that matches the deal type exactly.",
    "",
    `Deal type: ${contract.dealType}`,
    `Locked offer line: ${contract.canonicalOfferLine}`,
    `Locked terms line: ${contract.canonicalShortTerms}`,
  ];
}

function dealSpecificPrompt(contract: DealOfferContract): string[] {
  const required = contract.requiredPurchase;
  const reward = contract.freeReward;
  const discount = contract.singleItemDiscount;
  const availability = contract.activeWindow?.humanReadable || "Limited-time offer";
  const quantity = contract.quantityLimit?.remaining
    ? `${contract.quantityLimit.remaining} available`
    : "Limited quantities available";

  if (contract.dealType === "BUY_ONE_GET_SOMETHING_FREE" && required && reward) {
    return [
      "",
      "DEAL CONTRACT:",
      "Deal type: BUY_ONE_GET_SOMETHING_FREE",
      `Locked offer line: ${contract.canonicalOfferLine}`,
      `Customer buys ${required.quantity} ${required.itemName}.`,
      `Customer gets ${reward.quantity} ${reward.itemName} free.`,
      "",
      "Important:",
      "- The customer does NOT have to buy the free reward item.",
      `- Do NOT say "Buy ${required.itemName} and ${reward.itemName}."`,
      "- Do NOT say \"Buy both.\"",
      "- Do NOT say \"BOGO.\"",
      "- Do NOT say \"2-for-1.\"",
      "- Do NOT say \"get one free\" without naming the free item.",
      "- Do NOT combine the required item and free item into the purchase.",
      `- Do NOT rewrite this as "Buy ${required.itemName} and ${reward.itemName}, get one free."`,
      "",
      "Good examples:",
      `- "Buy a ${required.itemName}, get a ${reward.itemName} free."`,
      `- "Grab a ${required.itemName} and enjoy a free ${reward.itemName}."`,
      `- "Your ${required.itemName} comes with a free ${reward.itemName}."`,
      "",
      "Bad examples:",
      `- "Buy a ${required.itemName} and ${reward.itemName}, get one free."`,
      `- "BOGO ${required.itemName} and ${reward.itemName}s."`,
      `- "Buy ${required.itemName} + ${reward.itemName} and get one free."`,
      "- \"Buy both and get one free.\"",
      "",
      `Business: ${contract.businessName}`,
      `Location: ${contract.locationName}`,
      `Availability: ${availability}`,
      `Quantity: ${quantity}`,
    ];
  }

  if (contract.dealType === "BUY_ONE_GET_ONE_FREE" && required && reward) {
    return [
      "",
      "DEAL CONTRACT:",
      "Deal type: BUY_ONE_GET_ONE_FREE",
      `Locked offer line: ${contract.canonicalOfferLine}`,
      `Customer buys ${required.quantity} ${required.itemName}.`,
      `Customer gets ${reward.quantity} ${reward.itemName} free.`,
      "",
      "This is a true same-item BOGO free deal.",
      "You may use:",
      "- BOGO",
      "- Buy one, get one free",
      "",
      "Do not change the item.",
      "Do not add a different free reward item.",
      "Do not say the customer has to buy two items.",
      "",
      `Business: ${contract.businessName}`,
      `Location: ${contract.locationName}`,
      `Availability: ${availability}`,
      `Quantity: ${quantity}`,
    ];
  }

  if (contract.dealType === "PERCENT_OFF_SINGLE_ITEM" && discount) {
    return [
      "",
      "DEAL CONTRACT:",
      "Deal type: PERCENT_OFF_SINGLE_ITEM",
      `Locked offer line: ${contract.canonicalOfferLine}`,
      `Customer gets ${discount.discountPercent}% off one ${discount.itemName}.`,
      "",
      "Important:",
      "- This is not a BOGO deal.",
      "- This is not a free-item deal.",
      "- Do not mention \"free.\"",
      "- Do not mention \"buy one get one.\"",
      "- Do not mention \"entire order.\"",
      "- Do not change the discount percentage.",
      `- Do not apply the discount to anything except one ${discount.itemName}.`,
      "",
      `Business: ${contract.businessName}`,
      `Location: ${contract.locationName}`,
      `Availability: ${availability}`,
      `Quantity: ${quantity}`,
    ];
  }

  return [];
}

export function buildAdCopyPrompt(params: DealCopyPromptParams): {
  system: string;
  userText: string;
  jsonSchema: typeof AD_COPY_JSON_SCHEMA;
} {
  const {
    itemHint,
    research,
    businessName,
    businessContext,
    offerScheduleSummary,
    quantityLimit,
    redemptionLimit,
    uploadedImageDescription,
    outputLanguage,
    revisionPreset,
    revisionFeedback,
    previousAd,
    offerContract,
    validationFeedback,
  } = params;

  const facts: string[] = [];
  const cleanBusinessName = nonEmpty(businessName);
  const cleanItemHint = nonEmpty(itemHint);
  const cleanResearchName = nonEmpty(research.item_name);
  const cleanResearchDescription = nonEmpty(research.description);
  const cleanSchedule = nonEmpty(offerScheduleSummary);
  const cleanQuantity =
    typeof quantityLimit === "number" && Number.isFinite(quantityLimit) && quantityLimit > 0
      ? `${Math.floor(quantityLimit)} available`
      : "";
  const cleanRedemptionLimit = nonEmpty(redemptionLimit);
  const cleanImageDescription = nonEmpty(uploadedImageDescription);

  if (cleanBusinessName) facts.push(`Business name: ${cleanBusinessName}`);
  if (businessContext.category) facts.push(`Business category: ${businessContext.category.trim()}`);
  if (businessContext.location) facts.push(`Neighborhood or city: ${businessContext.location.trim()}`);
  if (businessContext.address) facts.push(`Address context: ${businessContext.address.trim()}`);
  if (businessContext.description) facts.push(`Business description: ${businessContext.description.trim()}`);
  if (businessContext.tone) facts.push(`Selected tone, style only: ${businessContext.tone.trim()}`);
  facts.push(`Owner-provided notes and deal terms: ${cleanItemHint || "(not provided)"}`);
  if (cleanResearchName) facts.push(`Product or deal item understood from notes: ${cleanResearchName}`);
  if (cleanResearchDescription) facts.push(`Product description context: ${cleanResearchDescription}`);
  if (cleanSchedule) facts.push(`Time window: ${cleanSchedule}`);
  if (cleanQuantity) facts.push(`Quantity scarcity: ${cleanQuantity}`);
  if (cleanRedemptionLimit) facts.push(`Redemption limit: ${cleanRedemptionLimit}`);
  if (cleanImageDescription) facts.push(`Uploaded image description: ${cleanImageDescription}`);
  if (offerContract) facts.push("Offer contract above overrides owner notes, photo context, and research context.");

  const revisionBlock: string[] = [];
  if (previousAd) {
    revisionBlock.push("");
    revisionBlock.push("REVISION CONTEXT - previous draft:");
    revisionBlock.push(`  Headline: ${previousAd.headline}`);
    revisionBlock.push(`  Short description: ${previousAd.short_description || previousAd.subheadline || ""}`);
    if (previousAd.push_notification) revisionBlock.push(`  Push notification: ${previousAd.push_notification}`);
    if (previousAd.terms_summary) revisionBlock.push(`  Terms summary: ${previousAd.terms_summary}`);
    if (revisionPreset) revisionBlock.push(`Apply this preset adjustment: ${revisionPreset}`);
    if (revisionFeedback) revisionBlock.push(`Apply this user feedback: ${revisionFeedback}`);
    revisionBlock.push("Keep the same offer mechanics. Change wording only where the adjustment requires it.");
  }

  const system = [
    `Write up to three mobile Twofer deal copy variants. Output JSON only. Write all output fields in ${languageName(outputLanguage)}.`,
    "",
    ...COPY_VOICE_RULES,
    ...(offerContract ? contractSystemRules(offerContract) : []),
  ].join("\n");

  const userText = [
    ...(offerContract ? dealSpecificPrompt(offerContract) : []),
    ...(validationFeedback ? ["", "CORRECTIVE FEEDBACK:", validationFeedback] : []),
    "",
    "FACTS AVAILABLE TO USE:",
    ...facts.map((fact) => `  - ${fact}`),
    ...revisionBlock,
    "",
    "If a fact is missing, write around it without inventing it. If the product is missing, stay neutral instead of naming a latte, pastry, neighborhood, price, or ingredient.",
    "",
    "Return this exact JSON shape:",
    '{ "variants": [{ "headline": "string, max 55 characters", "short_description": "string, max 180 characters", "push_notification": "string, max 85 characters", "social_caption": "string, max 220 characters" }] }',
  ].join("\n");

  return {
    system,
    userText,
    jsonSchema: AD_COPY_JSON_SCHEMA,
  };
}
