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
  /** One-line register the copy should sound like — replaces the old global "cafe ad" voice. */
  voiceAnchor: string;
  /** Tone/rhythm exemplars only; the live offer's items, numbers, and mechanics always override them. */
  voiceExamples: Array<{ headline: string; description: string }>;
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
    voiceAnchor: "a friendly barista's chalkboard by the register: warm, quick, specific",
    voiceExamples: [
      { headline: "Second latte's on us", description: "Order your usual and hand the free one to your favorite coworker." },
      { headline: "The good-coffee shortcut", description: "One quick stop and 40% off the latte you were already craving." },
    ],
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
    voiceAnchor: "a bright counter sign at the juice bar: casual, fresh-sounding, unforced",
    voiceExamples: [
      { headline: "Midday, upgraded", description: "Grab a smoothie and the second cup is free." },
      { headline: "Cold, quick, yours", description: "40% off one large smoothie, made while you wait." },
    ],
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
    voiceAnchor: "a bakery case card written by the baker: warm, homey, specific",
    voiceExamples: [
      { headline: "Save room this afternoon", description: "Buy one croissant and a second pastry comes along free." },
      { headline: "Boxed and ready to go", description: "40% off one slice of chocolate cake at the counter." },
    ],
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
    voiceAnchor: "a chef's daily special board: appetizing, direct, zero corporate polish",
    voiceExamples: [
      { headline: "Make it birria tonight", description: "One plate, 40% off, no cooking required." },
      { headline: "Lunch worth leaving for", description: "Buy one torta and get the second one free." },
    ],
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
    voiceAnchor: "a chalk sign in the bar's front window: relaxed, social, low-key",
    voiceExamples: [
      { headline: "Meet you there", description: "Buy one draft and your second pour is free." },
      { headline: "Your after-work spot", description: "40% off one appetizer at the bar." },
    ],
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
    voiceAnchor: "a coach's welcome note on the studio door: encouraging, plain, no pressure",
    voiceExamples: [
      { headline: "Start with one class", description: "Book a session and your second visit is free." },
      { headline: "Your reset button", description: "40% off one class pass, no strings attached." },
    ],
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
    voiceAnchor: "a calm card at the spa front desk: soothing, unhurried, simple",
    voiceExamples: [
      { headline: "An hour that's yours", description: "Book a massage and take 30% off one session." },
      { headline: "Overdue, honestly", description: "Book the facial you keep postponing and save 30%." },
    ],
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
    voiceAnchor: "a stylist's note taped to the mirror: fresh, confident, friendly",
    voiceExamples: [
      { headline: "Walk out feeling new", description: "Book a gel manicure and take 30% off one service." },
      { headline: "Bring your sister", description: "Buy one blowout and the second chair is free." },
    ],
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
    voiceAnchor: "a hand-lettered sign at a trusted local counter: plain and helpful",
    voiceExamples: [
      { headline: "Cross it off the list", description: "Book one service visit and take 20% off the job." },
      { headline: "Done by someone local", description: "Buy one service call and get 25% off the work." },
    ],
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
    voiceAnchor: "a groomer's front-desk note: warm, practical, written by a pet person",
    voiceExamples: [
      { headline: "Fresh cut, happy dog", description: "Book a grooming and take 25% off one visit." },
      { headline: "They earned it", description: "Buy one bath and the nail trim is free." },
    ],
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
    voiceAnchor: "a trusted neighborhood mechanic's board out front: plain, confident, no scare tactics",
    voiceExamples: [
      { headline: "One less errand", description: "Book an oil change and take 25% off the bill." },
      { headline: "Your car noticed", description: "Buy one detail and the interior refresh is free." },
    ],
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
    voiceAnchor: "a reliable local contractor's flyer: practical, direct, neighborly",
    voiceExamples: [
      { headline: "One call, one fix", description: "Book the repair visit and save 20% on the job." },
      { headline: "Weekend, reclaimed", description: "Buy one lawn service and the edging is free." },
    ],
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
    voiceAnchor: "a laundromat counter sign: practical, time-saving, friendly",
    voiceExamples: [
      { headline: "Laundry day, canceled", description: "Drop off one load and the second wash is free." },
      { headline: "Come back to it folded", description: "40% off one wash-and-fold order." },
    ],
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
    voiceAnchor: "a plainspoken note from a local pro: clear, calm, trustworthy",
    voiceExamples: [
      { headline: "The first step is easy", description: "Book a consult and take 25% off the first session." },
      { headline: "Ask a real person", description: "Buy one session and the planning review is free." },
    ],
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
    voiceAnchor: "a shopkeeper's shelf tag for a favorite item: specific, inviting, unforced",
    voiceExamples: [
      { headline: "Your new favorite thing", description: "Pick up one candle and the second is free." },
      { headline: "Worth the stop", description: "40% off one of the shop's everyday staples." },
    ],
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
    voiceAnchor: "a florist's handwritten card by the till: warm, giftable, simple",
    voiceExamples: [
      { headline: "Flowers, just because", description: "Pick up one bouquet and a mini bunch is free." },
      { headline: "Make someone's whole week", description: "40% off one arrangement, wrapped to go." },
    ],
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
    voiceAnchor: "a fun local marquee line: playful, social, easy to say yes to",
    voiceExamples: [
      { headline: "Plans: found", description: "Buy one entry and the second ticket is free." },
      { headline: "Better than the couch", description: "Round up the group and take 40% off one admission." },
    ],
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
    voiceAnchor: "a friendly local counter sign: plain words, one clear idea",
    voiceExamples: [
      { headline: "Right down the street", description: "Stop in once and the second one is free." },
      { headline: "Worth knowing about", description: "40% off one item while you look around." },
    ],
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
    `Voice anchor: write like ${playbook.voiceAnchor}.`,
    "Voice examples (tone and rhythm only; the real offer's items, numbers, and mechanics always win):",
    ...playbook.voiceExamples.map(
      (example) => `- Headline "${example.headline}" with description "${example.description}"`,
    ),
    `Positive copy direction: ${playbook.positiveCopyDirection.join("; ")}.`,
    `Natural customer moments: ${playbook.customerMoments.join("; ")}.`,
    `Natural customer language: ${playbook.naturalCustomerLanguage.join("; ")}.`,
    `Avoid: ${playbook.avoid.join("; ")}.`,
    `Visual direction: ${playbook.visualDirection.join("; ")}.`,
  ].join("\n");
}
