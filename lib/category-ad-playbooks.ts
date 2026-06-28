export type NormalizedAdCategory =
  | "coffee_cafe"
  | "beverage_smoothie"
  | "bakery_dessert"
  | "restaurant_food"
  | "bar_beverage"
  | "fitness_wellness"
  | "spa_massage"
  | "beauty_salon"
  | "local_service"
  | "pet_services"
  | "auto_service"
  | "home_service"
  | "cleaning_laundry"
  | "professional_service"
  | "retail"
  | "florist_gift"
  | "events_entertainment"
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
  beverage_smoothie: {
    normalizedCategory: "beverage_smoothie",
    label: "Juice / smoothie / beverage",
    positiveCopyDirection: [
      "exact drink",
      "routine or refreshment moment",
      "clear reward",
      "simple ordering language",
    ],
    avoid: ["health promises", "detox claims", "invented ingredients", "alcohol-forward language"],
    visualDirection: ["accurate drink count", "realistic cup sizes", "clean counter or pickup context"],
    customerMoments: ["midday refresh", "post-errand stop", "quick drink run", "after-class pickup"],
    naturalCustomerLanguage: ["grab a drink", "pick your usual", "make it a quick stop", "bring a friend"],
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
  bar_beverage: {
    normalizedCategory: "bar_beverage",
    label: "Bar / brewery / beverage venue",
    positiveCopyDirection: [
      "exact item or non-alcoholic option when supplied",
      "casual meetup moment",
      "clear exchange",
      "responsible local tone",
    ],
    avoid: ["drinking-pressure language", "age claims", "intoxication references", "unsupported event claims"],
    visualDirection: ["accurate item or venue context", "no excessive alcohol cues", "realistic table or counter scene"],
    customerMoments: ["after-work meetup", "game-day stop", "date-night start", "low-key hangout"],
    naturalCustomerLanguage: ["meet up", "stop in", "bring a friend", "claim the deal"],
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
  spa_massage: {
    normalizedCategory: "spa_massage",
    label: "Spa / massage",
    positiveCopyDirection: [
      "specific service",
      "appointment moment",
      "relaxation without medical promises",
      "clear value",
    ],
    avoid: ["medical claims", "pain-cure claims", "guaranteed results", "before-and-after language"],
    visualDirection: ["clean treatment area", "calm service context", "no clinical or medical imagery unless supplied"],
    customerMoments: ["appointment reset", "weekend self-care", "post-work unwind", "giftable service"],
    naturalCustomerLanguage: ["book a visit", "take a reset", "save on a service", "try the service"],
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
  pet_services: {
    normalizedCategory: "pet_services",
    label: "Pet services",
    positiveCopyDirection: [
      "specific pet service or item",
      "owner convenience",
      "friendly practical tone",
      "clear appointment or pickup action",
    ],
    avoid: ["veterinary or health claims unless supplied", "breed stereotypes", "guaranteed behavior claims"],
    visualDirection: ["safe pet-service context", "accurate product or service", "no distressed animal imagery"],
    customerMoments: ["grooming appointment", "pet supply run", "weekend care", "regular pet errand"],
    naturalCustomerLanguage: ["book a visit", "pick up pet supplies", "treat your pet", "handle the errand"],
  },
  auto_service: {
    normalizedCategory: "auto_service",
    label: "Auto service",
    positiveCopyDirection: [
      "specific auto service",
      "maintenance moment",
      "straightforward savings",
      "trustworthy practical language",
    ],
    avoid: ["safety guarantees", "certification claims unless supplied", "scare tactics", "fake urgency"],
    visualDirection: ["accurate vehicle or shop context", "realistic tools", "clean service bay or pickup area"],
    customerMoments: ["maintenance stop", "pre-trip check", "weekend errand", "car-care appointment"],
    naturalCustomerLanguage: ["book service", "take care of the car", "stop by the shop", "save on maintenance"],
  },
  home_service: {
    normalizedCategory: "home_service",
    label: "Home service",
    positiveCopyDirection: [
      "specific home task",
      "practical outcome",
      "clear booking action",
      "local reliability without guarantees",
    ],
    avoid: ["licensed or insured claims unless supplied", "permanent-fix guarantees", "alarmist language"],
    visualDirection: ["recognizable home-service context", "accurate tools", "tidy before-service or during-service scene"],
    customerMoments: ["home project", "seasonal upkeep", "needed repair", "weekend to-do"],
    naturalCustomerLanguage: ["book the service", "get the project moving", "handle the repair", "take care of it"],
  },
  cleaning_laundry: {
    normalizedCategory: "cleaning_laundry",
    label: "Cleaning / laundry",
    positiveCopyDirection: [
      "specific cleaning or laundry service",
      "time-saving benefit",
      "clear drop-off or booking action",
      "practical local tone",
    ],
    avoid: ["sterilization claims", "guaranteed stain removal", "health claims", "shaming language"],
    visualDirection: ["clean folded items or service context", "accurate equipment", "no exaggerated before-and-after"],
    customerMoments: ["laundry day", "move-out clean", "weekly reset", "errand pickup"],
    naturalCustomerLanguage: ["drop it off", "book a clean", "save time", "pick it up"],
  },
  professional_service: {
    normalizedCategory: "professional_service",
    label: "Professional service",
    positiveCopyDirection: [
      "specific consultation or service",
      "simple next step",
      "trustworthy direct tone",
      "clear scope without legal or financial promises",
    ],
    avoid: ["outcome guarantees", "legal, tax, or medical advice claims", "credential claims unless supplied"],
    visualDirection: ["professional workspace", "service consultation context", "no private document details"],
    customerMoments: ["first consultation", "planning session", "small-business errand", "help with a task"],
    naturalCustomerLanguage: ["book a consult", "get started", "ask for help", "handle the next step"],
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
  florist_gift: {
    normalizedCategory: "florist_gift",
    label: "Florist / gifts",
    positiveCopyDirection: [
      "exact product or gift category",
      "occasion when supplied",
      "pickup or gifting moment",
      "clear reward",
    ],
    avoid: ["invented occasions", "brand affiliation claims", "freshness claims unless supplied"],
    visualDirection: ["accurate arrangement or gift", "realistic quantity", "shop display or pickup context"],
    customerMoments: ["gift pickup", "thank-you stop", "weekend host gift", "small celebration"],
    naturalCustomerLanguage: ["pick up a gift", "bring something nice", "shop local", "make the stop easy"],
  },
  events_entertainment: {
    normalizedCategory: "events_entertainment",
    label: "Events / entertainment",
    positiveCopyDirection: [
      "specific activity",
      "outing or group moment",
      "clear ticket, entry, or booking action",
      "friendly local tone",
    ],
    avoid: ["invented performers or schedules", "sellout claims", "unsafe or age-restricted claims"],
    visualDirection: ["accurate activity context", "realistic group size", "no fake event signage"],
    customerMoments: ["date night", "family outing", "friends night out", "weekend plan"],
    naturalCustomerLanguage: ["make a plan", "bring a friend", "book a spot", "try something local"],
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
  if (/\b(coffee|cafe|espresso|roaster|roastery)\b/.test(category)) return "coffee_cafe";
  if (/\b(juice|smoothie|boba|tea|drink|beverage|kombucha)\b/.test(category)) return "beverage_smoothie";
  if (/\b(bakery|bake|dessert|pastry|cookie|cake|donut|ice cream|gelato)\b/.test(category)) {
    return "bakery_dessert";
  }
  if (/\b(bar|brewery|brewpub|taproom|wine|cocktail|pub)\b/.test(category)) return "bar_beverage";
  if (/\b(restaurant|food|grill|taco|pizza|burger|sandwich|kitchen|diner|brunch|deli|ramen|sushi|bbq|barbecue|wings|salad)\b/.test(category)) {
    return "restaurant_food";
  }
  if (/\b(fitness|gym|yoga|pilates|wellness|workout|training|class|studio)\b/.test(category)) {
    return "fitness_wellness";
  }
  if (/\b(massage|spa|therapy|bodywork)\b/.test(category)) return "spa_massage";
  if (/\b(salon|beauty|barber|hair|nail|lashes|brow|skin|esthetician|tanning)\b/.test(category)) return "beauty_salon";
  if (/\b(pet|dog|cat|groom|grooming|veterinary|vet)\b/.test(category)) return "pet_services";
  if (/\b(auto|car|vehicle|tire|oil change|mechanic|detailing|car wash)\b/.test(category)) return "auto_service";
  if (/\b(plumb|electric|hvac|landscap|lawn|handyman|home service|home repair|roof|paint)\b/.test(category)) {
    return "home_service";
  }
  if (/\b(cleaning|cleaner|laundry|dry clean|wash and fold|maid)\b/.test(category)) return "cleaning_laundry";
  if (/\b(tax|legal|accounting|bookkeep|consult|tutor|photography|photo studio|professional)\b/.test(category)) {
    return "professional_service";
  }
  if (/\b(florist|flower|gift|plant shop|plants)\b/.test(category)) return "florist_gift";
  if (/\b(event|entertainment|bowling|arcade|theater|theatre|music|escape room|museum|art studio|activity)\b/.test(category)) {
    return "events_entertainment";
  }
  if (/\b(retail|shop|store|boutique|market|apparel|clothing|bookstore|toy|jewelry|home goods)\b/.test(category)) {
    return "retail";
  }
  if (/\b(services?|repairs?)\b/.test(category)) return "local_service";
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
