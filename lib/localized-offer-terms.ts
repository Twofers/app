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
    "ko-KR": { displayName: "\uc0dd\uc218", koreanCounterId: "cup" },
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
    "ko-KR": { displayName: "\ud0a4\uc988 \ubc00", koreanCounterId: "serving" },
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
    "ko-KR": { displayName: "\uc790\uc774\ub85c", koreanCounterId: "piece" },
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
    "ko-KR": { displayName: "\ud37c", koreanCounterId: "serving" },
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

function dictionaryTerm(
  sourceDisplayName: string,
  locale: SupportedLocale,
  entityId: string,
): LocalizedOfferTerm | null {
  const key = normalizeKey(sourceDisplayName);
  const entry = GENERIC_LOCALIZED_TERM_DICTIONARY[key]?.[locale] ?? SOURCE_TERM_TO_ENGLISH_DICTIONARY[key]?.[locale];
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
