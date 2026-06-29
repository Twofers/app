import {
  AI_COPY_GENERATOR_VERSION,
  DEAL_COPY_LIMITS,
  buildDeterministicDealChannelCopy,
  normalizeDealFactsFromContract,
  type DealOfferContract,
} from "../../../lib/deal-offer-contract.ts";
import { AD_COPY_BANNED_PHRASES } from "../../../lib/ad-language-policy.ts";
import { AD_COPY_STRATEGY_IDS } from "../../../lib/ad-candidate-diversity.ts";
import { buildCategoryAdPlaybookPromptBlock } from "../../../lib/category-ad-playbooks.ts";
import {
  buildMerchantCreativeProfile,
  buildMerchantCreativeProfilePromptBlock,
  type MerchantCreativeProfile,
} from "../../../lib/merchant-creative-profile.ts";
import { buildSourceCreativePolicyPromptBlock } from "../../../lib/ad-source-locale-policy.ts";

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
  poster?: {
    copy?: {
      headline?: string;
      offer_line_1?: string;
      offer_line_2?: string;
      subline?: string;
    } | null;
  } | null;
};

export type CreativeBrief = {
  targetCustomerMoment: string;
  exactCustomerHook: string;
  merchantTruthUsed: string[];
  offerTruthUsed: string[];
  desiredFeeling: string;
  naturalLanguageDirection: string;
  visualStory: string;
  factsNotToInvent: string[];
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
  merchantCreativeProfile?: MerchantCreativeProfile;
  creativeFormat?: "standard_card" | "poster_v1";
};

export const AD_COPY_PROMPT_VERSION = "AI_COPY_PROMPT_V4";

export const AD_COPY_JSON_SCHEMA = {
  name: "deal_ad_copy",
  strict: true,
  schema: {
    type: "object",
    properties: {
      variants: {
        type: "array",
        minItems: 5,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            candidateId: { type: "string" },
            strategyId: { type: "string", enum: [...AD_COPY_STRATEGY_IDS] },
            strategyReason: { type: "string" },
            headlineAlternative: { type: "string" },
            description: { type: "string" },
            pushTitle: { type: "string" },
            pushBody: { type: "string" },
            socialCaption: { type: "string" },
            cta: { type: "string" },
            imageBrief: { type: "string" },
            merchantSpecificContextLimited: { type: "boolean" },
          },
          required: [
            "candidateId",
            "strategyId",
            "strategyReason",
            "headlineAlternative",
            "description",
            "pushTitle",
            "pushBody",
            "socialCaption",
            "cta",
            "imageBrief",
            "merchantSpecificContextLimited",
          ],
          additionalProperties: false,
        },
      },
      creativeBrief: {
        type: "object",
        properties: {
          targetCustomerMoment: { type: "string" },
          exactCustomerHook: { type: "string" },
          merchantTruthUsed: {
            type: "array",
            items: { type: "string" },
          },
          offerTruthUsed: {
            type: "array",
            items: { type: "string" },
          },
          desiredFeeling: { type: "string" },
          naturalLanguageDirection: { type: "string" },
          visualStory: { type: "string" },
          factsNotToInvent: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: [
          "targetCustomerMoment",
          "exactCustomerHook",
          "merchantTruthUsed",
          "offerTruthUsed",
          "desiredFeeling",
          "naturalLanguageDirection",
          "visualStory",
          "factsNotToInvent",
        ],
        additionalProperties: false,
      },
    },
    required: ["creativeBrief", "variants"],
    additionalProperties: false,
  },
};

