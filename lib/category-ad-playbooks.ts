export type NormalizedAdCategory =
  | "coffee_cafe"
  | "bakery_dessert"
  | "restaurant_food"
  | "fitness_wellness"
  | "beauty_salon"
  | "local_service"
  | "retail"
  | "general_local_business";

export type CategoryAdPlaybook = {
  normalizedCategory: NormalizedAdCategory;
  label: string;
  positiveCopyDirection: string[];
  avoid: string[];
  visualDirection: string[];
  customerMoments: string[];
  naturalCustomerLanguage: string[];
};

const PLAYBOOKS: Record<NormalizedAdCategory, CategoryAdPlaybook> = {
  coffee_cafe: {
    normalizedCategory: "coffee_cafe",
    label: "Coffee / cafe",
    positiveCopyDirection: [
      "daypart and routine",
      "exact drink or food pairing",
      "social coffee moment",
      "clear exchange first",
    ],
    avoid: [
      "vague luxury language",
      "unsupported freshness claims",
      "excessive sensory adjectives",
    ],
    visualDirection: [
      "accurate item count",
      "natural light",
      "believable cafe context",
    ],
    customerMoments: ["morning coffee run", "breakfast stop", "afternoon break", "study or work pause"],
    naturalCustomerLanguage: ["coffee run", "grab breakfast", "bring a friend", "make it a quick stop"],
  },
  bakery_dessert: {
    normalizedCategory: "bakery_dessert",
    label: "Bakery / dessert",
    positiveCopyDirection: [
      "exact pastry or dessert",
      "sharing moment",
      "texture only when supported by the item",
      "clear reward",
    ],
    avoid: ["guilt language", "unsupported ingredients", "best-in-town claims"],
    visualDirection: ["close detail", "realistic portions", "accurate pastry count"],
    customerMoments: ["bakery case stop", "after-lunch treat", "coffee pairing", "sharing a box"],
    naturalCustomerLanguage: ["pick up", "share one", "bakery case", "pair it with coffee"],
  },
  restaurant_food: {
    normalizedCategory: "restaurant_food",
    label: "Restaurant / food",
    positiveCopyDirection: [
      "exact dish",
      "meal moment",
      "clear action and reward",
      "specific appetite appeal without invented ingredients",
    ],
    avoid: ["invented ingredients", "oversized portions", "best in town"],
    visualDirection: ["real dish identity", "realistic serving size", "no unrelated sides"],
    customerMoments: ["lunch run", "easy dinner", "table for two", "quick bite"],
    naturalCustomerLanguage: ["order one", "make it lunch", "bring someone", "grab a bite"],
  },
  fitness_wellness: {
    normalizedCategory: "fitness_wellness",
    label: "Fitness / wellness",
    positiveCopyDirection: [
      "attainable experience",
      "clear use case",
      "welcoming tone",
      "specific service or session",
    ],
    avoid: ["medical promises", "body or weight-loss guarantees", "before-and-after claims"],
    visualDirection: ["inclusive setting", "realistic environment", "accurate equipment"],
    customerMoments: ["first visit", "after-work class", "weekend reset", "routine check-in"],
    naturalCustomerLanguage: ["try a session", "book a class", "bring your routine", "start simple"],
  },
  beauty_salon: {
    normalizedCategory: "beauty_salon",
    label: "Beauty / salon",
    positiveCopyDirection: [
      "clear service",
      "verified experience",
      "appointment moment",
      "believable outcome language",
    ],
    avoid: ["impossible before/after claims", "medical claims", "guaranteed results"],
    visualDirection: ["polished service context", "believable result", "clean treatment area"],
    customerMoments: ["appointment refresh", "weekend prep", "self-care slot", "quick service"],
    naturalCustomerLanguage: ["book a visit", "freshen up", "save on a service", "try the service"],
  },
  local_service: {
    normalizedCategory: "local_service",
    label: "Local service",
    positiveCopyDirection: [
      "practical result",
      "clear service delivered",
      "trustworthy direct language",
      "specific customer need",
    ],
    avoid: ["fake urgency", "unsupported guarantees", "claims about certification unless supplied"],
    visualDirection: ["recognizable service context", "trustworthy composition", "accurate tools"],
    customerMoments: ["weekend errand", "home project", "needed fix", "regular maintenance"],
    naturalCustomerLanguage: ["get it done", "book the service", "take care of it", "local help"],
  },
  retail: {
    normalizedCategory: "retail",
    label: "Retail",
    positiveCopyDirection: [
      "exact product",
      "practical use",
      "discovery",
      "clear price or discount only when supplied",
    ],
    avoid: ["fake inventory", "brand affiliation claims", "unsupported rarity"],
    visualDirection: ["accurate product identity", "accurate quantity", "real shelf or display context"],
    customerMoments: ["shopping stop", "gift pickup", "try something useful", "browse and save"],
    naturalCustomerLanguage: ["pick up", "try one", "find a favorite", "shop local"],
  },
  general_local_business: {
    normalizedCategory: "general_local_business",
    label: "General local business",
    positiveCopyDirection: [
      "specific offer clarity",
      "plain customer action",
      "local-business warmth",
      "one idea per candidate",
    ],
    avoid: ["generic hype", "unsupported claims", "fake urgency"],
    visualDirection: ["accurate product or service", "realistic local context", "no extra offer text"],
    customerMoments: ["nearby stop", "repeat visit", "quick errand", "local discovery"],
    naturalCustomerLanguage: ["stop by", "claim the deal", "try it", "visit local"],
  },
};

function cleanCategory(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeAdCategory(value: string | null | undefined): NormalizedAdCategory {
  const category = cleanCategory(value);
  if (!category) return "general_local_business";
  if (/\b(coffee|cafe|espresso|tea|boba|juice|smoothie)\b/.test(category)) return "coffee_cafe";
  if (/\b(bakery|bake|dessert|pastry|cookie|cake|donut|ice cream|gelato)\b/.test(category)) {
    return "bakery_dessert";
  }
  if (/\b(restaurant|food|grill|bar|taco|pizza|burger|sandwich|kitchen|diner)\b/.test(category)) {
    return "restaurant_food";
  }
  if (/\b(fitness|gym|yoga|pilates|wellness|massage|spa|therapy)\b/.test(category)) {
    return "fitness_wellness";
  }
  if (/\b(salon|beauty|barber|hair|nail|lashes|brow|skin)\b/.test(category)) return "beauty_salon";
  if (/\b(service|repair|cleaning|auto|plumb|electric|pet|laundry)\b/.test(category)) return "local_service";
  if (/\b(retail|shop|store|boutique|market|florist|gift|apparel)\b/.test(category)) return "retail";
  return "general_local_business";
}

export function getCategoryAdPlaybook(category: string | null | undefined): CategoryAdPlaybook {
  return PLAYBOOKS[normalizeAdCategory(category)];
}

export function buildCategoryAdPlaybookPromptBlock(category: string | null | undefined): string {
  const playbook = getCategoryAdPlaybook(category);
  return [
    "CATEGORY PLAYBOOK:",
    `Normalized category: ${playbook.normalizedCategory} (${playbook.label}).`,
    `Positive copy direction: ${playbook.positiveCopyDirection.join("; ")}.`,
    `Natural customer moments: ${playbook.customerMoments.join("; ")}.`,
    `Natural customer language: ${playbook.naturalCustomerLanguage.join("; ")}.`,
    `Avoid: ${playbook.avoid.join("; ")}.`,
    `Visual direction: ${playbook.visualDirection.join("; ")}.`,
  ].join("\n");
}
