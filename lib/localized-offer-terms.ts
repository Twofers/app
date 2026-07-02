import { type SupportedLocale } from "./supported-locales.ts";

export type LocalizedOfferTermSource =
  | "merchant"
  | "merchant_profile"
  | "reviewed_dictionary"
  | "ai_suggested"
  | "system";

export type LocalizedOfferTermVerificationStatus =
  | "verified"
  | "needs_native_review"
  | "blocked";

export type LocalizedOfferTerm = {
  entityId: string;
  locale: SupportedLocale;
  displayName: string;
  shortDisplayName?: string;
  unitLabelSingular?: string;
  unitLabelPlural?: string;
  koreanCounterId?: string;
  doNotTranslate: boolean;
  approvedLocalizedName: boolean;
  source: LocalizedOfferTermSource;
  verificationStatus: LocalizedOfferTermVerificationStatus;
  version: string;
};

export type ResolveLocalizedOfferTermParams = {
  entityId?: string | null;
  sourceDisplayName: string;
  locale: SupportedLocale;
  providedTerms?: readonly LocalizedOfferTerm[] | null;
  doNotTranslateTerms?: readonly string[] | null;
};

export const PRESERVED_MERCHANT_TERM_VERSION = "preserved-merchant-term-v1";
export const GENERIC_LOCALIZED_TERM_DICTIONARY_VERSION = "generic-localized-term-dictionary-v1";

type GenericLocalizedTermDictionaryEntry = Partial<Record<SupportedLocale, {
  displayName: string;
  koreanCounterId?: string;
}>>;