export const AI_COPY_PROMPT_V4 = [
  `Generator version: ${AI_COPY_GENERATOR_VERSION}.`,
  "Write a polished mobile advertisement for Twofer, a mobile app for local coffee shops, cafes, bakeries, and small food businesses. This is an ad, not a legal deal description or generic image caption.",
  "Use the normalized deal facts and validated offer contract as ground truth. Owner notes, photo context, product research, and tone preferences may guide wording, but they must never change deal facts.",
  "",
  "VOICE:",
  "- Write like a sharp local cafe ad: specific, warm, and easy to scan.",
  "- Use clear, everyday American English unless a different output language is requested.",
  "- Prefer short headlines that feel like real ad hooks. They may be action-led or concept-led, but the body and push copy must make the exact exchange clear.",
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
  "- Owner-provided notes and revision feedback are instructions and context, not draft ad copy. Do not paste merchant text back verbatim unless it is an exact protected product or business name.",
  "- Do not include street addresses, city/state/ZIP, raw availability dates, exact times, or inventory counts in generated ad fields unless the channel rule explicitly says that fact was supplied.",
  "- Terms, location, schedule, and quantity are app metadata unless the field rule says to use a supplied fact.",
  "- Do not invent missing products.",
  "- Avoid generic marketing language.",
  "",
  "BANNED PHRASES:",
  ...AD_COPY_BANNED_PHRASES.map((phrase) => `- "${phrase}"`),
  "",
  "FIELD RULES:",
  "- headlineAlternative: short campaign headline, target 3-9 words, max 55 characters when exact product names allow it, no trailing period. Do not merely echo the owner's typed item name.",
  "- description: short persuasive body line, target 8-18 words, max 110 characters when exact product names allow it. Clarify the offer without adding new terms.",
  `- pushTitle: shorter notification title, max ${DEAL_COPY_LIMITS.pushTitle} characters, understandable without opening the app.`,
  `- pushBody: notification body, max ${DEAL_COPY_LIMITS.pushBody} characters. State the action and reward. Mention timing or limited availability only if supplied in normalized facts.`,
  `- socialCaption: plain share caption, max ${DEAL_COPY_LIMITS.socialCaption} characters.`,
  "- cta: short verb-first action label, max 26 characters.",
  "- imageBrief: short visual idea using only verified offer and merchant facts; no text in image.",
  "- merchantSpecificContextLimited: true only for the merchant_specific lane when verified merchant context is sparse.",
  "- poster-related headline copy, if requested by the app, must be a compact hero concept based on the whole offer. Do not use the full buy/get sentence, do not use a bare product name, and do not start with Try our because the app renders that eyebrow separately.",
  "- For poster ads, good headlineAlternative examples are Coffee + Cookie Break, Latte Pairing, Sandwich + Coffee, Morning Bonus, or Cookie Pairing. Bad poster headlines are Any large coffee drink, Buy any large coffee drink and get a free cookie, Try our latte, or Free cookie with coffee.",
  "- Do not put Twofer, Claim, Redeem, Scan, Tap, Get in app, availability counts, time left, coupon codes, QR instructions, or urgency/scarcity in any poster-oriented wording or image idea.",
  "",
  "CREATIVE STRATEGIES:",
  "- value_clarity: make the exact exchange and benefit understandable immediately.",
  "- social_or_occasion: connect the offer to a natural customer moment, companion, routine, or daypart without inventing facts.",
  "- product_desire: create concrete desire for the real item or service using category-appropriate specificity.",
  "- local_discovery: frame the offer as a reason to discover or revisit a local business using verified place/context facts.",
  "- merchant_specific: use an actual signature item, customer habit, personality, neighborhood truth, or verified differentiator from the Merchant Creative Profile. If that context is limited, stay conservative and set merchantSpecificContextLimited true.",
  "",
  "EXAMPLES:",
  "Different-item BOGO:",
  "  Facts: buyQuantity=1, buyItem=egg sandwich, rewardQuantity=1, rewardItem=coffee, rewardType=free.",
  "  Good headlineAlternative: Egg sandwich + free coffee",
  "  Good description: Grab the sandwich you wanted and the coffee is on us.",
  "  Bad headlineAlternative: Egg sandwich with free coffee",
  "  Bad description: The free coffee is included after the qualifying egg sandwich purchase.",
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

export const COPY_VOICE_RULES = AI_COPY_PROMPT_V4;

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

function protectedTermsForPrompt(input: {
  businessName: string;
  businessContext: BusinessContext;
  offerContract?: DealOfferContract;
}): string[] {
  const values = [
    input.businessName,
    input.businessContext.location,
    input.offerContract?.businessName,
    input.offerContract?.locationName,
    ...(input.offerContract?.requiredPurchase ? [input.offerContract.requiredPurchase.itemName] : []),
    ...(input.offerContract?.freeReward ? [input.offerContract.freeReward.itemName] : []),
    ...(input.offerContract?.singleItemDiscount ? [input.offerContract.singleItemDiscount.itemName] : []),
  ];
  const out: string[] = [];
  for (const raw of values) {
    const clean = nonEmpty(raw);
    if (clean && !out.some((term) => term.toLowerCase() === clean.toLowerCase())) out.push(clean);
  }
  return out;
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
      `- "${required.itemName} + free ${reward.itemName}"`,
      `- "Buy ${required.itemName}, ${reward.itemName} is on us"`,
      "",
      "Bad examples:",
      `- "Buy a ${required.itemName} and ${reward.itemName}, get one free."`,
      `- "BOGO ${required.itemName} and ${reward.itemName}s."`,
      `- "Buy ${required.itemName} + ${reward.itemName} and get one free."`,
      `- "Claim a free ${reward.itemName} with a qualifying ${required.itemName} purchase."`,
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
    businessName,
    businessContext,
    uploadedImageDescription,
    outputLanguage,
    revisionPreset,
    revisionFeedback,
    previousAd,
    offerContract,
    validationFeedback,
    merchantCreativeProfile,
    creativeFormat = "standard_card",
  } = params;

  const facts: string[] = [];
  const cleanItemHint = nonEmpty(itemHint);
  const cleanResearchName = nonEmpty(research.item_name);
  const cleanResearchDescription = nonEmpty(research.description);
  const cleanImageDescription = nonEmpty(uploadedImageDescription);
  const profile = merchantCreativeProfile ?? buildMerchantCreativeProfile({
    businessId: offerContract?.businessId,
    businessName,
    category: businessContext.category,
    tone: businessContext.tone,
    location: businessContext.location,
    address: businessContext.address,
    description: businessContext.description,
    itemHint,
    research,
  });
  const categoryPlaybookBlock = buildCategoryAdPlaybookPromptBlock(businessContext.category);
  const merchantProfileBlock = buildMerchantCreativeProfilePromptBlock(profile);
  const sourceLocalePolicyBlock = buildSourceCreativePolicyPromptBlock({
    appLanguage: outputLanguage,
    protectedTerms: protectedTermsForPrompt({ businessName, businessContext, offerContract }),
  });

  if (businessContext.category) facts.push(`Business category: ${businessContext.category.trim()}`);
  if (businessContext.description) facts.push(`Business description: ${businessContext.description.trim()}`);
  if (businessContext.tone) facts.push(`Selected tone, style only: ${businessContext.tone.trim()}`);
  facts.push(`Requested ad format: ${creativeFormat}`);
  facts.push(`Owner-provided notes, context only, do not paste verbatim: ${cleanItemHint || "(not provided)"}`);
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
    if (previousAd.poster?.copy) {
      revisionBlock.push("  Previous poster copy:");
      revisionBlock.push(`    Poster headline: ${previousAd.poster.copy.headline ?? ""}`);
      revisionBlock.push(`    Poster offer line 1: ${previousAd.poster.copy.offer_line_1 ?? ""}`);
      revisionBlock.push(`    Poster offer line 2: ${previousAd.poster.copy.offer_line_2 ?? ""}`);
      if (previousAd.poster.copy.subline) revisionBlock.push(`    Poster subline: ${previousAd.poster.copy.subline}`);
    }
    if (revisionPreset) revisionBlock.push(`Apply this preset adjustment: ${revisionPreset}`);
    if (revisionFeedback) revisionBlock.push(`Apply this user feedback: ${revisionFeedback}`);
    revisionBlock.push("Treat preset adjustments and user feedback as instructions, not reusable ad wording.");
    revisionBlock.push("Keep the same offer mechanics. The revised copy must be visibly different from the previous draft.");
    revisionBlock.push("Do not reuse the exact previous headline, short description, push notification, or social caption unless the user explicitly asks to undo a change.");
    revisionBlock.push("If the merchant mentions the top part, title, headline, wording, or poster copy, revise headlineAlternative first.");
    revisionBlock.push("If the adjustment is about tone, rewrite the framing and word choice while preserving the exact locked offer facts.");
  }

  const system = [
    `Write one positive creative brief and exactly five mobile Twofer deal copy candidates. Output JSON only. Write all output fields in ${languageName(outputLanguage)}.`,
    "",
    ...COPY_VOICE_RULES,
    "",
    categoryPlaybookBlock,
    "",
    merchantProfileBlock,
    "",
    sourceLocalePolicyBlock,
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
    "Create exactly one candidate for each strategy ID: value_clarity, social_or_occasion, product_desire, local_discovery, merchant_specific.",
    "The creativeBrief must explain the customer moment, exact hook, verified merchant truth used, offer truth used, desired feeling, natural language direction, visual story, and facts not to invent.",
    "If the request is used for a poster ad, keep the visualStory and imageBrief text-free and leave calm space for native centered text overlays.",
    ...(creativeFormat === "poster_v1"
      ? [
          "POSTER FORMAT DIRECTION:",
          "- headlineAlternative is the large top poster headline. Make it a real ad concept from the full offer, not a form-field echo.",
          "- The app will render the exact buy/get mechanics separately, so headlineAlternative should not repeat the full locked offer line.",
          "- If the previous poster headline sounds like a product field, grammar fragment, or owner note, replace it with a compact campaign idea.",
          "- Never output a headlineAlternative that is only the qualifying item, only the reward item, or starts with Try our.",
        ]
      : []),
    "Each candidate must have a different opening idea and a different strategy reason. Avoid paraphrasing the same headline five ways.",
    "",
    "If a fact is missing, write around it without inventing it. If the product is missing, stay neutral instead of naming a latte, pastry, neighborhood, price, or ingredient.",
    "",
    "Return this exact JSON shape:",
    '{ "creativeBrief": { "targetCustomerMoment": "string", "exactCustomerHook": "string", "merchantTruthUsed": ["string"], "offerTruthUsed": ["string"], "desiredFeeling": "string", "naturalLanguageDirection": "string", "visualStory": "string", "factsNotToInvent": ["string"] }, "variants": [{ "candidateId": "string", "strategyId": "value_clarity", "strategyReason": "string", "headlineAlternative": "string", "description": "string", "pushTitle": "string", "pushBody": "string", "socialCaption": "string", "cta": "string", "imageBrief": "string", "merchantSpecificContextLimited": false }] }',
  ].join("\n");

  return {
    system,
    userText,
    jsonSchema: AD_COPY_JSON_SCHEMA,
  };
}
