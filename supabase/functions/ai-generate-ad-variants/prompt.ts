import {
  AI_COPY_GENERATOR_VERSION,
  DEAL_COPY_LIMITS,
  buildDeterministicDealChannelCopy,
  normalizeDealFactsFromContract,
  type DealOfferContract,
} from "../../../lib/deal-offer-contract.ts";

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

export const AD_COPY_PROMPT_VERSION = "AI_COPY_PROMPT_V2";

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
            headlineAlternative: { type: "string" },
            description: { type: "string" },
            pushTitle: { type: "string" },
            pushBody: { type: "string" },
            socialCaption: { type: "string" },
          },
          required: ["headlineAlternative", "description", "pushTitle", "pushBody", "socialCaption"],
          additionalProperties: false,
        },
      },
    },
    required: ["variants"],
    additionalProperties: false,
  },
};

export const AI_COPY_PROMPT_V2 = [
  `Generator version: ${AI_COPY_GENERATOR_VERSION}.`,
  "Write customer-facing promotional deal copy for Twofer, a mobile app for local coffee shops, cafes, bakeries, and small food businesses, not a generic image caption.",
  "Use the normalized deal facts and validated offer contract as ground truth. Owner notes, photo context, product research, and tone preferences may guide wording, but they must never change deal facts.",
  "",
  "VOICE:",
  "- Write like a helpful employee explaining the deal to a customer.",
  "- Use clear, everyday American English unless a different output language is requested.",
  "- Prefer active constructions beginning with words such as Buy, Get, Order, Save, or Claim.",
  "- Use sentence case.",
  "- No emojis, all caps, hashtags, markdown, labels, quotation marks, or multiple exclamation marks.",
  "- Do not use exaggerated advertising language.",
  "",
  "FACT SAFETY:",
  "- Preserve every product, quantity, restriction, discount, and supplied price exactly.",
  "- Never invent sizes, prices, ingredients, eligibility, availability, business facts, neighborhoods, popularity, quality claims, or urgency.",
  '- Do not add words such as "delicious", "fresh", "best", or "artisan" unless supplied by the merchant.',
  '- Avoid fragments such as "{item} with free {item}".',
  '- Avoid awkward phrases such as "one coffee free" when "a free coffee" is more natural.',
  "- Do not repeat the merchant name unnecessarily.",
  "- Do not repeat the canonical headline word-for-word in the description.",
  "- Do not include street addresses, city/state/ZIP, raw availability dates, exact times, or inventory counts in generated ad fields unless the channel rule explicitly says that fact was supplied.",
  "- Terms, location, schedule, and quantity are app metadata unless the field rule says to use a supplied fact.",
  "- Do not invent missing products.",
  "- Avoid generic marketing language.",
  "",
  "BANNED PHRASES:",
  '- "Don\'t miss out"',
  '- "Amazing deal"',
  '- "Delicious treat"',
  '- "Come enjoy our special offer"',
  "",
  "FIELD RULES:",
  `- headlineAlternative: complete offer statement, no trailing period, max ${DEAL_COPY_LIMITS.headline} characters. The app normally uses the deterministic canonical headline instead.`,
  `- description: one short supporting sentence, max ${DEAL_COPY_LIMITS.description} characters. Clarify the offer without adding new terms.`,
  `- pushTitle: shorter notification title, max ${DEAL_COPY_LIMITS.pushTitle} characters, understandable without opening the app.`,
  `- pushBody: notification body, max ${DEAL_COPY_LIMITS.pushBody} characters. State the action and reward. Mention timing or limited availability only if supplied in normalized facts.`,
  `- socialCaption: plain share caption, max ${DEAL_COPY_LIMITS.socialCaption} characters.`,
  "",
  "EXAMPLES:",
  "Different-item BOGO:",
  "  Facts: buyQuantity=1, buyItem=egg sandwich, rewardQuantity=1, rewardItem=coffee, rewardType=free.",
  "  Good headlineAlternative: Buy an egg sandwich and get a free coffee",
  "  Bad headlineAlternative: Egg sandwich with free coffee",
  "Same-item BOGO:",
  "  Facts: buyQuantity=1, buyItem=latte, rewardQuantity=1, rewardItem=latte.",
  "  Good headlineAlternative: Buy one latte and get one free",
  "Plural qualifying quantity:",
  "  Facts: buyQuantity=2, buyItem=muffin, rewardQuantity=1, rewardItem=drip coffee.",
  "  Good headlineAlternative: Buy two muffins and get a free drip coffee",
  "Vowel sound:",
  "  Facts: buyQuantity=1, buyItem=apple turnover, rewardQuantity=1, rewardItem=espresso.",
  "  Good headlineAlternative: Buy an apple turnover and get a free espresso",
  "Long product name:",
  "  Keep the full product name. Do not cut a word or replace it with a vague item.",
  "Restricted variant:",
  "  If facts say 12 oz latte only, keep 12 oz latte only. Do not expand to any latte.",
  "Missing optional information:",
  "  If timing, claim limit, price, or size is missing, omit that detail.",
];

export const COPY_VOICE_RULES = AI_COPY_PROMPT_V2;

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
      `- "Buy a ${required.itemName} and get a free ${reward.itemName}"`,
      `- "Order a ${required.itemName} and get a free ${reward.itemName}"`,
      `- "Claim a free ${reward.itemName} with a qualifying ${required.itemName} purchase"`,
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
      `- "Buy one ${required.itemName} and get one free"`,
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
  if (offerContract) {
    const normalizedFacts = normalizeDealFactsFromContract(offerContract);
    const deterministic = buildDeterministicDealChannelCopy(offerContract);
    facts.push(`Normalized deal facts JSON: ${JSON.stringify(normalizedFacts)}`);
    facts.push(`Deterministic canonical headline: ${deterministic.headline}`);
    facts.push(`Deterministic safe description: ${deterministic.description}`);
    facts.push(`Deterministic push title: ${deterministic.pushTitle}`);
    facts.push(`Deterministic push body: ${deterministic.pushBody}`);
  }

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
    '{ "variants": [{ "headlineAlternative": "string", "description": "string", "pushTitle": "string", "pushBody": "string", "socialCaption": "string" }] }',
  ].join("\n");

  return {
    system,
    userText,
    jsonSchema: AD_COPY_JSON_SCHEMA,
  };
}
