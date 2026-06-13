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
};

export const AD_COPY_PROMPT_VERSION = "v3";

export const AD_COPY_JSON_SCHEMA = {
  name: "deal_ad_copy",
  strict: true,
  schema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      short_description: { type: "string" },
      push_notification: { type: "string" },
      terms_summary: { type: "string" },
    },
    required: ["headline", "short_description", "push_notification", "terms_summary"],
    additionalProperties: false,
  },
};

export const COPY_VOICE_RULES = [
  "Write for a local coffee shop, cafe, bakery, or small food business, not a chain restaurant and not a generic image caption.",
  "The job is to write a live, time-limited Twofer/BOGO deal ad for a mobile app.",
  "Use owner-provided deal facts as ground truth. Product/deal terms beat photo context, research context, and generic cafe assumptions.",
  "Clearly mention the actual product or deal item when one is provided.",
  'Clearly explain the BOGO value using direct language such as "BOGO", "2-for-1", "buy one get one", or "<item> free".',
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
  "  - short_description: 1 to 2 sentences. Mention the product, BOGO value, time window, and quantity when available.",
  "  - push_notification: under 90 characters, direct and specific, makes sense on a phone lock screen.",
  "  - terms_summary: plain-language deal terms. Include time, quantity, and redemption limits when available.",
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
    `Write one mobile Twofer deal draft. Output JSON only. Write all output fields in ${languageName(outputLanguage)}.`,
    "",
    ...COPY_VOICE_RULES,
  ].join("\n");

  const userText = [
    "FACTS AVAILABLE TO USE:",
    ...facts.map((fact) => `  - ${fact}`),
    ...revisionBlock,
    "",
    "If a fact is missing, write around it without inventing it. If the product is missing, stay neutral instead of naming a latte, pastry, neighborhood, price, or ingredient.",
  ].join("\n");

  return {
    system,
    userText,
    jsonSchema: AD_COPY_JSON_SCHEMA,
  };
}