const GENERIC_LOCALIZED_TERM_DICTIONARY: Record<string, GenericLocalizedTermDictionaryEntry> = {
  bagel: {
    "es-US": { displayName: "bagel" },
    "ko-KR": { displayName: "\uBCA0\uC774\uAE00", koreanCounterId: "piece" },
  },
  "bacon and egg sandwich": {
    "es-US": { displayName: "s\u00E1ndwich de tocino y huevo" },
    "ko-KR": { displayName: "\uBCA0\uC774\uCEE8 \uC5D0\uADF8 \uC0CC\uB4DC\uC704\uCE58" },
  },
  "blueberry scone": {
    "es-US": { displayName: "scone de ar\u00E1ndanos" },
    "ko-KR": { displayName: "\uBE14\uB8E8\uBCA0\uB9AC \uC2A4\uCF58", koreanCounterId: "piece" },
  },
  coffee: {
    "es-US": { displayName: "caf\u00E9" },
    "ko-KR": { displayName: "\uCEE4\uD53C", koreanCounterId: "cup" },
  },
  "coffee drink": {
    "es-US": { displayName: "bebida de caf\u00E9" },
    "ko-KR": { displayName: "\uCEE4\uD53C \uC74C\uB8CC", koreanCounterId: "cup" },
  },
  "cold brew": {
    "es-US": { displayName: "cold brew" },
    "ko-KR": { displayName: "\uCF5C\uB4DC\uBE0C\uB8E8", koreanCounterId: "cup" },
  },
  cookie: {
    "es-US": { displayName: "galleta" },
    "ko-KR": { displayName: "\uCFE0\uD0A4", koreanCounterId: "piece" },
  },
  "cookie of your choice": {
    "es-US": { displayName: "galleta de tu elecci\u00F3n" },
    "ko-KR": { displayName: "\uC6D0\uD558\uB294 \uCFE0\uD0A4", koreanCounterId: "piece" },
  },
  croissant: {
    "es-US": { displayName: "croissant" },
    "ko-KR": { displayName: "\uD06C\uB8E8\uC544\uC0C1", koreanCounterId: "piece" },
  },
  "drip coffee": {
    "es-US": { displayName: "caf\u00E9 de filtro" },
    "ko-KR": { displayName: "\uB4DC\uB9BD \uCEE4\uD53C", koreanCounterId: "cup" },
  },
  espresso: {
    "es-US": { displayName: "espresso" },
    "ko-KR": { displayName: "\uC5D0\uC2A4\uD504\uB808\uC18C", koreanCounterId: "cup" },
  },
  "egg sandwich": {
    "es-US": { displayName: "s\u00E1ndwich de huevo" },
    "ko-KR": { displayName: "\uC5D0\uADF8 \uC0CC\uB4DC\uC704\uCE58" },
  },
  "house drip coffee": {
    "es-US": { displayName: "caf\u00E9 de filtro de la casa" },
    "ko-KR": { displayName: "\uD558\uC6B0\uC2A4 \uB4DC\uB9BD \uCEE4\uD53C", koreanCounterId: "cup" },
  },
  "iced latte": {
    "es-US": { displayName: "latte helado" },
    "ko-KR": { displayName: "\uC544\uC774\uC2A4 \uB77C\uB5BC", koreanCounterId: "cup" },
  },
  latte: {
    "es-US": { displayName: "latte" },
    "ko-KR": { displayName: "\uB77C\uB5BC", koreanCounterId: "cup" },
  },
  "large coffee": {
    "es-US": { displayName: "caf\u00E9 grande" },
    "ko-KR": { displayName: "\uB77C\uC9C0 \uCEE4\uD53C", koreanCounterId: "cup" },
  },
  "large coffee drink": {
    "es-US": { displayName: "bebida de caf\u00E9 grande" },
    "ko-KR": { displayName: "\uB77C\uC9C0 \uCEE4\uD53C \uC74C\uB8CC", koreanCounterId: "cup" },
  },
  "any large coffee drink": {
    "es-US": { displayName: "cualquier bebida de caf\u00E9 grande" },
    "ko-KR": { displayName: "\uBAA8\uB4E0 \uB77C\uC9C0 \uCEE4\uD53C \uC74C\uB8CC", koreanCounterId: "cup" },
  },
  "mango lassi": {
    "es-US": { displayName: "lassi de mango" },
    "ko-KR": { displayName: "\uB9DD\uACE0 \uB77C\uC2DC", koreanCounterId: "cup" },
  },
  "mini-cookie": {
    "es-US": { displayName: "mini galleta" },
    "ko-KR": { displayName: "\uBBF8\uB2C8 \uCFE0\uD0A4", koreanCounterId: "piece" },
  },
  muffin: {
    "es-US": { displayName: "muffin" },
    "ko-KR": { displayName: "\uBA38\uD540", koreanCounterId: "piece" },
  },
  pastry: {
    "es-US": { displayName: "pastelito" },
    "ko-KR": { displayName: "\uD398\uC774\uC2A4\uD2B8\uB9AC", koreanCounterId: "piece" },
  },
  scone: {
    "es-US": { displayName: "scone" },
    "ko-KR": { displayName: "\uC2A4\uCF58", koreanCounterId: "piece" },
  },
  tea: {
    "es-US": { displayName: "t\u00E9" },
    "ko-KR": { displayName: "\uCC28", koreanCounterId: "cup" },
  },
  americano: {
    "es-US": { displayName: "americano" },
    "ko-KR": { displayName: "\uc544\uba54\ub9ac\uce74\ub178", koreanCounterId: "cup" },
  },
  cappuccino: {
    "es-US": { displayName: "capuchino" },
    "ko-KR": { displayName: "\uce74\ud478\uce58\ub178", koreanCounterId: "cup" },
  },
  mocha: {
    "es-US": { displayName: "mocha" },
    "ko-KR": { displayName: "\ubaa8\uce74", koreanCounterId: "cup" },
  },
  macchiato: {
    "es-US": { displayName: "macchiato" },
    "ko-KR": { displayName: "\ub9c8\ud0a4\uc544\ud1a0", koreanCounterId: "cup" },
  },
  "chai latte": {
    "es-US": { displayName: "chai latte" },
    "ko-KR": { displayName: "\ucc28\uc774 \ub77c\ub5bc", koreanCounterId: "cup" },
  },
  "matcha latte": {
    "es-US": { displayName: "matcha latte" },
    "ko-KR": { displayName: "\ub9d0\ucc28 \ub77c\ub5bc", koreanCounterId: "cup" },
  },
  "hot chocolate": {
    "es-US": { displayName: "chocolate caliente" },
    "ko-KR": { displayName: "\ud56b \ucd08\ucf5c\ub9bf", koreanCounterId: "cup" },
  },
  "iced coffee": {
    "es-US": { displayName: "caf\xe9 helado" },
    "ko-KR": { displayName: "\uc544\uc774\uc2a4 \ucee4\ud53c", koreanCounterId: "cup" },
  },
  "iced tea": {
    "es-US": { displayName: "t\xe9 helado" },
    "ko-KR": { displayName: "\uc544\uc774\uc2a4 \ud2f0", koreanCounterId: "cup" },
  },
  lemonade: {
    "es-US": { displayName: "limonada" },
    "ko-KR": { displayName: "\ub808\ubaa8\ub124\uc774\ub4dc", koreanCounterId: "cup" },
  },
  smoothie: {
    "es-US": { displayName: "smoothie" },
    "ko-KR": { displayName: "\uc2a4\ubb34\ub514", koreanCounterId: "cup" },
  },
  milkshake: {
    "es-US": { displayName: "malteada" },
    "ko-KR": { displayName: "\ubc00\ud06c\uc170\uc774\ud06c", koreanCounterId: "cup" },
  },
  soda: {
    "es-US": { displayName: "refresco" },
    "ko-KR": { displayName: "\ud0c4\uc0b0\uc74c\ub8cc", koreanCounterId: "cup" },
  },
  "fountain drink": {
    "es-US": { displayName: "refresco de m\xe1quina" },
    "ko-KR": { displayName: "\ub514\uc2a4\ud39c\uc11c \uc74c\ub8cc", koreanCounterId: "cup" },
  },
  "bottled water": {
    "es-US": { displayName: "agua embotellada" },
    // A bottle counts as \uac1c, not \uc794 (cup).
    "ko-KR": { displayName: "\uc0dd\uc218", koreanCounterId: "piece" },
  },
  juice: {
    "es-US": { displayName: "jugo" },
    "ko-KR": { displayName: "\uc8fc\uc2a4", koreanCounterId: "cup" },
  },
  "orange juice": {
    "es-US": { displayName: "jugo de naranja" },
    "ko-KR": { displayName: "\uc624\ub80c\uc9c0 \uc8fc\uc2a4", koreanCounterId: "cup" },
  },
  "apple juice": {
    "es-US": { displayName: "jugo de manzana" },
    "ko-KR": { displayName: "\uc0ac\uacfc \uc8fc\uc2a4", koreanCounterId: "cup" },
  },
  donut: {
    "es-US": { displayName: "dona" },
    "ko-KR": { displayName: "\ub3c4\ub11b", koreanCounterId: "piece" },
  },
  "cinnamon roll": {
    "es-US": { displayName: "rollo de canela" },
    "ko-KR": { displayName: "\uc2dc\ub098\ubaac \ub864", koreanCounterId: "piece" },
  },
  brownie: {
    "es-US": { displayName: "brownie" },
    "ko-KR": { displayName: "\ube0c\ub77c\uc6b0\ub2c8", koreanCounterId: "piece" },
  },
  cupcake: {
    "es-US": { displayName: "cupcake" },
    "ko-KR": { displayName: "\ucef5\ucf00\uc774\ud06c", koreanCounterId: "piece" },
  },
  "cake slice": {
    "es-US": { displayName: "rebanada de pastel" },
    "ko-KR": { displayName: "\ucf00\uc774\ud06c \uc870\uac01", koreanCounterId: "piece" },
  },
  "cheesecake slice": {
    "es-US": { displayName: "rebanada de cheesecake" },
    "ko-KR": { displayName: "\uce58\uc988\ucf00\uc774\ud06c \uc870\uac01", koreanCounterId: "piece" },
  },
  "pie slice": {
    "es-US": { displayName: "rebanada de pay" },
    "ko-KR": { displayName: "\ud30c\uc774 \uc870\uac01", koreanCounterId: "piece" },
  },
  danish: {
    "es-US": { displayName: "pan dulce dan\xe9s" },
    "ko-KR": { displayName: "\ub370\ub2c8\uc2dc", koreanCounterId: "piece" },
  },
  biscotti: {
    "es-US": { displayName: "biscotti" },
    "ko-KR": { displayName: "\ube44\uc2a4\ucf54\ud2f0", koreanCounterId: "piece" },
  },
  "banana bread": {
    "es-US": { displayName: "pan de pl\xe1tano" },
    "ko-KR": { displayName: "\ubc14\ub098\ub098 \ube0c\ub808\ub4dc", koreanCounterId: "piece" },
  },
  toast: {
    "es-US": { displayName: "pan tostado" },
    "ko-KR": { displayName: "\ud1a0\uc2a4\ud2b8", koreanCounterId: "piece" },
  },
  "avocado toast": {
    "es-US": { displayName: "pan tostado con aguacate" },
    "ko-KR": { displayName: "\uc544\ubcf4\uce74\ub3c4 \ud1a0\uc2a4\ud2b8", koreanCounterId: "piece" },
  },
  pancakes: {
    "es-US": { displayName: "panqueques" },
    "ko-KR": { displayName: "\ud32c\ucf00\uc774\ud06c", koreanCounterId: "serving" },
  },
  waffle: {
    "es-US": { displayName: "waffle" },
    "ko-KR": { displayName: "\uc640\ud50c", koreanCounterId: "piece" },
  },
  omelet: {
    "es-US": { displayName: "omelet" },
    "ko-KR": { displayName: "\uc624\ubbc0\ub81b", koreanCounterId: "serving" },
  },
  "hash browns": {
    "es-US": { displayName: "papas hash brown" },
    "ko-KR": { displayName: "\ud574\uc2dc \ube0c\ub77c\uc6b4", koreanCounterId: "serving" },
  },
  "breakfast sandwich": {
    "es-US": { displayName: "s\xe1ndwich de desayuno" },
    "ko-KR": { displayName: "\uc544\uce68 \uc0cc\ub4dc\uc704\uce58", koreanCounterId: "piece" },
  },
  "breakfast burrito": {
    "es-US": { displayName: "burrito de desayuno" },
    "ko-KR": { displayName: "\uc544\uce68 \ubd80\ub9ac\ud1a0", koreanCounterId: "piece" },
  },
  "breakfast taco": {
    "es-US": { displayName: "taco de desayuno" },
    "ko-KR": { displayName: "\uc544\uce68 \ud0c0\ucf54", koreanCounterId: "piece" },
  },
  "yogurt parfait": {
    "es-US": { displayName: "parfait de yogur" },
    "ko-KR": { displayName: "\uc694\uac70\ud2b8 \ud30c\ub974\ud398", koreanCounterId: "serving" },
  },
  "granola bowl": {
    "es-US": { displayName: "bowl de granola" },
    "ko-KR": { displayName: "\uadf8\ub798\ub180\ub77c \ubcfc", koreanCounterId: "serving" },
  },
  sandwich: {
    "es-US": { displayName: "s\xe1ndwich" },
    "ko-KR": { displayName: "\uc0cc\ub4dc\uc704\uce58", koreanCounterId: "piece" },
  },
  "turkey sandwich": {
    "es-US": { displayName: "s\xe1ndwich de pavo" },
    "ko-KR": { displayName: "\ud130\ud0a4 \uc0cc\ub4dc\uc704\uce58", koreanCounterId: "piece" },
  },
  "chicken sandwich": {
    "es-US": { displayName: "s\xe1ndwich de pollo" },
    "ko-KR": { displayName: "\uce58\ud0a8 \uc0cc\ub4dc\uc704\uce58", koreanCounterId: "piece" },
  },
  "grilled cheese sandwich": {
    "es-US": { displayName: "s\xe1ndwich de queso a la parrilla" },
    "ko-KR": { displayName: "\uadf8\ub9b4\ub4dc \uce58\uc988 \uc0cc\ub4dc\uc704\uce58", koreanCounterId: "piece" },
  },
  wrap: {
    "es-US": { displayName: "wrap" },
    "ko-KR": { displayName: "\ub7a9", koreanCounterId: "piece" },
  },
  "chicken wrap": {
    "es-US": { displayName: "wrap de pollo" },
    "ko-KR": { displayName: "\uce58\ud0a8 \ub7a9", koreanCounterId: "piece" },
  },
  burger: {
    "es-US": { displayName: "hamburguesa" },
    "ko-KR": { displayName: "\ubc84\uac70", koreanCounterId: "piece" },
  },
  cheeseburger: {
    "es-US": { displayName: "hamburguesa con queso" },
    "ko-KR": { displayName: "\uce58\uc988\ubc84\uac70", koreanCounterId: "piece" },
  },
  "veggie burger": {
    "es-US": { displayName: "hamburguesa vegetariana" },
    "ko-KR": { displayName: "\ubca0\uc9c0 \ubc84\uac70", koreanCounterId: "piece" },
  },
  "hot dog": {
    "es-US": { displayName: "hot dog" },
    "ko-KR": { displayName: "\ud56b\ub3c4\uadf8", koreanCounterId: "piece" },
  },
  taco: {
    "es-US": { displayName: "taco" },
    "ko-KR": { displayName: "\ud0c0\ucf54", koreanCounterId: "piece" },
  },
  burrito: {
    "es-US": { displayName: "burrito" },
    "ko-KR": { displayName: "\ubd80\ub9ac\ud1a0", koreanCounterId: "piece" },
  },
  quesadilla: {
    "es-US": { displayName: "quesadilla" },
    "ko-KR": { displayName: "\ud018\uc0ac\ub514\uc544", koreanCounterId: "piece" },
  },
  "pizza slice": {
    "es-US": { displayName: "rebanada de pizza" },
    "ko-KR": { displayName: "\ud53c\uc790 \uc870\uac01", koreanCounterId: "piece" },
  },
  salad: {
    "es-US": { displayName: "ensalada" },
    "ko-KR": { displayName: "\uc0d0\ub7ec\ub4dc", koreanCounterId: "serving" },
  },
  "caesar salad": {
    "es-US": { displayName: "ensalada C\xe9sar" },
    "ko-KR": { displayName: "\uc2dc\uc800 \uc0d0\ub7ec\ub4dc", koreanCounterId: "serving" },
  },
  soup: {
    "es-US": { displayName: "sopa" },
    "ko-KR": { displayName: "\uc218\ud504", koreanCounterId: "serving" },
  },
  ramen: {
    "es-US": { displayName: "ramen" },
    "ko-KR": { displayName: "\ub77c\uba58", koreanCounterId: "serving" },
  },
  "rice bowl": {
    "es-US": { displayName: "bowl de arroz" },
    "ko-KR": { displayName: "\ub77c\uc774\uc2a4 \ubcfc", koreanCounterId: "serving" },
  },
  "poke bowl": {
    "es-US": { displayName: "poke bowl" },
    "ko-KR": { displayName: "\ud3ec\ucf00 \ubcfc", koreanCounterId: "serving" },
  },
  "sushi roll": {
    "es-US": { displayName: "rollo de sushi" },
    "ko-KR": { displayName: "\uc2a4\uc2dc \ub864", koreanCounterId: "piece" },
  },
  fries: {
    "es-US": { displayName: "papas fritas" },
    "ko-KR": { displayName: "\uac10\uc790\ud280\uae40", koreanCounterId: "serving" },
  },
  "onion rings": {
    "es-US": { displayName: "aros de cebolla" },
    "ko-KR": { displayName: "\uc5b4\ub2c8\uc5b8 \ub9c1", koreanCounterId: "serving" },
  },
  "chicken wings": {
    "es-US": { displayName: "alitas de pollo" },
    "ko-KR": { displayName: "\uce58\ud0a8 \uc719", koreanCounterId: "serving" },
  },
  "chicken tenders": {
    "es-US": { displayName: "tiras de pollo" },
    "ko-KR": { displayName: "\uce58\ud0a8 \ud150\ub354", koreanCounterId: "serving" },
  },
  "chicken nuggets": {
    "es-US": { displayName: "nuggets de pollo" },
    "ko-KR": { displayName: "\uce58\ud0a8 \ub108\uac9f", koreanCounterId: "serving" },
  },
  nachos: {
    "es-US": { displayName: "nachos" },
    "ko-KR": { displayName: "\ub098\ucd08", koreanCounterId: "serving" },
  },
  "chips and salsa": {
    "es-US": { displayName: "totopos con salsa" },
    "ko-KR": { displayName: "\uce69\uacfc \uc0b4\uc0ac", koreanCounterId: "serving" },
  },
  appetizer: {
    "es-US": { displayName: "aperitivo" },
    "ko-KR": { displayName: "\uc560\ud53c\ud0c0\uc774\uc800", koreanCounterId: "serving" },
  },
  "side dish": {
    "es-US": { displayName: "acompa\xf1amiento" },
    "ko-KR": { displayName: "\uc0ac\uc774\ub4dc \uba54\ub274", koreanCounterId: "serving" },
  },
  entree: {
    "es-US": { displayName: "plato principal" },
    "ko-KR": { displayName: "\uba54\uc778 \uc694\ub9ac", koreanCounterId: "serving" },
  },
  "lunch combo": {
    "es-US": { displayName: "combo de almuerzo" },
    "ko-KR": { displayName: "\ub7f0\uce58 \ucf64\ubcf4", koreanCounterId: "serving" },
  },
  "dinner entree": {
    "es-US": { displayName: "plato principal de cena" },
    "ko-KR": { displayName: "\ub514\ub108 \uba54\uc778 \uc694\ub9ac", koreanCounterId: "serving" },
  },
  "combo meal": {
    "es-US": { displayName: "combo" },
    "ko-KR": { displayName: "\ucf64\ubcf4 \uba54\ub274", koreanCounterId: "serving" },
  },
  "kids meal": {
    "es-US": { displayName: "comida para ni\xf1os" },
    // \ud0a4\uc988 \uc138\ud2b8 is the standard Korean menu term; \ud0a4\uc988 \ubc00 is awkward.
    "ko-KR": { displayName: "\ud0a4\uc988 \uc138\ud2b8", koreanCounterId: "serving" },
  },
  "ice cream": {
    "es-US": { displayName: "helado" },
    "ko-KR": { displayName: "\uc544\uc774\uc2a4\ud06c\ub9bc", koreanCounterId: "serving" },
  },
  "ice cream scoop": {
    "es-US": { displayName: "bola de helado" },
    "ko-KR": { displayName: "\uc544\uc774\uc2a4\ud06c\ub9bc \uc2a4\ucff1", koreanCounterId: "piece" },
  },
  "frozen yogurt": {
    "es-US": { displayName: "yogur helado" },
    "ko-KR": { displayName: "\ud504\ub85c\uc98c \uc694\uac70\ud2b8", koreanCounterId: "serving" },
  },
  gelato: {
    "es-US": { displayName: "gelato" },
    "ko-KR": { displayName: "\uc824\ub77c\ud1a0", koreanCounterId: "serving" },
  },
  pretzel: {
    "es-US": { displayName: "pretzel" },
    "ko-KR": { displayName: "\ud504\ub808\uccbc", koreanCounterId: "piece" },
  },
  popcorn: {
    "es-US": { displayName: "palomitas" },
    "ko-KR": { displayName: "\ud31d\ucf58", koreanCounterId: "serving" },
  },
  chips: {
    "es-US": { displayName: "papitas" },
    "ko-KR": { displayName: "\uce69", koreanCounterId: "serving" },
  },
  salsa: {
    "es-US": { displayName: "salsa" },
    "ko-KR": { displayName: "\uc0b4\uc0ac", koreanCounterId: "serving" },
  },
  guacamole: {
    "es-US": { displayName: "guacamole" },
    "ko-KR": { displayName: "\uacfc\uce74\ubab0\ub9ac", koreanCounterId: "serving" },
  },
  hummus: {
    "es-US": { displayName: "hummus" },
    "ko-KR": { displayName: "\ud6c4\ubb34\uc2a4", koreanCounterId: "serving" },
  },
  falafel: {
    "es-US": { displayName: "falafel" },
    "ko-KR": { displayName: "\ud314\ub77c\ud3a0", koreanCounterId: "serving" },
  },
  gyro: {
    "es-US": { displayName: "gyro" },
    // \uc790\uc774\ub85c reads as "gyroscope"; Korean menus use \uae30\ub85c\uc2a4 for the dish.
    "ko-KR": { displayName: "\uae30\ub85c\uc2a4", koreanCounterId: "piece" },
  },
  pita: {
    "es-US": { displayName: "pita" },
    "ko-KR": { displayName: "\ud53c\ud0c0", koreanCounterId: "piece" },
  },
  flatbread: {
    "es-US": { displayName: "pan plano" },
    "ko-KR": { displayName: "\ud50c\ub7ab\ube0c\ub808\ub4dc", koreanCounterId: "piece" },
  },
  "garlic bread": {
    "es-US": { displayName: "pan de ajo" },
    "ko-KR": { displayName: "\uac08\ub9ad \ube0c\ub808\ub4dc", koreanCounterId: "piece" },
  },
  pasta: {
    "es-US": { displayName: "pasta" },
    "ko-KR": { displayName: "\ud30c\uc2a4\ud0c0", koreanCounterId: "serving" },
  },
  spaghetti: {
    "es-US": { displayName: "espagueti" },
    "ko-KR": { displayName: "\uc2a4\ud30c\uac8c\ud2f0", koreanCounterId: "serving" },
  },
  pho: {
    "es-US": { displayName: "pho" },
    // Korean menus call pho \uc300\uad6d\uc218 ("rice noodles"); \ud37c alone is rarely used.
    "ko-KR": { displayName: "\uc300\uad6d\uc218", koreanCounterId: "serving" },
  },
  "curry bowl": {
    "es-US": { displayName: "bowl de curry" },
    "ko-KR": { displayName: "\uce74\ub808 \ubcfc", koreanCounterId: "serving" },
  },
  dumplings: {
    "es-US": { displayName: "dumplings" },
    "ko-KR": { displayName: "\ub9cc\ub450", koreanCounterId: "serving" },
  },
  "spring rolls": {
    "es-US": { displayName: "rollitos primavera" },
    "ko-KR": { displayName: "\uc2a4\ud504\ub9c1\ub864", koreanCounterId: "serving" },
  },
  "boba tea": {
    "es-US": { displayName: "t\xe9 boba" },
    "ko-KR": { displayName: "\ubcf4\ubc14 \ud2f0", koreanCounterId: "cup" },
  },
  "bubble tea": {
    "es-US": { displayName: "t\xe9 de burbujas" },
    "ko-KR": { displayName: "\ubc84\ube14\ud2f0", koreanCounterId: "cup" },
  },
  "milk tea": {
    "es-US": { displayName: "t\xe9 con leche" },
    "ko-KR": { displayName: "\ubc00\ud06c\ud2f0", koreanCounterId: "cup" },
  },
  "green tea": {
    "es-US": { displayName: "t\xe9 verde" },
    "ko-KR": { displayName: "\ub179\ucc28", koreanCounterId: "cup" },
  },
  "herbal tea": {
    "es-US": { displayName: "t\xe9 herbal" },
    "ko-KR": { displayName: "\ud5c8\ube0c\ucc28", koreanCounterId: "cup" },
  },
  // --- 2026-07-01 expansion batch: breakfast ---
  bacon: {
    "es-US": { displayName: "tocino" },
    "ko-KR": { displayName: "\ubca0\uc774\ucee8", koreanCounterId: "serving" },
  },
  sausage: {
    "es-US": { displayName: "salchicha" },
    "ko-KR": { displayName: "\uc18c\uc2dc\uc9c0", koreanCounterId: "piece" },
  },
  "scrambled eggs": {
    "es-US": { displayName: "huevos revueltos" },
    "ko-KR": { displayName: "\uc2a4\ud06c\ub7a8\ube14\ub4dc \uc5d0\uadf8", koreanCounterId: "serving" },
  },
  biscuit: {
    "es-US": { displayName: "bisquet" },
    "ko-KR": { displayName: "\ube44\uc2a4\ud0b7", koreanCounterId: "piece" },
  },
  "biscuits and gravy": {
    "es-US": { displayName: "bisquets con gravy" },
    "ko-KR": { displayName: "\ube44\uc2a4\ud0b7 \uc564 \uadf8\ub808\uc774\ube44", koreanCounterId: "serving" },
  },
  "french toast": {
    "es-US": { displayName: "pan franc\xe9s" },
    "ko-KR": { displayName: "\ud504\ub80c\uce58\ud1a0\uc2a4\ud2b8", koreanCounterId: "serving" },
  },
  "breakfast platter": {
    "es-US": { displayName: "plato de desayuno" },
    "ko-KR": { displayName: "\uc544\uce68 \uc138\ud2b8", koreanCounterId: "serving" },
  },
  "bagel with cream cheese": {
    "es-US": { displayName: "bagel con queso crema" },
    "ko-KR": { displayName: "\ud06c\ub9bc\uce58\uc988 \ubca0\uc774\uae00", koreanCounterId: "piece" },
  },
  "english muffin": {
    "es-US": { displayName: "muffin ingl\xe9s" },
    "ko-KR": { displayName: "\uc789\uae00\ub9ac\uc2dc \uba38\ud540", koreanCounterId: "piece" },
  },
  oatmeal: {
    "es-US": { displayName: "avena" },
    "ko-KR": { displayName: "\uc624\ud2b8\ubc00", koreanCounterId: "serving" },
  },
  "fruit cup": {
    "es-US": { displayName: "vaso de fruta" },
    "ko-KR": { displayName: "\uacfc\uc77c \ucef5", koreanCounterId: "serving" },
  },
  "croissant sandwich": {
    "es-US": { displayName: "s\xe1ndwich de croissant" },
    "ko-KR": { displayName: "\ud06c\ub8e8\uc544\uc0c1 \uc0cc\ub4dc\uc704\uce58", koreanCounterId: "piece" },
  },
  "egg bites": {
    "es-US": { displayName: "bocaditos de huevo" },
    "ko-KR": { displayName: "\uc5d0\uadf8 \ubc14\uc774\ud2b8", koreanCounterId: "serving" },
  },
  "breakfast combo": {
    "es-US": { displayName: "combo de desayuno" },
    "ko-KR": { displayName: "\uc544\uce68 \ucf64\ubcf4", koreanCounterId: "serving" },
  },
  // --- expansion batch: BBQ and sides ---
  brisket: {
    "es-US": { displayName: "brisket" },
    "ko-KR": { displayName: "\ube0c\ub9ac\uc2a4\ud0b7", koreanCounterId: "serving" },
  },
  "brisket plate": {
    "es-US": { displayName: "plato de brisket" },
    "ko-KR": { displayName: "\ube0c\ub9ac\uc2a4\ud0b7 \ud50c\ub808\uc774\ud2b8", koreanCounterId: "serving" },
  },
  "bbq plate": {
    "es-US": { displayName: "plato de BBQ" },
    "ko-KR": { displayName: "\ubc14\ube44\ud050 \ud50c\ub808\uc774\ud2b8", koreanCounterId: "serving" },
  },
  "pulled pork sandwich": {
    "es-US": { displayName: "s\xe1ndwich de cerdo deshebrado" },
    "ko-KR": { displayName: "\ud480\ub4dc\ud3ec\ud06c \uc0cc\ub4dc\uc704\uce58", koreanCounterId: "piece" },
  },
  ribs: {
    "es-US": { displayName: "costillas" },
    "ko-KR": { displayName: "\ub9bd", koreanCounterId: "serving" },
  },
  "rib plate": {
    "es-US": { displayName: "plato de costillas" },
    "ko-KR": { displayName: "\ub9bd \ud50c\ub808\uc774\ud2b8", koreanCounterId: "serving" },
  },
  "smoked sausage": {
    "es-US": { displayName: "salchicha ahumada" },
    "ko-KR": { displayName: "\ud6c8\uc81c \uc18c\uc2dc\uc9c0", koreanCounterId: "serving" },
  },
  "smoked turkey": {
    "es-US": { displayName: "pavo ahumado" },
    "ko-KR": { displayName: "\ud6c8\uc81c \uce60\uba74\uc870", koreanCounterId: "serving" },
  },
  "mac and cheese": {
    "es-US": { displayName: "macarrones con queso" },
    "ko-KR": { displayName: "\ub9e5\uc564\uce58\uc988", koreanCounterId: "serving" },
  },
  cornbread: {
    "es-US": { displayName: "pan de elote" },
    "ko-KR": { displayName: "\ucf58\ube0c\ub808\ub4dc", koreanCounterId: "piece" },
  },
  coleslaw: {
    "es-US": { displayName: "ensalada de col" },
    "ko-KR": { displayName: "\ucf54\uc6b8\uc2ac\ub85c", koreanCounterId: "serving" },
  },
  "baked beans": {
    "es-US": { displayName: "frijoles horneados" },
    "ko-KR": { displayName: "\ubca0\uc774\ud06c\ub4dc \ube48\uc988", koreanCounterId: "serving" },
  },
  "potato salad": {
    "es-US": { displayName: "ensalada de papa" },
    "ko-KR": { displayName: "\uac10\uc790 \uc0d0\ub7ec\ub4dc", koreanCounterId: "serving" },
  },
  // --- expansion batch: Tex-Mex ---
  fajitas: {
    "es-US": { displayName: "fajitas" },
    "ko-KR": { displayName: "\ud30c\ud788\ud0c0", koreanCounterId: "serving" },
  },
  "chicken fajitas": {
    "es-US": { displayName: "fajitas de pollo" },
    "ko-KR": { displayName: "\uce58\ud0a8 \ud30c\ud788\ud0c0", koreanCounterId: "serving" },
  },
  "queso dip": {
    "es-US": { displayName: "dip de queso" },
    "ko-KR": { displayName: "\ucf00\uc18c \ub525", koreanCounterId: "serving" },
  },
  "street tacos": {
    "es-US": { displayName: "tacos callejeros" },
    "ko-KR": { displayName: "\uc2a4\ud2b8\ub9ac\ud2b8 \ud0c0\ucf54", koreanCounterId: "serving" },
  },
  "quesabirria tacos": {
    "es-US": { displayName: "tacos de quesabirria" },
    "ko-KR": { displayName: "\ud018\uc0ac\ube44\ub9ac\uc544 \ud0c0\ucf54", koreanCounterId: "serving" },
  },
  "chicken quesadilla": {
    "es-US": { displayName: "quesadilla de pollo" },
    "ko-KR": { displayName: "\uce58\ud0a8 \ud018\uc0ac\ub514\uc544", koreanCounterId: "piece" },
  },
  chimichanga: {
    "es-US": { displayName: "chimichanga" },
    "ko-KR": { displayName: "\uce58\ubbf8\ucc3d\uac00", koreanCounterId: "piece" },
  },
  "taco salad": {
    "es-US": { displayName: "ensalada de taco" },
    "ko-KR": { displayName: "\ud0c0\ucf54 \uc0d0\ub7ec\ub4dc", koreanCounterId: "serving" },
  },
  "burrito bowl": {
    "es-US": { displayName: "bowl de burrito" },
    "ko-KR": { displayName: "\ubd80\ub9ac\ud1a0 \ubcfc", koreanCounterId: "serving" },
  },
  // --- expansion batch: pizza and Italian ---
  pizza: {
    "es-US": { displayName: "pizza" },
    "ko-KR": { displayName: "\ud53c\uc790", koreanCounterId: "piece" },
  },
  "large pizza": {
    "es-US": { displayName: "pizza grande" },
    "ko-KR": { displayName: "\ub77c\uc9c0 \ud53c\uc790", koreanCounterId: "piece" },
  },
  calzone: {
    "es-US": { displayName: "calzone" },
    "ko-KR": { displayName: "\uce7c\ucd08\ub124", koreanCounterId: "piece" },
  },
  breadsticks: {
    "es-US": { displayName: "palitos de pan" },
    "ko-KR": { displayName: "\ube0c\ub808\ub4dc\uc2a4\ud2f1", koreanCounterId: "serving" },
  },
  "mozzarella sticks": {
    "es-US": { displayName: "dedos de queso" },
    "ko-KR": { displayName: "\ubaa8\ucc28\ub810\ub77c \uc2a4\ud2f1", koreanCounterId: "serving" },
  },
  lasagna: {
    "es-US": { displayName: "lasa\xf1a" },
    "ko-KR": { displayName: "\ub77c\uc790\ub0d0", koreanCounterId: "serving" },
  },
  "fettuccine alfredo": {
    "es-US": { displayName: "fettuccine Alfredo" },
    "ko-KR": { displayName: "\ud398\ud22c\uce58\ub124 \uc54c\ud504\ub808\ub3c4", koreanCounterId: "serving" },
  },
  "meatball sub": {
    "es-US": { displayName: "s\xe1ndwich de alb\xf3ndigas" },
    "ko-KR": { displayName: "\ubbf8\ud2b8\ubcfc \uc0cc\ub4dc\uc704\uce58", koreanCounterId: "piece" },
  },
  // --- expansion batch: Asian ---
  "pho bowl": {
    "es-US": { displayName: "bowl de pho" },
    "ko-KR": { displayName: "\uc300\uad6d\uc218", koreanCounterId: "serving" },
  },
  "banh mi": {
    "es-US": { displayName: "banh mi" },
    "ko-KR": { displayName: "\ubc18\ubbf8", koreanCounterId: "piece" },
  },
  "pad thai": {
    "es-US": { displayName: "pad thai" },
    "ko-KR": { displayName: "\ud31f\ud0c0\uc774", koreanCounterId: "serving" },
  },
  "fried rice": {
    "es-US": { displayName: "arroz frito" },
    "ko-KR": { displayName: "\ubcf6\uc74c\ubc25", koreanCounterId: "serving" },
  },
  "orange chicken": {
    "es-US": { displayName: "pollo a la naranja" },
    "ko-KR": { displayName: "\uc624\ub80c\uc9c0 \uce58\ud0a8", koreanCounterId: "serving" },
  },
  "teriyaki bowl": {
    "es-US": { displayName: "bowl de teriyaki" },
    "ko-KR": { displayName: "\ub370\ub9ac\uc57c\ud0a4 \ub36e\ubc25", koreanCounterId: "serving" },
  },
  "sushi platter": {
    "es-US": { displayName: "plato de sushi" },
    "ko-KR": { displayName: "\uc2a4\uc2dc \ud50c\ub798\ud130", koreanCounterId: "serving" },
  },
  udon: {
    "es-US": { displayName: "udon" },
    "ko-KR": { displayName: "\uc6b0\ub3d9", koreanCounterId: "serving" },
  },
  "spring roll": {
    "es-US": { displayName: "rollito primavera" },
    "ko-KR": { displayName: "\uc2a4\ud504\ub9c1\ub864", koreanCounterId: "piece" },
  },
  "egg roll": {
    "es-US": { displayName: "egg roll" },
    "ko-KR": { displayName: "\uc5d0\uadf8\ub864", koreanCounterId: "piece" },
  },
  "wonton soup": {
    "es-US": { displayName: "sopa de wonton" },
    "ko-KR": { displayName: "\uc644\ud0d5 \uc218\ud504", koreanCounterId: "serving" },
  },
  "lo mein": {
    "es-US": { displayName: "lo mein" },
    "ko-KR": { displayName: "\ubcf6\uc74c\uba74", koreanCounterId: "serving" },
  },
  // --- expansion batch: Korean dishes (English source keys) ---
  bibimbap: {
    "es-US": { displayName: "bibimbap" },
    "ko-KR": { displayName: "\ube44\ube54\ubc25", koreanCounterId: "serving" },
  },
  bulgogi: {
    "es-US": { displayName: "bulgogi" },
    "ko-KR": { displayName: "\ubd88\uace0\uae30", koreanCounterId: "serving" },
  },
  "bulgogi bowl": {
    "es-US": { displayName: "bowl de bulgogi" },
    "ko-KR": { displayName: "\ubd88\uace0\uae30 \ub36e\ubc25", koreanCounterId: "serving" },
  },
  "korean fried chicken": {
    "es-US": { displayName: "pollo frito coreano" },
    "ko-KR": { displayName: "\ud6c4\ub77c\uc774\ub4dc \uce58\ud0a8", koreanCounterId: "serving" },
  },
  "kimchi fried rice": {
    "es-US": { displayName: "arroz frito con kimchi" },
    "ko-KR": { displayName: "\uae40\uce58\ubcf6\uc74c\ubc25", koreanCounterId: "serving" },
  },
  tteokbokki: {
    "es-US": { displayName: "tteokbokki" },
    "ko-KR": { displayName: "\ub5a1\ubcf6\uc774", koreanCounterId: "serving" },
  },
  gimbap: {
    "es-US": { displayName: "gimbap" },
    "ko-KR": { displayName: "\uae40\ubc25", koreanCounterId: "piece" },
  },
  "korean corn dog": {
    "es-US": { displayName: "corn dog coreano" },
    "ko-KR": { displayName: "\ucf54\ub9ac\uc548 \ud56b\ub3c4\uadf8", koreanCounterId: "piece" },
  },
  "corn dog": {
    "es-US": { displayName: "banderilla" },
    "ko-KR": { displayName: "\ucf58\ub3c4\uadf8", koreanCounterId: "piece" },
  },
  japchae: {
    "es-US": { displayName: "japchae" },
    "ko-KR": { displayName: "\uc7a1\ucc44", koreanCounterId: "serving" },
  },
  kimchi: {
    "es-US": { displayName: "kimchi" },
    "ko-KR": { displayName: "\uae40\uce58", koreanCounterId: "serving" },
  },
  // --- expansion batch: desserts ---
  macaron: {
    "es-US": { displayName: "macarr\xf3n" },
    "ko-KR": { displayName: "\ub9c8\uce74\ub871", koreanCounterId: "piece" },
  },
  tiramisu: {
    "es-US": { displayName: "tiramis\xfa" },
    "ko-KR": { displayName: "\ud2f0\ub77c\ubbf8\uc218", koreanCounterId: "piece" },
  },
  churro: {
    "es-US": { displayName: "churro" },
    "ko-KR": { displayName: "\uce04\ub7ec\uc2a4", koreanCounterId: "piece" },
  },
  "cake pop": {
    "es-US": { displayName: "cake pop" },
    "ko-KR": { displayName: "\ucf00\uc774\ud06c\ud31d", koreanCounterId: "piece" },
  },
  sundae: {
    "es-US": { displayName: "sundae" },
    "ko-KR": { displayName: "\uc544\uc774\uc2a4\ud06c\ub9bc \uc120\ub370", koreanCounterId: "serving" },
  },
  "banana split": {
    "es-US": { displayName: "banana split" },
    "ko-KR": { displayName: "\ubc14\ub098\ub098 \uc2a4\ud50c\ub9bf", koreanCounterId: "serving" },
  },
  "funnel cake": {
    "es-US": { displayName: "funnel cake" },
    "ko-KR": { displayName: "\ud37c\ub110 \ucf00\uc774\ud06c", koreanCounterId: "piece" },
  },
  crepe: {
    "es-US": { displayName: "crepa" },
    "ko-KR": { displayName: "\ud06c\ub808\ud398", koreanCounterId: "piece" },
  },
  "mochi donut": {
    "es-US": { displayName: "dona de mochi" },
    "ko-KR": { displayName: "\ubaa8\ucc0c \ub3c4\ub11b", koreanCounterId: "piece" },
  },
  croffle: {
    "es-US": { displayName: "croffle" },
    "ko-KR": { displayName: "\ud06c\ub85c\ud50c", koreanCounterId: "piece" },
  },
  "egg tart": {
    "es-US": { displayName: "tarta de huevo" },
    "ko-KR": { displayName: "\uc5d0\uadf8\ud0c0\ub974\ud2b8", koreanCounterId: "piece" },
  },
  "shaved ice": {
    "es-US": { displayName: "raspado" },
    "ko-KR": { displayName: "\ube59\uc218", koreanCounterId: "serving" },
  },
  // --- expansion batch: drinks ---
  "flat white": {
    "es-US": { displayName: "flat white" },
    "ko-KR": { displayName: "\ud50c\ub7ab\ud654\uc774\ud2b8", koreanCounterId: "cup" },
  },
  cortado: {
    "es-US": { displayName: "cortado" },
    "ko-KR": { displayName: "\ucf54\ub974\ud0c0\ub3c4", koreanCounterId: "cup" },
  },
  "espresso shot": {
    "es-US": { displayName: "shot de espresso" },
    "ko-KR": { displayName: "\uc5d0\uc2a4\ud504\ub808\uc18c \uc0f7", koreanCounterId: "cup" },
  },
  frappe: {
    "es-US": { displayName: "frapp\xe9" },
    "ko-KR": { displayName: "\ud504\ub77c\ud398", koreanCounterId: "cup" },
  },
  "thai tea": {
    "es-US": { displayName: "t\xe9 tailand\xe9s" },
    "ko-KR": { displayName: "\ud0c0\uc774 \ud2f0", koreanCounterId: "cup" },
  },
  "taro milk tea": {
    "es-US": { displayName: "t\xe9 con leche de taro" },
    "ko-KR": { displayName: "\ud0c0\ub85c \ubc00\ud06c\ud2f0", koreanCounterId: "cup" },
  },
  "brown sugar milk tea": {
    "es-US": { displayName: "t\xe9 con leche de az\xfacar morena" },
    "ko-KR": { displayName: "\ud751\ub2f9 \ubc00\ud06c\ud2f0", koreanCounterId: "cup" },
  },
  "strawberry lemonade": {
    "es-US": { displayName: "limonada de fresa" },
    "ko-KR": { displayName: "\ub538\uae30 \ub808\ubaa8\ub124\uc774\ub4dc", koreanCounterId: "cup" },
  },
  "sweet tea": {
    "es-US": { displayName: "t\xe9 dulce" },
    "ko-KR": { displayName: "\uc2a4\uc704\ud2b8 \ud2f0", koreanCounterId: "cup" },
  },
  "protein shake": {
    "es-US": { displayName: "licuado de prote\xedna" },
    "ko-KR": { displayName: "\ud504\ub85c\ud2f4 \uc170\uc774\ud06c", koreanCounterId: "cup" },
  },
  "energy drink": {
    "es-US": { displayName: "bebida energ\xe9tica" },
    "ko-KR": { displayName: "\uc5d0\ub108\uc9c0 \ub4dc\ub9c1\ud06c", koreanCounterId: "cup" },
  },
  "sparkling water": {
    "es-US": { displayName: "agua mineral" },
    "ko-KR": { displayName: "\ud0c4\uc0b0\uc218", koreanCounterId: "cup" },
  },
  kombucha: {
    "es-US": { displayName: "kombucha" },
    "ko-KR": { displayName: "\ucf64\ubd80\ucc28", koreanCounterId: "cup" },
  },
  "hot tea": {
    "es-US": { displayName: "t\xe9 caliente" },
    "ko-KR": { displayName: "\ub530\ub73b\ud55c \ucc28", koreanCounterId: "cup" },
  },
  // --- expansion batch: sizes and generic items ---
  "small coffee": {
    "es-US": { displayName: "caf\xe9 chico" },
    "ko-KR": { displayName: "\uc2a4\ubab0 \ucee4\ud53c", koreanCounterId: "cup" },
  },
  "medium coffee": {
    "es-US": { displayName: "caf\xe9 mediano" },
    "ko-KR": { displayName: "\ubbf8\ub514\uc5c4 \ucee4\ud53c", koreanCounterId: "cup" },
  },
  "large iced tea": {
    "es-US": { displayName: "t\xe9 helado grande" },
    "ko-KR": { displayName: "\ub77c\uc9c0 \uc544\uc774\uc2a4 \ud2f0", koreanCounterId: "cup" },
  },
  "large drink": {
    "es-US": { displayName: "bebida grande" },
    "ko-KR": { displayName: "\ub77c\uc9c0 \uc74c\ub8cc", koreanCounterId: "cup" },
  },
  "medium drink": {
    "es-US": { displayName: "bebida mediana" },
    "ko-KR": { displayName: "\ubbf8\ub514\uc5c4 \uc74c\ub8cc", koreanCounterId: "cup" },
  },
  "small drink": {
    "es-US": { displayName: "bebida chica" },
    "ko-KR": { displayName: "\uc2a4\ubab0 \uc74c\ub8cc", koreanCounterId: "cup" },
  },
  "any drink": {
    "es-US": { displayName: "cualquier bebida" },
    "ko-KR": { displayName: "\ubaa8\ub4e0 \uc74c\ub8cc", koreanCounterId: "cup" },
  },
};

