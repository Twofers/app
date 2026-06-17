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
  "Do not include street addresses, city/state/ZIP, availability dates, exact times, or inventory counts in the generated ad copy. The app shows those as separate metadata.",
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
  "  - headline: 4 to 8 words, plain-English offer title, mention the product or moment, no generic hype.",
  '  - Never write "Same-Item" or "BOGO" in generated user-visible fields.',
  '  - For same-item buy-one-get-one offers, prefer "Buy one [item], get one free."',
  "  - short_description: 1 sentence. Mention the product and exact deal value only.",
  "  - push_notification: under 85 characters, direct and specific, makes sense on a phone lock screen.",
  "  - social_caption: under 220 characters, plain and shareable.",
  "",
  "EXAMPLES:",
  '  Bad: "Enjoy a delicious treat today with this amazing offer from our business."',
  '  Bad: "Buy one bagel and get one coffee free at 9460 N MacArthur Blvd. Available 6/16/2026 to 6/23/2026. 50 available."',
  '  Good: "Buy any bagel, get one coffee free."',
  '  Good: "Buy one turkey croissant and get one drip coffee free."',
  '  Good: "Buy one cold brew and get one cold brew free."',
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
    "Terms, location, schedule, and quantity are app metadata. Do not include them in generated output fields.",
  ];
}

function dealSpecificPrompt(contract: DealOfferContract): string[] {
  const required = contract.requiredPurchase;
  const reward = contract.freeReward;
  const discount = contract.singleItemDiscount;

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
      "Do not include business name, address, availability, or quantity in the generated output fields.",
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
      "This is a true same-item buy-one-get-one free deal.",
      "Use plain English such as:",
      `- "Buy one ${required.itemName}, get one free."`,
      `- "Get a second ${required.itemName} free."`,
      "",
      "Do not use:",
      "- BOGO",
      "- Same-Item",
      "",
      "Do not change the item.",
      "Do not add a different free reward item.",
      "Do not say the customer has to buy two items.",
      "",
      "Do not include business name, address, availability, or quantity in the generated output fields.",
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
      "Do not include business name, address, availability, or quantity in the generated output fields.",
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
    businessContext,
    uploadedImageDescription,
    outputLanguage,
    revisionPreset,
    revisionFeedback,
    previousAd,
    offerContract,
    validationFeedback,
  } = params;

  const facts: string[] = [];
  const cleanItemHint = nonEmpty(itemHint);
  const cleanResearchName = nonEmpty(research.item_name);
  const cleanResearchDescription = nonEmpty(research.description);
  const cleanImageDescription = nonEmpty(uploadedImageDescription);

  if (businessContext.category) facts.push(`Business category: ${businessContext.category.trim()}`);
  if (businessContext.description) facts.push(`Business description: ${businessContext.description.trim()}`);
  if (businessContext.tone) facts.push(`Selected tone, style only: ${businessContext.tone.trim()}`);
  facts.push(`Owner-provided notes and deal terms: ${cleanItemHint || "(not provided)"}`);
  if (cleanResearchName) facts.push(`Product or deal item understood from notes: ${cleanResearchName}`);
  if (cleanResearchDescription) facts.push(`Product description context: ${cleanResearchDescription}`);
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