const SOURCE_TERM_TO_ENGLISH_PAIRS = [
  ["tacos al pastor", "al pastor tacos"],
  ["tacos de carne asada", "carne asada tacos"],
  ["tacos de barbacoa", "barbacoa tacos"],
  ["tacos de carnitas", "carnitas tacos"],
  ["tacos de pescado", "fish tacos"],
  ["tacos de camar\xf3n", "shrimp tacos"],
  ["burrito de carne asada", "carne asada burrito"],
  ["burrito de frijoles", "bean burrito"],
  ["quesadilla de queso", "cheese quesadilla"],
  ["quesadilla de pollo", "chicken quesadilla"],
  ["enchiladas verdes", "green enchiladas"],
  ["enchiladas rojas", "red enchiladas"],
  ["enchiladas de pollo", "chicken enchiladas"],
  ["chilaquiles verdes", "green chilaquiles"],
  ["chilaquiles rojos", "red chilaquiles"],
  ["huevos rancheros", "ranch-style eggs"],
  ["tamal", "tamale"],
  ["tamales", "tamales"],
  ["tamal de elote", "sweet corn tamale"],
  ["mole poblano", "mole poblano"],
  ["pozole", "pozole"],
  ["menudo", "menudo"],
  ["birria", "birria"],
  ["birria de res", "beef birria"],
  ["consom\xe9 de birria", "birria consomme"],
  ["sopes", "sopes"],
  ["gorditas", "gorditas"],
  ["huaraches", "huaraches"],
  ["tostadas", "tostadas"],
  ["tostada de ceviche", "ceviche tostada"],
  ["ceviche", "ceviche"],
  ["ceviche de camar\xf3n", "shrimp ceviche"],
  ["coctel de camar\xf3n", "shrimp cocktail"],
  ["aguachile", "aguachile"],
  ["elote", "street corn"],
  ["esquites", "esquites"],
  ["churros", "churros"],
  ["flan", "flan"],
  ["tres leches", "tres leches cake"],
  ["arroz con leche", "rice pudding"],
  ["pan dulce", "sweet bread"],
  ["concha", "concha"],
  ["empanada", "empanada"],
  ["empanadas", "empanadas"],
  ["arepa", "arepa"],
  ["arepas", "arepas"],
  ["pupusa", "pupusa"],
  ["pupusas", "pupusas"],
  ["baleada", "baleada"],
  ["yuca frita", "fried yuca"],
  ["pl\xe1tanos maduros", "sweet plantains"],
  ["tostones", "tostones"],
  ["mofongo", "mofongo"],
  ["ropa vieja", "ropa vieja"],
  ["arroz con pollo", "chicken and rice"],
  ["arroz con gandules", "rice with pigeon peas"],
  ["pernil", "roast pork"],
  ["lech\xf3n", "roast pork"],
  ["pollo asado", "grilled chicken"],
  ["carne asada", "carne asada"],
  ["milanesa", "breaded cutlet"],
  ["torta", "torta"],
  ["torta de milanesa", "milanesa torta"],
  ["pambazo", "pambazo"],
  ["cemita", "cemita"],
  ["caldo de res", "beef soup"],
  ["caldo de pollo", "chicken soup"],
  ["caldo de mariscos", "seafood soup"],
  ["sopa de tortilla", "tortilla soup"],
  ["sopa de fideo", "fideo soup"],
  ["frijoles charros", "charro beans"],
  ["frijoles refritos", "refried beans"],
  ["arroz mexicano", "Mexican rice"],
  ["pico de gallo", "pico de gallo"],
  ["guacamole", "guacamole"],
  ["salsa verde", "green salsa"],
  ["salsa roja", "red salsa"],
  ["salsa picante", "hot salsa"],
  ["jalape\xf1o", "jalapeno"],
  ["rajas", "pepper strips"],
  ["nopales", "cactus paddles"],
  ["chorizo", "chorizo"],
  ["al pastor", "al pastor pork"],
  ["carnitas", "carnitas"],
  ["barbacoa", "barbacoa"],
  ["agua fresca", "agua fresca"],
  ["agua de horchata", "horchata"],
  ["agua de jamaica", "hibiscus agua fresca"],
  ["agua de tamarindo", "tamarind agua fresca"],
  ["horchata", "horchata"],
  ["jamaica", "hibiscus drink"],
  ["tamarindo", "tamarind drink"],
  ["atole", "atole"],
  ["champurrado", "champurrado"],
  ["caf\xe9 de olla", "spiced coffee"],
  ["chocolate caliente", "hot chocolate"],
  ["licuado", "fruit smoothie"],
  ["mangonada", "mangonada"],
  ["michelada", "michelada"],
  ["margarita", "margarita"],
  ["\uae40\uce58\ucc0c\uac1c", "kimchi stew"],
  ["\ub41c\uc7a5\ucc0c\uac1c", "soybean paste stew"],
  ["\uc21c\ub450\ubd80\ucc0c\uac1c", "soft tofu stew"],
  ["\ubd80\ub300\ucc0c\uac1c", "army stew"],
  ["\uccad\uad6d\uc7a5", "fermented soybean stew"],
  ["\uac08\ube44\ud0d5", "short rib soup"],
  ["\uc124\ub801\ud0d5", "ox bone soup"],
  ["\uc0bc\uacc4\ud0d5", "ginseng chicken soup"],
  ["\uac10\uc790\ud0d5", "pork bone soup"],
  ["\uc721\uac1c\uc7a5", "spicy beef soup"],
  ["\ubbf8\uc5ed\uad6d", "seaweed soup"],
  ["\ub5a1\uad6d", "rice cake soup"],
  ["\ub9cc\ub463\uad6d", "dumpling soup"],
  ["\ub0c9\uba74", "cold noodles"],
  ["\ubb3c\ub0c9\uba74", "cold buckwheat noodles"],
  ["\ube44\ube54\ub0c9\uba74", "spicy cold noodles"],
  ["\ube44\ube54\ubc25", "bibimbap"],
  ["\ub3cc\uc1a5\ube44\ube54\ubc25", "stone bowl bibimbap"],
  ["\ubd88\uace0\uae30", "bulgogi"],
  ["\uc81c\uc721\ubcf6\uc74c", "spicy pork stir-fry"],
  ["\ub2ed\uac08\ube44", "spicy stir-fried chicken"],
  ["\uac08\ube44\ucc1c", "braised short ribs"],
  ["\ub3fc\uc9c0\uac08\ube44", "pork ribs"],
  ["\uc0bc\uacb9\uc0b4", "pork belly"],
  ["\ubcf4\uc308", "bossam"],
  ["\uc871\ubc1c", "jokbal"],
  ["\uae40\ubc25", "gimbap"],
  ["\ucc38\uce58\uae40\ubc25", "tuna gimbap"],
  ["\uc57c\ucc44\uae40\ubc25", "vegetable gimbap"],
  ["\ub5a1\ubcf6\uc774", "tteokbokki"],
  ["\ub77c\ubcf6\uc774", "rabokki"],
  ["\uc21c\ub300", "blood sausage"],
  ["\uc5b4\ubb35", "fish cake"],
  ["\uc624\ub385", "fish cake skewers"],
  ["\ud280\uae40", "fried snacks"],
  ["\uae40\uce58\uc804", "kimchi pancake"],
  ["\ud574\ubb3c\ud30c\uc804", "seafood scallion pancake"],
  ["\ud30c\uc804", "scallion pancake"],
  ["\uac10\uc790\uc804", "potato pancake"],
  ["\ube48\ub300\ub5a1", "mung bean pancake"],
  ["\uc7a1\ucc44", "japchae"],
  ["\ub9cc\ub450", "dumplings"],
  ["\uad70\ub9cc\ub450", "fried dumplings"],
  ["\ucc10\ub9cc\ub450", "steamed dumplings"],
  ["\ucc1c\ub2ed", "braised chicken"],
  ["\ub2ed\uac15\uc815", "crispy sweet chicken"],
  ["\uc591\ub150\uce58\ud0a8", "spicy fried chicken"],
  ["\ud6c4\ub77c\uc774\ub4dc\uce58\ud0a8", "fried chicken"],
  ["\uac04\uc7a5\uce58\ud0a8", "soy garlic chicken"],
  ["\uce58\ud0a8", "Korean fried chicken"],
  ["\uce58\uc988\ubcfc", "cheese balls"],
  ["\ucf58\uce58\uc988", "corn cheese"],
  ["\uacc4\ub780\ucc1c", "steamed egg"],
  ["\uacc4\ub780\ub9d0\uc774", "rolled omelet"],
  ["\uae40\uce58\ubcf6\uc74c\ubc25", "kimchi fried rice"],
  ["\ubcf6\uc74c\ubc25", "fried rice"],
  ["\uc624\ubbc0\ub77c\uc774\uc2a4", "omelet rice"],
  ["\ub3c8\uae4c\uc2a4", "pork cutlet"],
  ["\uce58\uc988\ub3c8\uae4c\uc2a4", "cheese pork cutlet"],
  ["\uce74\ub808\ub77c\uc774\uc2a4", "curry rice"],
  ["\uc9dc\uc7a5\uba74", "black bean noodles"],
  ["\uc9ec\ubf55", "spicy seafood noodle soup"],
  ["\ud0d5\uc218\uc721", "sweet and sour pork"],
  ["\ub9c8\ub77c\ud0d5", "malatang"],
  ["\uce7c\uad6d\uc218", "knife-cut noodle soup"],
  ["\uc218\uc81c\ube44", "hand-pulled dough soup"],
  ["\uc794\uce58\uad6d\uc218", "banquet noodles"],
  ["\ube44\ube54\uad6d\uc218", "spicy mixed noodles"],
  ["\ucf69\uad6d\uc218", "cold soybean noodles"],
  ["\uae40\uce58", "kimchi"],
  ["\uae4d\ub450\uae30", "cubed radish kimchi"],
  ["\uc624\uc774\uc18c\ubc15\uc774", "stuffed cucumber kimchi"],
  ["\ub098\ubb3c", "seasoned vegetables"],
  ["\ucf69\ub098\ubb3c", "seasoned bean sprouts"],
  ["\ud638\ub5a1", "hotteok"],
  ["\ubd95\uc5b4\ube75", "fish-shaped pastry"],
  ["\ud638\ube75", "steamed bun"],
  ["\ucc10\ube75", "steamed bun"],
  ["\uc57d\uacfc", "honey cookie"],
  ["\uc1a1\ud3b8", "songpyeon"],
  ["\ub5a1", "rice cake"],
  ["\uc778\uc808\ubbf8", "injeolmi"],
  ["\ube59\uc218", "shaved ice"],
  ["\ud325\ube59\uc218", "red bean shaved ice"],
  ["\ud638\ub450\uacfc\uc790", "walnut cakes"],
  ["\ub2ec\uace0\ub098", "dalgona candy"],
  ["\uc57d\uc2dd", "sweet rice dessert"],
  ["\uc2dd\ud61c", "sweet rice punch"],
  ["\uc218\uc815\uacfc", "cinnamon punch"],
  ["\ubcf4\ub9ac\ucc28", "barley tea"],
  ["\uc625\uc218\uc218\ucc28", "corn tea"],
  ["\uc720\uc790\ucc28", "citron tea"],
  ["\ub300\ucd94\ucc28", "jujube tea"],
  ["\ub9e4\uc2e4\ucc28", "plum tea"],
  ["\ub9c9\uac78\ub9ac", "makgeolli"],
  ["\uc18c\uc8fc", "soju"],
  ["\ubcf5\ubd84\uc790\uc8fc", "raspberry wine"],
  ["\ubc14\ub098\ub098\uc6b0\uc720", "banana milk"],
  ["\ub538\uae30\uc6b0\uc720", "strawberry milk"],
  ["\ubbf8\uc22b\uac00\ub8e8", "multigrain shake"],
] as const;

const SOURCE_TERM_TO_ENGLISH_DICTIONARY: Record<string, GenericLocalizedTermDictionaryEntry> = Object.fromEntries(
  SOURCE_TERM_TO_ENGLISH_PAIRS.map(([sourceDisplayName, englishDisplayName]) => [
    normalizeKey(sourceDisplayName),
    { "en-US": { displayName: englishDisplayName } },
  ]),
) as Record<string, GenericLocalizedTermDictionaryEntry>;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeKey(value: string): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9\uac00-\ud7a3\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value: string): string {
  const key = normalizeKey(value);
  return key.replace(/[^a-z0-9\uac00-\ud7a3]+/g, "-").replace(/^-+|-+$/g, "") || "term";
}

function defaultEntityId(sourceDisplayName: string): string {
  return `merchant-term:${slug(sourceDisplayName)}`;
}

function matchesDoNotTranslate(value: string, terms: readonly string[] | null | undefined): boolean {
  const key = normalizeKey(value);
  return Boolean(key && (terms ?? []).some((term) => normalizeKey(term) === key));
}

// Size/quantity modifiers composed onto reviewed dictionary items so terms
// like "large iced tea" or "any smoothie" localize without needing their own
// entries. Spanish only composes gender-invariant modifiers (grande,
// cualquier); gendered sizes (mediano/a, chico/a) stay explicit entries.
const SIZE_MODIFIER_COMPOSERS: Record<string, Partial<Record<SupportedLocale, (base: string) => string>>> = {
  large: {
    "es-US": (base) => `${base} grande`,
    "ko-KR": (base) => `라지 ${base}`,
  },
  medium: {
    "ko-KR": (base) => `미디엄 ${base}`,
  },
  small: {
    "ko-KR": (base) => `스몰 ${base}`,
  },
  any: {
    "es-US": (base) => `cualquier ${base}`,
    "ko-KR": (base) => `모든 ${base}`,
  },
};

function composedModifierEntry(
  key: string,
  locale: SupportedLocale,
): { displayName: string; koreanCounterId?: string } | null {
  const match = key.match(/^(large|medium|small|any) (.+)$/);
  if (!match) return null;
  const compose = SIZE_MODIFIER_COMPOSERS[match[1]]?.[locale];
  const base = GENERIC_LOCALIZED_TERM_DICTIONARY[match[2]]?.[locale];
  if (!compose || !base?.displayName) return null;
  return {
    displayName: compose(base.displayName),
    ...(base.koreanCounterId ? { koreanCounterId: base.koreanCounterId } : {}),
  };
}

function dictionaryTerm(
  sourceDisplayName: string,
  locale: SupportedLocale,
  entityId: string,
): LocalizedOfferTerm | null {
  const key = normalizeKey(sourceDisplayName);
  const entry =
    GENERIC_LOCALIZED_TERM_DICTIONARY[key]?.[locale] ??
    SOURCE_TERM_TO_ENGLISH_DICTIONARY[key]?.[locale] ??
    composedModifierEntry(key, locale);
  if (!entry?.displayName) return null;
  return {
    entityId,
    locale,
    displayName: entry.displayName,
    ...(entry.koreanCounterId ? { koreanCounterId: entry.koreanCounterId } : {}),
    doNotTranslate: false,
    approvedLocalizedName: true,
    source: "reviewed_dictionary",
    verificationStatus: "verified",
    version: GENERIC_LOCALIZED_TERM_DICTIONARY_VERSION,
  };
}

function usableProvidedTerm(
  providedTerms: readonly LocalizedOfferTerm[] | null | undefined,
  entityId: string,
  locale: SupportedLocale,
): LocalizedOfferTerm | null {
  return (
    providedTerms?.find(
      (term) =>
        term.entityId === entityId &&
        term.locale === locale &&
        term.verificationStatus !== "blocked" &&
        cleanText(term.displayName).length > 0,
    ) ?? null
  );
}

export function resolveLocalizedOfferTerm(params: ResolveLocalizedOfferTermParams): LocalizedOfferTerm {
  const displayName = cleanText(params.sourceDisplayName) || "item";
  const entityId = cleanText(params.entityId) || defaultEntityId(displayName);
  const provided = usableProvidedTerm(params.providedTerms, entityId, params.locale);
  if (provided) return provided;

  const preserve = matchesDoNotTranslate(displayName, params.doNotTranslateTerms);
  const genericTerm = preserve ? null : dictionaryTerm(displayName, params.locale, entityId);
  if (genericTerm) return genericTerm;

  return {
    entityId,
    locale: params.locale,
    displayName,
    doNotTranslate: true,
    approvedLocalizedName: false,
    source: preserve ? "merchant_profile" : "merchant",
    verificationStatus: preserve ? "verified" : "needs_native_review",
    version: PRESERVED_MERCHANT_TERM_VERSION,
  };
}

export function localizedTermSnapshotId(term: LocalizedOfferTerm): string {
  return `${term.entityId}:${term.locale}:${term.version}`;
}

export function hasVerifiedLocalizedName(term: LocalizedOfferTerm): boolean {
  return term.verificationStatus === "verified" && term.approvedLocalizedName && !term.doNotTranslate;
}
